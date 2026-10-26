
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_entities.card_entity import (
    CardProduct,
    UserCard,
    CardMonthClose,
    CardPerfMonthClose,
)


class CardRepository:
    """카드 관련 데이터 접근 계층"""

    def __init__(self, db: Session):
        self.db = db

    def get_product_by_id(
        self,
        product_id: str,
    ) -> CardProduct | None:
        """카드 상품 ID로 조회"""

        statement = select(CardProduct).where(
            CardProduct.product_id == product_id
        )

        return self.db.scalar(statement)

    def get_all_products(self) -> list[CardProduct]:
        """전체 카드 상품 조회"""

        statement = select(CardProduct).order_by(
            CardProduct.product_id
        )

        return list(self.db.scalars(statement).all())

    def get_user_card_by_id(
        self,
        user_card_id: str,
    ) -> UserCard | None:
        """사용자 카드 ID로 조회"""

        statement = select(UserCard).where(
            UserCard.user_card_id == user_card_id
        )

        return self.db.scalar(statement)

    def get_user_cards(
        self,
        user_id: str,
    ) -> list[UserCard]:
        """특정 사용자의 보유 카드 조회"""

        statement = (
            select(UserCard)
            .where(UserCard.user_id == user_id)
            .order_by(UserCard.user_card_id)
        )

        return list(self.db.scalars(statement).all())

    def get_month_close(
        self,
        user_card_id: str,
        base_month: str,
    ) -> CardMonthClose | None:
        """카드의 월별 이용 실적 조회"""

        statement = select(CardMonthClose).where(
            CardMonthClose.user_card_id == user_card_id,
            CardMonthClose.base_month == base_month,
        )

        return self.db.scalar(statement)

    def get_perf_month_close(
        self,
        user_card_id: str,
        base_month: str,
    ) -> list[CardPerfMonthClose]:
        """카드의 혜택 규칙별 월별 인정 실적 조회"""

        statement = (
            select(CardPerfMonthClose)
            .where(
                CardPerfMonthClose.user_card_id == user_card_id,
                CardPerfMonthClose.base_month == base_month,
            )
            .order_by(CardPerfMonthClose.rule_id)
        )

        return list(self.db.scalars(statement).all())