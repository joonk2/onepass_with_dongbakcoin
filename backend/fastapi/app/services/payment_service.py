import logging
from typing import Any



from datetime import datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db_entities.ledger_entity import Ledger
from app.db_entities.user_entity import DbWallet
from app.repositories.card_repository import CardRepository
from app.repositories.merchant_repository import MerchantRepository
from app.repositories.ledger_repository import LedgerRepository
from app.services.card_payability import card_block_reason
from app.services.dongbaek_card import is_dongbaek_wallet_card

from app.schemas.payment_schema import (
    MockPaymentRequest,
    MockPaymentResponse,
    PaymentRecommendRequest,
    PaymentRecommendResponse,
    PaymentDetailResponse,
    PaymentHistoryResponse,
)



logger = logging.getLogger(__name__)

class RecommendationEngineNotAvailable(Exception):
    """추천 엔진이 아직 연결되지 않은 경우"""


class PaymentService:
    """최적 결제수단 추천 API와 추천 엔진 연결 계층"""


    # ---------- 생성자 ------------
    def __init__(self,
                 engine = None,
                 db : Session = None):
        self.engine = engine
        self.db = db

        # ---- 의미 : DB세션이 전달됬을때만 respository 객체를 생성하겠다 ----
        if db is not None:
            self.card_repo = CardRepository(db)
            self.merchant_repo = MerchantRepository(db)
            self.ledger_repo = LedgerRepository(db)



    # --------- 최적 결제수단 추천 ------------
    def recommend(
        self,
        request: PaymentRecommendRequest,
    ) -> PaymentRecommendResponse:
        """추천 엔진에 요청을 전달하고 결과를 반환"""

        if self.engine is None:
            raise RecommendationEngineNotAvailable(
                "추천 엔진이 아직 연결되지 않았습니다."
            )

        result = self.engine.recommend(
            user_id=request.user_id,
            merchant_id=request.merchant_id,
            amount_won=request.amount_won,
        )

        return PaymentRecommendResponse.model_validate(result)


    # --------- 모의 결제 처리 ------------
    def create_mock_payment(
        self,
        request: MockPaymentRequest,
    ) -> MockPaymentResponse:
        

        if self.db is None:
            raise RuntimeError("DB 세션이 연결되지 않았습니다.")

        # 1. 중복 결제 요청 확인
        existing = self.ledger_repo.get_ledgers_by_request_id(
            request.request_id
        )

        if existing:
            raise DuplicatePaymentError(
                "이미 처리된 결제 요청입니다."
            )

        # 2. 사용자 카드 확인
        user_card = self.card_repo.get_user_card_by_id(
            request.user_card_id
        )

        if user_card is None:
            raise PaymentNotFoundError(
                "등록된 카드를 찾을 수 없습니다."
            )

        # 3. 카드 소유자 확인
        if user_card.user_id != request.user_id:
            raise PaymentValidationError(
                "해당 사용자의 카드가 아닙니다."
            )

        # 3-1. 카드·상품 상태 검증 (혜택 계산과 별개)
        card_product = (
            self.card_repo.get_product_by_id(user_card.product_id)
            if user_card.product_id
            else None
        )
        blocked = card_block_reason(user_card, card_product)
        if blocked is not None:
            raise PaymentValidationError(
                f"결제할 수 없는 카드입니다. ({blocked})"
            )

        # 4. 가맹점 확인
        merchant = self.merchant_repo.get_merchant_by_id(
            request.merchant_id
        )

        if merchant is None:
            raise PaymentNotFoundError(
                "가맹점을 찾을 수 없습니다."
            )

        # 5. 혜택 계산 (지갑 잠금 전에 수행)
        (
            awarded_benefit_won,
            benefit_reason,
            benefit_status,
        ) = self._estimate_awarded_benefit(request)

        # 6. 동백전 지갑 결제 여부 확인 및 지갑 행 잠금
        wallet = self._lock_payment_wallet(user_card)
        if wallet is not None and merchant.dongbaek_status == "NOT_REGISTERED":
            self.db.rollback()
            raise PaymentValidationError(
                "동백전 결제가 불가능한 가맹점입니다."
            )

        balance_before_won = None
        balance_after_payment_won = None
        balance_after_won = None
        wallet_id = wallet.wallet_id if wallet is not None else None
        try:
            if wallet is not None:
                # 잠금 이후 동일 request_id 재확인 (동시 중복 클릭 방지)
                if self.ledger_repo.get_ledgers_by_request_id(
                    request.request_id
                ):
                    raise DuplicatePaymentError(
                        "이미 처리된 결제 요청입니다."
                    )
                balance_before_won = self._wallet_total(wallet)
                self._debit_wallet(wallet, request.amount_won)
                balance_after_payment_won = self._wallet_total(wallet)
                wallet.cashback_won = (
                    (wallet.cashback_won or 0) + awarded_benefit_won
                )
                balance_after_won = self._wallet_total(wallet)

            # 7. 모의 결제 데이터 생성
            tx_id = str(uuid4())
            event_at = datetime.now()

            ledger = Ledger(
                tx_id=tx_id,
                request_id=request.request_id,
                user_id=request.user_id,
                user_card_id=request.user_card_id,
                wallet_id=wallet.wallet_id if wallet is not None else None,
                merchant_id=request.merchant_id,
                event_at=event_at,
                event_seq=1,
                event_type="PAYMENT",
                gross_purchase_won=request.amount_won,
                delta_won=-request.amount_won,
                cashback_eligible_base_won=(
                    request.amount_won if wallet is not None else None
                ),
                awarded_benefit_won=awarded_benefit_won,
                approval_status="APPROVED",
                source_mode="MOCK",
                event_note=f"결제 승인 (혜택: {benefit_reason})",
            )

            # 8. 거래 원장 저장 (지갑 잔액 변경과 같은 트랜잭션)
            self.ledger_repo.create_ledger(ledger)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise DuplicatePaymentError("이미 처리된 결제 요청입니다.") from exc
        except Exception:
            self.db.rollback()
            raise

        # 9. 결제 결과 반환
        return MockPaymentResponse(
            tx_id=tx_id,
            user_id=request.user_id,
            user_card_id=request.user_card_id,
            merchant_id=request.merchant_id,
            amount_won=request.amount_won,
            approval_status="APPROVED",
            event_at=event_at,
            wallet_id=wallet_id,
            balance_before_won=balance_before_won,
            balance_after_payment_won=balance_after_payment_won,
            balance_after_won=balance_after_won,
            awarded_benefit_won=awarded_benefit_won,
            benefit_reason=benefit_reason,
            benefit_status=benefit_status,
        )

    @staticmethod
    def _wallet_total(wallet: DbWallet) -> int:
        return (
            (wallet.charge_won or 0)
            + (wallet.policy_support_won or 0)
            + (wallet.cashback_won or 0)
        )

    @staticmethod
    def _is_dongbaek_card(user_card, product) -> bool:
        return is_dongbaek_wallet_card(
            user_card.product_id,
            product.card_type if product else None,
            user_card.db_wallet_id,
        )

    # --------- 모의 결제 보조 함수 ------------
    def _estimate_awarded_benefit(
        self, request: MockPaymentRequest
    ) -> tuple[int, str, str]:
        """추천 엔진과 같은 정책으로 (혜택 금액, 사유, 상태)를 계산

        엔진 호출 자체가 실패하면 0원으로 바꾸지 않고 BenefitCalculationError로 알린다.
        후보 단위의 계산 불가는 결제를 막지 않고 상태(UNRESOLVED/ERROR)로 기록한다.
        """

        if self.engine is None:
            return 0, "BENEFIT_ENGINE_NOT_CONFIGURED", "UNRESOLVED"

        try:
            result = self.engine.recommend(
                user_id=request.user_id,
                merchant_id=request.merchant_id,
                amount_won=request.amount_won,
            )
        except Exception as exc:
            logger.exception("결제 혜택 계산에 실패했습니다.")
            raise BenefitCalculationError(
                "혜택 계산에 실패해 결제를 처리하지 않았습니다."
            ) from exc

        for candidate in result.get("candidates", []):
            if candidate.get("user_card_id") != request.user_card_id:
                continue
            reason = str(candidate.get("reason") or "")
            if candidate.get("eligible"):
                return (
                    max(int(candidate.get("expected_benefit_won") or 0), 0),
                    reason or "BENEFIT_APPLIED",
                    "CALCULATED",
                )
            return (
                0,
                reason or "NOT_ELIGIBLE",
                str(candidate.get("benefit_status") or "UNRESOLVED"),
            )

        return 0, "CARD_NOT_QUOTED", "UNRESOLVED"

    def _lock_payment_wallet(self, user_card) -> DbWallet | None:
        """동백전 카드 결제면 사용자의 활성 지갑 행을 잠가서 반환"""

        product = (
            self.card_repo.get_product_by_id(user_card.product_id)
            if user_card.product_id
            else None
        )
        if not self._is_dongbaek_card(user_card, product):
            return None

        statement = select(DbWallet).where(
            DbWallet.user_id == user_card.user_id,
            DbWallet.wallet_status == "ACTIVE",
        )
        if user_card.db_wallet_id is not None:
            statement = statement.where(
                DbWallet.wallet_id == user_card.db_wallet_id
            )
        wallets = list(
            self.db.scalars(
                statement.order_by(DbWallet.wallet_id).with_for_update()
            ).all()
        )

        if not wallets:
            raise PaymentNotFoundError(
                "사용 가능한 동백전 지갑을 찾을 수 없습니다."
            )
        if len(wallets) > 1:
            raise PaymentValidationError(
                "결제할 동백전 지갑을 특정할 수 없습니다."
            )
        return wallets[0]

    @staticmethod
    def _debit_wallet(wallet: DbWallet, amount_won: int) -> None:
        """충전금 → 정책지원금 → 캐시백 순서로 잔액 차감"""

        buckets = ("charge_won", "policy_support_won", "cashback_won")
        available = sum(getattr(wallet, name) or 0 for name in buckets)
        if available < amount_won:
            raise InsufficientBalanceError("동백전 잔액이 부족합니다.")

        remaining = amount_won
        for name in buckets:
            current = getattr(wallet, name) or 0
            used = min(current, remaining)
            setattr(wallet, name, current - used)
            remaining -= used







    # --------- 거래 이력 응답 생성 ------------
    def _build_payment_detail(
        self,
        ledger: Ledger,
    ) -> PaymentDetailResponse:
        """원장 데이터를 화면용 거래 이력 응답으로 변환"""

        # 가맹점 이름 조회
        merchant = None

        if ledger.merchant_id:
            merchant = self.merchant_repo.get_merchant_by_id(
                ledger.merchant_id
            )

        merchant_name = (
            merchant.merchant_name
            if merchant is not None
            else None
        )

        # 카드 상품 이름 조회
        product_name = None

        if ledger.user_card_id:
            user_card = self.card_repo.get_user_card_by_id(
                ledger.user_card_id
            )

            if user_card is not None and user_card.product_id:
                product = self.card_repo.get_product_by_id(
                    user_card.product_id
                )

                if product is not None:
                    product_name = product.product_name

        return PaymentDetailResponse(
            tx_id=ledger.tx_id,
            user_id=ledger.user_id,
            user_card_id=ledger.user_card_id,
            merchant_id=ledger.merchant_id,
            amount_won=ledger.gross_purchase_won,
            approval_status=ledger.approval_status,
            event_at=ledger.event_at,
            merchant_name=merchant_name,
            product_name=product_name,
            awarded_benefit_won=ledger.awarded_benefit_won,
            source_mode=ledger.source_mode,
            event_note=ledger.event_note,
        )















    # --------- 결제 상세 조회 ------------
    def get_payment_detail(self, tx_id: str):
        """거래 ID로 결제 상세 조회"""

        if self.db is None:
            raise RuntimeError("DB 세션이 연결되지 않았습니다.")

        ledgers = self.ledger_repo.get_ledgers_by_tx_id(tx_id)

        if not ledgers:
            raise PaymentNotFoundError(
                "결제 내역을 찾을 수 없습니다."
            )

        payment = next(
            (ledger for ledger in ledgers if ledger.event_type == "PAYMENT"),
            None,
        )

        if payment is None:
            raise PaymentNotFoundError(
                "결제 내역을 찾을 수 없습니다."
            )

        return self._build_payment_detail(payment)






    # --------- 사용자별 결제 내역조회 ------------
    def get_payment_history(
        self,
        user_id: str,
    ) -> PaymentHistoryResponse:
        """사용자별 모의 결제 내역 조회"""

        if self.db is None:
            raise RuntimeError("DB 세션이 연결되지 않았습니다.")

        ledgers = self.ledger_repo.get_ledgers_by_user_id(user_id)

        payments = []

        for ledger in ledgers:
            # 결제 승인 이벤트만 조회
            if ledger.event_type != "PAYMENT":
                continue

            payments.append(self._build_payment_detail(ledger))

        return PaymentHistoryResponse(payments=payments)



# --------- 결제 예외처리 ---------------
class PaymentValidationError(Exception):
    """결제 요청 검증 실패"""

class InsufficientBalanceError(Exception):
    """동백전 잔액 부족"""

class BenefitCalculationError(Exception):
    """혜택 계산 실패"""

class PaymentNotFoundError(Exception):
    """결제 대상 정보 없음"""

class DuplicatePaymentError(Exception):
    """중복 결제 요청"""