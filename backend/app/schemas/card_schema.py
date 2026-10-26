from pydantic import BaseModel, ConfigDict
from datetime import date


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