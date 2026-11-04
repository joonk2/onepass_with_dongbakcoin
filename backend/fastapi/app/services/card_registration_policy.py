"""사용자가 직접 등록할 수 있는 카드 상품 정책.

부산은행 카드 6종만 일반 카드 등록 대상이다. 동백전 지갑 카드(원패스 카드)는
별도 발급 흐름으로 연결되므로 지갑 카드로 판별되는 상품만 예외로 허용한다.
"""

from app.services.dongbaek_card import is_dongbaek_wallet_card

REGISTRABLE_CARD_PRODUCT_IDS = frozenset(
    {
        "BNK_CK_P19",
        "BNK_CK_P23",
        "BNK_CR_P07",
        "BNK_CR_P09",
        "BNK_CR_P10",
        "BNK_CR_P16",
    }
)


def is_registrable_product(product_id: str, card_type: str | None) -> bool:
    if product_id in REGISTRABLE_CARD_PRODUCT_IDS:
        return True
    return is_dongbaek_wallet_card(product_id, card_type, None)
