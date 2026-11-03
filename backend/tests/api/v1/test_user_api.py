from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.db_entities.benefit_entity
import app.db_entities.card_entity
import app.db_entities.category_entity
import app.db_entities.ledger_entity
import app.db_entities.merchant_entity
import app.db_entities.policy_entity
import app.db_entities.registration_entity
import app.db_entities.user_entity
from app.api.v1.routers.user_router import get_user_service, router
from app.core.database import Base
from app.db_entities.ledger_entity import Ledger
from app.db_entities.user_entity import DbWallet, User, UserProfile
from app.services.user_service import UserService


def create_database():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False)


def seed_user(db: Session) -> None:
    db.add(
        User(
            user_id="USER_001",
            user_type="SYNTHETIC",
            origin_type="SYNTHETIC",
            user_status="ACTIVE",
        )
    )
    db.add(
        UserProfile(
            user_id="USER_001",
            display_name="김개미",
            source_mode="SYNTHETIC",
        )
    )
    db.add(
        DbWallet(
            wallet_id="WALLET_USER_001",
            user_id="USER_001",
            charge_won=30_000,
            cashback_won=0,
            policy_support_won=0,
            wallet_status="ACTIVE",
            origin_type="SYNTHETIC",
        )
    )
    db.commit()


def test_profile_wallet_and_idempotent_top_up_api():
    engine, session_factory = create_database()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    try:
        with session_factory() as db:
            seed_user(db)
            service = UserService(db)
            app.dependency_overrides[get_user_service] = lambda: service
            with TestClient(app) as client:
                profile = client.get("/api/v1/users/USER_001/profile")
                wallet = client.get("/api/v1/users/USER_001/wallet")
                updated = client.put(
                    "/api/v1/users/USER_001/profile",
                    json={"display_name": "김개미", "address": "부산광역시"},
                )
                top_up_request = {
                    "request_id": "test-top-up-001",
                    "amount_won": 1,
                    "wallet_id": "WALLET_USER_001",
                }
                first_top_up = client.post(
                    "/api/v1/users/USER_001/wallet/top-ups",
                    json=top_up_request,
                )
                replayed_top_up = client.post(
                    "/api/v1/users/USER_001/wallet/top-ups",
                    json=top_up_request,
                )

        assert profile.status_code == 200
        assert profile.json()["display_name"] == "김개미"
        assert wallet.status_code == 200
        assert wallet.json()["balance_won"] == 30_000
        assert updated.status_code == 200
        assert updated.json()["address"] == "부산광역시"
        assert first_top_up.status_code == 200
        assert replayed_top_up.status_code == 200
        assert first_top_up.json()["tx_id"] == replayed_top_up.json()["tx_id"]
        assert replayed_top_up.json()["balance_won"] == 30_001
        with session_factory() as db:
            top_ups = db.scalars(
                select(Ledger).where(
                    Ledger.request_id == "test-top-up-001",
                    Ledger.event_type == "TOPUP",
                )
            ).all()
            assert len(top_ups) == 1
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
