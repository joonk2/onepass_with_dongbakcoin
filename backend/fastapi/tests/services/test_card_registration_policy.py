import pytest

from app.services.card_registration_policy import (
    REGISTRABLE_CARD_PRODUCT_IDS,
    is_registrable_product,
)


@pytest.mark.parametrize("product_id", sorted(REGISTRABLE_CARD_PRODUCT_IDS))
def test_six_bnk_products_are_registrable(product_id):
    assert is_registrable_product(product_id, "BANK_CREDIT")


def test_policy_has_exactly_six_products():
    assert len(REGISTRABLE_CARD_PRODUCT_IDS) == 6


def test_unknown_bank_product_is_rejected():
    assert not is_registrable_product("OLD_CARD", "BANK_CREDIT")


def test_onepass_wallet_card_is_still_issuable():
    assert is_registrable_product("PRD_DB_SYN", "DONGBAEK_CHECK")
