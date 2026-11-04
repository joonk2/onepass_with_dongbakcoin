"""추천과 결제가 공유하는 동백전 지갑 카드 판별 규칙.

카드 이름이나 발급사 문자열은 사용하지 않고, 등록 카드의 지갑 연결,
상품 ID, 상품 유형만 기준으로 삼는다.
"""

DONGBAEK_PRODUCT_IDS = frozenset({"PRD_DB_SYN"})


def is_dongbaek_wallet_card(
    product_id: str | None,
    card_type: str | None,
    db_wallet_id: str | None,
) -> bool:
    if db_wallet_id is not None:
        return True
    if product_id in DONGBAEK_PRODUCT_IDS:
        return True
    return "DONGBAEK" in (card_type or "").upper()
