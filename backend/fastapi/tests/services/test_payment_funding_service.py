import os
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.db_entities import (  # noqa: F401
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
from app.db_entities.user_entity import Account, DbWallet, User
from app.schemas.payment_schema import MockPaymentRequest
from app.services.payment_service import (
    DuplicatePaymentError,
    InsufficientBalanceError,
    PaymentService,
)

TABLES = [
    User.__table__,
    Account.__table__,
    DbWallet.__table__,
    CardProduct.__table__,
    UserCard.__table__,
    Merchant.__table__,
    Ledger.__table__,
]


class FakeEngine:
    def recommend(self, user_id, merchant_id, amount_won):
        return {"candidates": []}


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    with sessionmaker(bind=engine)() as s:
        s.add(User(user_id="U1"))
        s.add(Merchant(merchant_id="M1", merchant_name="카페", industry_code="CAFE_BAKERY"))
        s.add(CardProduct(product_id="PRD_DB_SYN", product_name="동백전", card_type="DONGBAEK_CHECK"))
        s.add(CardProduct(product_id="CK", product_name="체크", card_type="BANK_CHECK"))
        s.add(CardProduct(product_id="CR", product_name="신용", card_type="BANK_CREDIT"))
        s.add(Account(account_id="A1", user_id="U1", account_status="ACTIVE", opening_balance_won=100000))
        s.add(DbWallet(wallet_id="W1", user_id="U1", charge_won=50000, cashback_won=0, policy_support_won=0, wallet_status="ACTIVE"))
        s.add(UserCard(user_card_id="UC_DB", user_id="U1", product_id="PRD_DB_SYN", card_status="ACTIVE"))
        s.add(UserCard(user_card_id="UC_CK", user_id="U1", product_id="CK", card_status="ACTIVE", linked_account_id="A1"))
        s.add(UserCard(user_card_id="UC_CR", user_id="U1", product_id="CR", card_status="ACTIVE", credit_limit_won=20000))
        s.add(UserCard(user_card_id="UC_CK_NOACC", user_id="U1", product_id="CK", card_status="ACTIVE"))
        s.commit()
        yield s


def req(card, amount=8500, rid="R1"):
    return MockPaymentRequest(
        request_id=rid, user_id="U1", user_card_id=card, merchant_id="M1", amount_won=amount
    )


def svc(db):
    return PaymentService(db=db, engine=FakeEngine())


def wallet_total(db):
    db.expire_all()
    w = db.get(DbWallet, "W1")
    return w.charge_won + w.cashback_won + w.policy_support_won


def test_dongbaek_still_debits_wallet(db):
    result = svc(db).create_mock_payment(req("UC_DB"))
    assert wallet_total(db) == 41500
    assert result.funding_type == "DONGBAEK_WALLET"


def test_check_card_debits_linked_account_and_not_wallet(db):
    s = svc(db)
    first = s.create_mock_payment(req("UC_CK"))
    second = s.create_mock_payment(req("UC_CK", rid="R2"))
    assert first.funding_type == "BANK_ACCOUNT"
    assert (first.funding_balance_before_won, first.funding_balance_after_won) == (100000, 91500)
    assert (second.funding_balance_before_won, second.funding_balance_after_won) == (91500, 83000)
    assert wallet_total(db) == 50000
    row = db.query(Ledger).filter_by(request_id="R1").one()
    assert (row.account_id, row.bucket_type, row.delta_won) == ("A1", "BANK_ACCOUNT", -8500)


def test_check_card_insufficient_balance_rejected_and_unchanged(db):
    with pytest.raises(InsufficientBalanceError):
        svc(db).create_mock_payment(req("UC_CK", amount=100001))
    assert db.query(Ledger).count() == 0


def test_credit_card_does_not_reduce_limit_or_balances(db):
    s = svc(db)
    result = s.create_mock_payment(req("UC_CR"))
    assert result.funding_type == "UNFUNDED"
    assert result.funding_balance_after_won is None
    row = db.query(Ledger).one()
    assert (row.account_id, row.bucket_type, row.wallet_id) == (None, None, None)
    assert wallet_total(db) == 50000
    db.expire_all()
    assert db.get(Account, "A1").opening_balance_won == 100000
    assert db.get(UserCard, "UC_CR").credit_limit_won == 20000


def test_credit_card_amount_above_limit_still_approved(db):
    result = svc(db).create_mock_payment(req("UC_CR", amount=50000))
    assert result.approval_status == "APPROVED"


@pytest.mark.parametrize("card", ["UC_CK", "UC_CR"])
def test_duplicate_request_does_not_double_charge(db, card):
    s = svc(db)
    s.create_mock_payment(req(card))
    with pytest.raises(DuplicatePaymentError):
        s.create_mock_payment(req(card))
    assert db.query(Ledger).count() == 1


@pytest.mark.parametrize("card", ["UC_CK", "UC_CR"])
def test_ledger_failure_rolls_back_and_funding_unchanged(db, monkeypatch, card):
    s = svc(db)

    def fail(_ledger):
        raise RuntimeError("boom")

    monkeypatch.setattr(s.ledger_repo, "create_ledger", fail)
    with pytest.raises(RuntimeError):
        s.create_mock_payment(req(card))
    monkeypatch.undo()
    ok = s.create_mock_payment(req(card, rid="R2"))
    assert ok.funding_balance_before_won in (100000, None)


def test_check_card_without_linked_account_is_flagged_unfunded(db):
    result = svc(db).create_mock_payment(req("UC_CK_NOACC"))
    assert result.funding_type == "UNFUNDED"
    assert result.funding_balance_after_won is None
    assert wallet_total(db) == 50000
