from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime




#--------- 최적 결제수단 추천 (요청) -----------   -
class PaymentRecommendRequest(BaseModel):
    """최적 결제수단 추천 요청"""

    user_id: str = Field(min_length=1)
    merchant_id: str = Field(min_length=1)
    amount_won: int = Field(gt=0)


class PaymentMethodCandidate(BaseModel):
    """결제수단별 예상 혜택"""

    user_card_id: str
    product_id: str | None = None
    product_name: str | None = None

    expected_benefit_won: int = Field(ge=0)
    # eligible: 혜택이 확정 산정되었는지 (결제 가능 여부가 아님)
    eligible: bool
    # 결제 가능 여부는 혜택과 별개로 판단한다
    payable: bool = True
    payable_reason: str | None = None
    # CALCULATED / NOT_APPLICABLE / UNRESOLVED / ERROR
    benefit_status: str | None = None
    # CASH / POINT / CASHBACK 등 혜택 유형
    benefit_unit: str | None = None

    reason: str | None = None


#--------- 최적 결제수단 추천 (응답) ------------
class PaymentRecommendResponse(BaseModel):
    """최적 결제수단 추천 응답"""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    merchant_id: str
    amount_won: int

    recommended_user_card_id: str | None = None
    expected_benefit_won: int = Field(default=0, ge=0)

    candidates: list[PaymentMethodCandidate] = Field(
        default_factory=list
    )








#--------- 모의 결제 요청/응답 ------------
class MockPaymentRequest(BaseModel):
    """모의 결제 요청"""

    request_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    user_card_id: str = Field(min_length=1)
    merchant_id: str = Field(min_length=1)
    amount_won: int = Field(gt=0)


class MockPaymentResponse(BaseModel):
    """모의 결제 응답"""

    tx_id: str
    user_id: str
    user_card_id: str
    merchant_id: str

    amount_won: int
    approval_status: str
    event_at: datetime

    # 동백전 지갑 결제일 때만 채워지는, 커밋된 DB 기준 결제 전후 잔액
    wallet_id: str | None = None
    # DONGBAEK_WALLET / BANK_ACCOUNT / CREDIT_LIMIT / UNFUNDED(재원 모델 없음, 차감 안 함)
    funding_type: str | None = None
    # 일반 카드: 체크=연결 계좌 잔액, 신용=이용가능한도 (원장 기준 결제 전후)
    funding_balance_before_won: int | None = None
    funding_balance_after_won: int | None = None
    balance_before_won: int | None = None
    balance_after_payment_won: int | None = None
    balance_after_won: int | None = None
    awarded_benefit_won: int = 0
    benefit_reason: str | None = None
    benefit_status: str | None = None


class PaymentDetailResponse(BaseModel):
    """결제 상세 조회 응답"""

    tx_id: str
    user_id: str
    user_card_id: str
    merchant_id: str

    amount_won: int
    approval_status: str
    event_at: datetime

    # 거래 이력 화면에 필요한 추가 정보
    merchant_name: str | None = None
    product_name: str | None = None
    awarded_benefit_won: int | None = None
    source_mode: str | None = None
    event_note: str | None = None




class PaymentHistoryResponse(BaseModel):
    """사용자 결제 내역 응답"""

    payments: list[PaymentDetailResponse]


class PaymentCancelResponse(BaseModel):
    """모의 결제 취소 응답"""

    tx_id: str
    approval_status: str
    cancelled_at: datetime