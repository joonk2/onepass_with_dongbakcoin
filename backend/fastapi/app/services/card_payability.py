"""카드 자체의 결제 가능 여부 검증. 혜택 계산과는 독립적이다."""

from datetime import date

INACTIVE_PRODUCT_STATUSES = frozenset(
    {"INACTIVE", "SUSPENDED", "DISCONTINUED", "CLOSED", "EXPIRED"}
)


def card_block_reason(user_card, product, today: date | None = None) -> str | None:
    """결제할 수 없는 사유 코드. 결제 가능하면 None."""

    if (user_card.card_status or "").upper() != "ACTIVE":
        return "CARD_NOT_ACTIVE"
    if user_card.product_id and product is None:
        return "PRODUCT_NOT_FOUND"
    if product is not None and (
        (product.product_status or "").upper() in INACTIVE_PRODUCT_STATUSES
    ):
        return "PRODUCT_NOT_ACTIVE"
    expires_at = getattr(user_card, "expires_at", None)
    if expires_at is not None and expires_at < (today or date.today()):
        return "CARD_EXPIRED"
    return None
