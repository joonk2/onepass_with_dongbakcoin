from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.card_router import (
    router,
    user_card_router,
    get_card_service,
)


class FakeCardService:
    """테스트용 카드 서비스"""

    # 카드 상품 조회
    def get_all_products(self):
        return [
            {
                "product_id": "CARD_001",
                "product_name": "테스트 카드",
                "issuer": "테스트 카드사",
                "card_type": "CREDIT",
                "product_status": "ACTIVE",
            }
        ]

    def get_product_by_id(self, product_id: str):
        for product in self.get_all_products():
            if product["product_id"] == product_id:
                return product

        return None

    # 사용자 보유 카드 조회
    def get_user_cards(self, user_id: str):
        if user_id != "USER_001":
            return []

        return [
            {
                "user_card_id": "UC_001",
                "user_id": "USER_001",
                "product_id": "CARD_001",
                "card_status": "ACTIVE",
            }
        ]

    def get_user_card(
        self,
        user_id: str,
        user_card_id: str,
    ):
        for card in self.get_user_cards(user_id):
            if card["user_card_id"] == user_card_id:
                return card

        return None




def create_test_client():
    """테스트용 FastAPI 앱 생성"""

    app = FastAPI()

    # 카드 상품 조회 Router
    app.include_router(router)

    # 사용자 보유 카드 조회 Router
    app.include_router(user_card_router)

    # 실제 Service 대신 Fake Service 사용
    app.dependency_overrides[get_card_service] = (
        lambda: FakeCardService()
    )

    return TestClient(app)


# ========================================
# 7-1. 카드 상품 조회 API 테스트
# ========================================

def test_get_card_products():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/cards/products"
        )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["product_id"] == "CARD_001"


def test_get_card_product_by_id():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/cards/products/CARD_001"
        )

    assert response.status_code == 200
    assert response.json()["product_name"] == "테스트 카드"


def test_get_card_product_not_found():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/cards/products/NOT_FOUND"
        )

    assert response.status_code == 404


# ========================================
# 7-2. 사용자 보유 카드 조회 API 테스트
# ========================================

def test_get_user_cards():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/users/USER_001/cards"
        )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["user_card_id"] == "UC_001"


def test_get_user_card():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/users/USER_001/cards/UC_001"
        )

    assert response.status_code == 200
    assert response.json()["product_id"] == "CARD_001"


def test_get_user_card_not_found():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/users/USER_001/cards/NOT_FOUND"
        )

    assert response.status_code == 404


def test_cannot_get_other_users_card():
    with create_test_client() as client:
        response = client.get(
            "/api/v1/users/USER_002/cards/UC_001"
        )

    assert response.status_code == 404
