from app.db_entities.card_entity import CardProduct
from app.repositories.card_repository import CardRepository
from app.db_entities.card_entity import UserCard
from app.repositories.user_repository import UserRepository
from app.services.card_registration_policy import is_registrable_product
import calendar
from datetime import date
from uuid import uuid4


class InvalidCardDetailError(ValueError):
    """카드 상세 입력값이 올바르지 않을 때 발생"""


class DuplicateCardError(ValueError):
    """이미 활성 상태로 등록된 카드를 다시 등록할 때 발생"""




class CardService:
    """카드 관련 비즈니스 로직"""

    def __init__(
        self,
        repository: CardRepository,
        user_repository: UserRepository | None = None,
    ):
        self.repository = repository
        self.user_repository = user_repository


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



    # --------- 사용자 보유 카드 등록 ------------
    def create_user_card(
        self,
        user_id: str,
        product_id: str,
        card_number: str | None = None,
        card_cvc: str | None = None,
        expiry_month: int | None = None,
        expiry_year: int | None = None,
        prev_month_spend_won: int | None = None,
    ) -> UserCard:
        """사용자 존재 여부와 카드 상품을 확인한 후 등록"""

        if self.user_repository is None:
            raise RuntimeError(
                "카드 등록에 필요한 UserRepository가 연결되지 않았습니다."
            )

        user = self.user_repository.get_user_by_id(user_id)

        if user is None:
            raise ValueError("사용자를 찾을 수 없습니다.")

        product = self.repository.get_product_by_id(product_id)

        if product is None:
            raise ValueError("카드 상품을 찾을 수 없습니다.")

        if not is_registrable_product(product_id, product.card_type):
            raise InvalidCardDetailError("등록할 수 없는 카드 상품입니다.")

        if any(
            card.product_id == product_id
            for card in self.repository.get_user_cards(user_id)
        ):
            raise DuplicateCardError("이미 등록된 카드입니다.")

        expires_at = None
        if expiry_month is not None and expiry_year is not None:
            last_day = calendar.monthrange(expiry_year, expiry_month)[1]
            expires_at = date(expiry_year, expiry_month, last_day)
            if expires_at < date.today():
                raise InvalidCardDetailError("유효기간이 지난 카드는 등록할 수 없습니다.")

        user_card = UserCard(
            user_card_id=str(uuid4()),
            user_id=user_id,
            product_id=product_id,
            card_status="ACTIVE",
            expires_at=expires_at,
        )
        # 카드번호·CVC·전월실적은 요청 검증만 하고, 운영 DB에 해당 열이 생기기 전에는 저장하지 않는다.
        del card_number, card_cvc, prev_month_spend_won

        return self.repository.create_user_card(user_card)




    # --------- 사용자 등록 카드 삭제 ------------
    def deactivate_user_card(
        self,
        user_id: str,
        user_card_id: str,
    ) -> bool:
        """사용자 등록 카드 삭제"""

        card = self.get_user_card(user_id, user_card_id)

        if card is None:
            return False

        if card.card_status != "ACTIVE":
            return False

        self.repository.deactivate_user_card(card)

        return True








    # --------- 사용자 카드 우선순위 조회 ------------
    def get_card_priorities(
        self,
        user_id: str,
    ) -> list[UserCard]:
        """활성 카드 목록을 우선순위 순으로 반환"""

        cards = self.repository.get_user_cards(user_id)

        return sorted(
            cards,
            key=lambda card: (
                card.default_preference_rank is None,
                card.default_preference_rank
                if card.default_preference_rank is not None
                else 0,
                card.user_card_id,
            ),
        )

    # --------- 사용자 카드 우선순위 변경 ------------
    def update_card_priorities(
        self,
        user_id: str,
        priorities: dict[str, int],
    ) -> list[UserCard]:
        """사용자의 모든 활성 카드 우선순위 변경"""

        cards = self.repository.get_user_cards(user_id)

        if not cards:
            raise ValueError("우선순위를 설정할 활성 카드가 없습니다.")

        active_card_ids = {
            card.user_card_id for card in cards
        }

        requested_card_ids = set(priorities)

        if active_card_ids != requested_card_ids:
            raise ValueError(
                "사용자의 모든 활성 카드를 포함해야 합니다."
            )

        expected_ranks = set(range(1, len(cards) + 1))

        if set(priorities.values()) != expected_ranks:
            raise ValueError(
                "우선순위는 1부터 카드 수까지 연속된 숫자여야 합니다."
            )

        updated_cards = self.repository.update_card_priorities(
            cards=cards,
            priorities=priorities,
        )

        return sorted(
            updated_cards,
            key=lambda card: card.default_preference_rank,
        )