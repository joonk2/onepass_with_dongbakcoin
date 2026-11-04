import os

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.db_entities import (  # noqa: F401  (register FK target tables)
    auth_entity,
    benefit_entity,
    card_entity as _card_entity,
    category_entity,
    identity_card_entity,
    ledger_entity as _ledger_entity,
    merchant_entity as _merchant_entity,
    policy_entity,
    registration_entity,
    user_entity as _user_entity,
)
from app.db_entities.card_entity import CardProduct, UserCard
from app.db_entities.ledger_entity import Ledger
from app.db_entities.merchant_entity import Merchant
from app.db_entities.user_entity import DbWallet, User
from app.schemas.payment_schema import MockPaymentRequest
from app.services.payment_service import (
    BenefitCalculationError,
    DuplicatePaymentError,
    InsufficientBalanceError,
    PaymentService,
)

TABLES = [
    User.__table__,
    DbWallet.__table__,
    CardProduct.__table__,
    UserCard.__table__,
    Merchant.__table__,
    Ledger.__table__,
]


class FakeEngine:
    def __init__(self, benefit_won, eligible=True):
        self.benefit_won = benefit_won
        self.eligible = eligible

    def recommend(self, user_id, merchant_id, amount_won):
        return {
            "candidates": [
                {
                    "user_card_id": "UC_DB",
                    "expected_benefit_won": self.benefit_won,
                    "eligible": self.eligible,
                },
                {
                    "user_card_id": "UC_CREDIT",
                    "expected_benefit_won": 999,
                    "eligible": True,
                },
            ]
        }


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    with sessionmaker(bind=engine)() as session:
        session.add(User(user_id="U1"))
        session.add(Merchant(merchant_id="M1", merchant_name="테스트 카페", industry_code="CAFE_BAKERY"))
        session.add(CardProduct(product_id="PRD_DB_SYN", product_name="동백전", card_type="DONGBAEK"))
        session.add(CardProduct(product_id="CREDIT_1", product_name="신용카드", card_type="CREDIT"))
        session.add(UserCard(user_card_id="UC_DB", user_id="U1", product_id="PRD_DB_SYN", card_status="ACTIVE"))
        session.add(UserCard(user_card_id="UC_CREDIT", user_id="U1", product_id="CREDIT_1", card_status="ACTIVE"))
        session.add(
            DbWallet(
                wallet_id="W1",
                user_id="U1",
                charge_won=50000,
                cashback_won=1000,
                policy_support_won=2000,
                wallet_status="ACTIVE",
            )
        )
        session.commit()
        yield session


def request(card="UC_DB", amount=10000, request_id="REQ-1"):
    return MockPaymentRequest(
        request_id=request_id,
        user_id="U1",
        user_card_id=card,
        merchant_id="M1",
        amount_won=amount,
    )


def balances(db):
    db.expire_all()
    wallet = db.get(DbWallet, "W1")
    return wallet.charge_won, wallet.policy_support_won, wallet.cashback_won


def test_dongbaek_payment_debits_wallet_and_awards_cashback(db):
    service = PaymentService(db=db, engine=FakeEngine(700))

    result = service.create_mock_payment(request())

    assert balances(db) == (40000, 2000, 1700)
    detail = service.get_payment_detail(result.tx_id)
    assert detail.awarded_benefit_won == 700
    assert detail.merchant_name == "테스트 카페"


def test_payment_spends_charge_then_support_then_cashback(db):
    service = PaymentService(db=db, engine=FakeEngine(0))

    service.create_mock_payment(request(amount=52500))

    assert balances(db) == (0, 0, 500)


def test_insufficient_balance_changes_nothing(db):
    service = PaymentService(db=db, engine=FakeEngine(700))

    with pytest.raises(InsufficientBalanceError):
        service.create_mock_payment(request(amount=53001))

    assert balances(db) == (50000, 2000, 1000)
    assert db.query(Ledger).count() == 0


def test_duplicate_request_does_not_debit_twice(db):
    service = PaymentService(db=db, engine=FakeEngine(0))

    service.create_mock_payment(request())
    with pytest.raises(DuplicatePaymentError):
        service.create_mock_payment(request())

    assert balances(db) == (40000, 2000, 1000)
    assert db.query(Ledger).count() == 1


def test_non_dongbaek_card_leaves_wallet_untouched(db):
    service = PaymentService(db=db, engine=FakeEngine(0))

    result = service.create_mock_payment(request(card="UC_CREDIT"))

    assert balances(db) == (50000, 2000, 1000)
    assert service.get_payment_detail(result.tx_id).awarded_benefit_won == 999


def test_ineligible_card_gets_no_benefit(db):
    service = PaymentService(db=db, engine=FakeEngine(700, eligible=False))

    result = service.create_mock_payment(request())

    assert service.get_payment_detail(result.tx_id).awarded_benefit_won == 0
    assert balances(db) == (40000, 2000, 1000)


def test_ledger_failure_rolls_back_wallet_debit(db, monkeypatch):
    service = PaymentService(db=db, engine=FakeEngine(700))

    def fail(_ledger):
        raise RuntimeError("ledger write failed")

    monkeypatch.setattr(service.ledger_repo, "create_ledger", fail)

    with pytest.raises(RuntimeError):
        service.create_mock_payment(request())

    assert balances(db) == (50000, 2000, 1000)
    assert db.query(Ledger).count() == 0


def test_90001_minus_12600_persists_77401_and_reports_server_balances(db):
    wallet = db.get(DbWallet, "W1")
    wallet.charge_won, wallet.policy_support_won, wallet.cashback_won = 90001, 0, 0
    db.commit()
    service = PaymentService(db=db, engine=FakeEngine(0))

    result = service.create_mock_payment(request(amount=12600))

    assert (result.balance_before_won, result.balance_after_won) == (90001, 77401)
    assert balances(db) == (77401, 0, 0)


def test_90001_minus_27000_with_2700_cashback_reports_server_balances(db):
    wallet = db.get(DbWallet, "W1")
    wallet.charge_won, wallet.policy_support_won, wallet.cashback_won = 90001, 0, 0
    db.commit()
    service = PaymentService(db=db, engine=FakeEngine(2700))

    result = service.create_mock_payment(request(amount=27000))

    assert result.balance_before_won == 90001
    assert result.balance_after_payment_won == 63001
    assert result.balance_after_won == 65701
    assert result.awarded_benefit_won == 2700
    assert balances(db) == (63001, 0, 2700)
    assert service.get_payment_detail(result.tx_id).awarded_benefit_won == 2700


def test_dongbaek_product_id_is_wallet_card_even_if_card_type_is_bank(db):
    db.get(CardProduct, "PRD_DB_SYN").card_type = "BANK_CHECK"
    db.commit()

    result = PaymentService(db=db, engine=FakeEngine(0)).create_mock_payment(request())

    assert result.balance_after_won == 43000
    assert balances(db) == (40000, 2000, 1000)


def test_card_with_dongbaek_name_only_is_not_wallet_card(db):
    db.add(CardProduct(product_id="PRD_X", product_name="동백전 이름만 같은 카드", issuer="DONGBAEKJEON", card_type="BANK_CREDIT"))
    db.add(UserCard(user_card_id="UC_X", user_id="U1", product_id="PRD_X", card_status="ACTIVE"))
    db.commit()

    result = PaymentService(db=db, engine=FakeEngine(0)).create_mock_payment(request(card="UC_X"))

    assert result.balance_before_won is None
    assert balances(db) == (50000, 2000, 1000)


def test_card_linked_to_wallet_is_debited(db):
    db.add(CardProduct(product_id="PRD_L", product_name="연결 카드", card_type="BANK_CHECK"))
    db.add(UserCard(user_card_id="UC_L", user_id="U1", product_id="PRD_L", db_wallet_id="W1", card_status="ACTIVE"))
    db.commit()

    result = PaymentService(db=db, engine=FakeEngine(0)).create_mock_payment(request(card="UC_L", amount=12600))

    assert result.balance_after_won == 53000 - 12600
    assert balances(db) == (37400, 2000, 1000)


def test_benefit_calculation_failure_is_not_treated_as_zero(db):
    class BrokenEngine:
        def recommend(self, **kwargs):
            raise RuntimeError("engine down")

    with pytest.raises(BenefitCalculationError):
        PaymentService(db=db, engine=BrokenEngine()).create_mock_payment(request())

    assert balances(db) == (50000, 2000, 1000)
    assert db.query(Ledger).count() == 0


def test_ineligible_candidate_records_zero_with_reason(db):
    class IneligibleEngine:
        def recommend(self, **kwargs):
            return {"candidates": [{
                "user_card_id": "UC_DB", "expected_benefit_won": 2700,
                "eligible": False, "reason": "MERCHANT_NOT_REGISTERED",
            }]}

    result = PaymentService(db=db, engine=IneligibleEngine()).create_mock_payment(request())

    assert result.awarded_benefit_won == 0
    assert result.benefit_reason == "MERCHANT_NOT_REGISTERED"
    assert balances(db) == (40000, 2000, 1000)


def test_credit_card_payment_keeps_wallet_and_applies_own_benefit(db):
    service = PaymentService(db=db, engine=FakeEngine(2700))

    result = service.create_mock_payment(request(card="UC_CREDIT", amount=27000))

    assert result.balance_before_won is None and result.wallet_id is None
    assert result.awarded_benefit_won == 999
    assert balances(db) == (50000, 2000, 1000)
    with pytest.raises(DuplicatePaymentError):
        service.create_mock_payment(request(card="UC_CREDIT", amount=27000))
    assert db.query(Ledger).count() == 1


def test_non_dongbaek_card_reports_no_wallet_balances(db):
    result = PaymentService(db=db, engine=FakeEngine(0)).create_mock_payment(
        request(card="UC_CREDIT")
    )
    assert result.balance_before_won is None and result.balance_after_won is None


def test_without_engine_no_benefit(db):
    service = PaymentService(db=db)

    result = service.create_mock_payment(request())

    assert service.get_payment_detail(result.tx_id).awarded_benefit_won == 0
