from app.db_entities.card_entity import CardProduct
from app.repositories.card_repository import CardRepository
from app.db_entities.card_entity import UserCard



class CardService:
    """카드 관련 비즈니스 로직"""

    def __init__(self, repository: CardRepository):
        self.repository = repository


    # --------- 카드상품 조회 ------------
    def get_all_products(self) -> list[CardProduct]:
        return self.repository.get_all_products()

    def get_product_by_id(
        self,
        product_id: str,
    ) -> CardProduct | None:
        return self.repository.get_product_by_id(product_id)





    # --------- 사용자 보유 카드 조회 ------------
    def get_user_cards(self, user_id: str) -> list[UserCard]:
        """사용자 보유 카드 목록 조회"""
        return self.repository.get_user_cards(user_id)


    def get_user_card(
        self,
        user_id: str,
        user_card_id: str,
    ) -> UserCard | None:
        """사용자 소유 여부를 확인한 후 카드 조회"""

        card = self.repository.get_user_card_by_id(user_card_id)

        if card is None:
            return None

        if card.user_id != user_id:
            return None

        return card