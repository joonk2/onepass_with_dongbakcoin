from pydantic import BaseModel, ConfigDict
from datetime import date
from pydantic import Field, model_validator




# --------- 카드 상품 조회 응답------------
class CardProductResponse(BaseModel):
    """카드 상품 조회 응답"""

    model_config = ConfigDict(from_attributes=True)

    product_id: str
    product_name: str
    issuer: str | None = None
    card_type: str | None = None
    product_status: str | None = None
    terms_version: str | None = None
    source_status: str | None = None
    source_ref: str | None = None




# --------- 사용자 보유 카드 조회 응답------------
class UserCardResponse(BaseModel):
    """사용자 보유 카드 조회 응답"""

    model_config = ConfigDict(from_attributes=True)

    user_card_id: str
    user_id: str
    product_id: str
    db_wallet_id: str | None = None
    linked_account_id: str | None = None
    card_status: str | None = None
    credit_limit_won: int | None = None
    default_preference_rank: int | None = None
    expires_at: date | None = None
    registered_ref: str | None = None
    active_from: date | None = None
    active_to: date | None = None
    card_last4: str | None = None
    prev_month_spend_won: int | None = None



# --------- 사용자 카드 등록 요청 ------------
class UserCardCreateRequest(BaseModel):
    """사용자 보유 카드 등록 요청. 상세 입력값은 모두 선택이다."""

    product_id: str
    card_number: str | None = None
    card_cvc: str | None = None
    expiry_month: int | None = Field(default=None, ge=1, le=12)
    expiry_year: int | None = Field(default=None, ge=2000, le=2100)
    prev_month_spend_won: int | None = Field(default=None, ge=0, le=100_000_000)

    @model_validator(mode="after")
    def validate_card_details(self):
        if self.card_number is not None:
            digits = "".join(ch for ch in self.card_number if ch not in " -")
            if not digits.isdigit() or not 15 <= len(digits) <= 16:
                raise ValueError("카드번호는 15~16자리 숫자여야 합니다.")
            self.card_number = digits
        if self.card_cvc is not None and not (
            self.card_cvc.isdigit() and len(self.card_cvc) in (3, 4)
        ):
            raise ValueError("CVC는 3~4자리 숫자여야 합니다.")
        if (self.expiry_month is None) != (self.expiry_year is None):
            raise ValueError("유효기간은 월과 연도를 함께 입력해야 합니다.")
        return self











# --------- 사용자 카드 우선순위 설정 ------------
class CardPriorityItem(BaseModel):
    """카드 한 장의 우선순위"""

    user_card_id: str = Field(min_length=1)
    priority: int = Field(ge=1)


class CardPriorityUpdateRequest(BaseModel):
    """사용자 카드 우선순위 일괄 변경 요청"""

    cards: list[CardPriorityItem] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_priorities(self):
        card_ids = [card.user_card_id for card in self.cards]
        priorities = [card.priority for card in self.cards]

        if len(card_ids) != len(set(card_ids)):
            raise ValueError("중복된 카드 ID가 있습니다.")

        if len(priorities) != len(set(priorities)):
            raise ValueError("중복된 우선순위가 있습니다.")

        return self