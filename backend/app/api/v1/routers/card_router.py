from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.repositories.card_repository import CardRepository
from app.schemas.card_schema import CardProductResponse
from app.services.card_service import CardService
from app.schemas.card_schema import UserCardResponse



# --------- 카드 상품 조회 API ------------
router = APIRouter(
    prefix="/api/v1/cards",
    tags=["Cards"],
)


def get_card_service(
    db: Session = Depends(get_db),
) -> CardService:
    repository = CardRepository(db)
    return CardService(repository)


@router.get(
    "/products",
    response_model=list[CardProductResponse],
)
def get_card_products(
    service: CardService = Depends(get_card_service),
):
    """전체 카드 상품 조회"""
    return service.get_all_products()


@router.get(
    "/products/{product_id}",
    response_model=CardProductResponse,
)
def get_card_product(
    product_id: str,
    service: CardService = Depends(get_card_service),
):
    """카드 상품 상세 조회"""

    product = service.get_product_by_id(product_id)

    if product is None:
        raise HTTPException(
            status_code=404,
            detail="카드 상품을 찾을 수 없습니다.",
        )

    return product









# --------- 사용자 보유 카드 조회 API ------------
user_card_router = APIRouter(
    prefix="/api/v1/users",
    tags=["User Cards"],
)


@user_card_router.get(
    "/{user_id}/cards",
    response_model=list[UserCardResponse],
)
def get_user_cards(
    user_id: str,
    service: CardService = Depends(get_card_service),
):
    """사용자 보유 카드 목록 조회"""

    return service.get_user_cards(user_id)


@user_card_router.get(
    "/{user_id}/cards/{user_card_id}",
    response_model=UserCardResponse,
)
def get_user_card(
    user_id: str,
    user_card_id: str,
    service: CardService = Depends(get_card_service),
):
    """사용자 보유 카드 단건 조회"""

    card = service.get_user_card(user_id, user_card_id)

    if card is None:
        raise HTTPException(
            status_code=404,
            detail="보유 카드를 찾을 수 없습니다.",
        )

    return card