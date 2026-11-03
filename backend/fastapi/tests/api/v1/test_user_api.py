from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import URL
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
from app.schemas.user_schema import (
    UserProfileUpdateRequest,
    WalletTopUpRequest,
)
from app.services.user_service import (
    DuplicateTopUpError,
    UserService,
)
from scripts.load_demo_users import load_demo_users


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
            student_card_id="DEMO-STUDENT-0001",
            phone_number="010-0000-0000",
            address="부산광역시 (데모 주소)",
            source_mode="SYNTHETIC",
        )
    )
    db.add(
        DbWallet(
            wallet_id="WALLET_USER_001",
            user_id="USER_001",
            charge_won=30_000,
            cashback_won=1_000,
            policy_support_won=2_000,
            wallet_status="ACTIVE",
            origin_type="SYNTHETIC",
        )
    )
    db.commit()


def test_profile_get_and_update():
    engine, session_factory = create_database()
    try:
        with session_factory() as db:
            seed_user(db)
            service = UserService(db)
            profile = service.get_profile("USER_001")
            assert profile.display_name == "김개미"
            assert profile.student_card_id == "DEMO-STUDENT-0001"

            updated = service.update_profile(
                "USER_001",
                UserProfileUpdateRequest(
                    display_name="김개미",
                    student_card_id="DEMO-STUDENT-0002",
                    phone_number="010-0000-0000",
                    address="부산광역시 (수정된 데모 주소)",
                ),
            )
            assert updated.student_card_id == "DEMO-STUDENT-0002"
            assert updated.address == "부산광역시 (수정된 데모 주소)"
    finally:
        engine.dispose()


def test_wallet_balance_and_top_up_are_idempotent():
    engine, session_factory = create_database()
    try:
        with session_factory() as db:
            seed_user(db)
            service = UserService(db)
            before = service.get_wallet_balance("USER_001")
            assert before.balance_won == 33_000

            request = WalletTopUpRequest(
                request_id="topup-request-001",
                amount_won=10_000,
                wallet_id="WALLET_USER_001",
            )
            first = service.top_up("USER_001", request)
            second = service.top_up("USER_001", request)

            assert first.tx_id == second.tx_id
            assert first.balance_won == second.balance_won == 43_000
            assert service.get_wallet_balance("USER_001").balance_won == 43_000
            topups = db.scalars(
                select(Ledger).where(Ledger.event_type == "TOPUP")
            ).all()
            assert len(topups) == 1
            assert topups[0].source_mode == "MOCK"
    finally:
        engine.dispose()


def test_reused_top_up_request_id_with_different_amount_conflicts():
    engine, session_factory = create_database()
    try:
        with session_factory() as db:
            seed_user(db)
            service = UserService(db)
            service.top_up(
                "USER_001",
                WalletTopUpRequest(
                    request_id="topup-request-002",
                    amount_won=5_000,
                    wallet_id="WALLET_USER_001",
                ),
            )
            try:
                service.top_up(
                    "USER_001",
                    WalletTopUpRequest(
                        request_id="topup-request-002",
                        amount_won=6_000,
                        wallet_id="WALLET_USER_001",
                    ),
                )
            except DuplicateTopUpError:
                pass
            else:
                raise AssertionError("Expected conflicting request ID to fail")

            assert service.get_wallet_balance("USER_001").balance_won == 38_000
    finally:
        engine.dispose()


def test_user_profile_and_wallet_routes():
    engine, session_factory = create_database()
    try:
        with session_factory() as db:
            seed_user(db)
            service = UserService(db)
            app = FastAPI()
            app.include_router(router, prefix="/api/v1")
            app.dependency_overrides[get_user_service] = lambda: service

            with TestClient(app) as client:
                profile = client.get("/api/v1/users/USER_001/profile")
                wallet = client.get("/api/v1/users/USER_001/wallet")
                top_up = client.post(
                    "/api/v1/users/USER_001/wallet/top-ups",
                    json={
                        "request_id": "topup-route-001",
                        "amount_won": 1_000,
                        "wallet_id": "WALLET_USER_001",
                    },
                )
                invalid_top_up = client.post(
                    "/api/v1/users/USER_001/wallet/top-ups",
                    json={
                        "request_id": "topup-route-002",
                        "amount_won": 500_001,
                    },
                )

            assert profile.status_code == 200
            assert profile.json()["display_name"] == "김개미"
            assert wallet.status_code == 200
            assert wallet.json()["balance_won"] == 33_000
            assert top_up.status_code == 200
            assert top_up.json()["source_mode"] == "MOCK"
            assert invalid_top_up.status_code == 422
    finally:
        engine.dispose()


def test_synthetic_csv_loader_is_idempotent_for_local_databases(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    database_url = URL.create(
        "sqlite",
        database=str(tmp_path / "demo-seed.db"),
    ).render_as_string(hide_password=False)
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    CREATE TABLE "user" (
                        user_id TEXT PRIMARY KEY,
                        user_type TEXT,
                        origin_type TEXT,
                        user_status TEXT
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    CREATE TABLE db_wallet (
                        wallet_id TEXT PRIMARY KEY,
                        user_id TEXT REFERENCES "user"(user_id),
                        charge_won INTEGER,
                        cashback_won INTEGER,
                        policy_support_won INTEGER,
                        wallet_status TEXT,
                        origin_type TEXT
                    )
                    """
                )
            )
            connection.execute(
                text(
                    """
                    CREATE TABLE ledger (
                        request_id TEXT,
                        event_type TEXT
                    )
                    """
                )
            )
            migration_path = (
                Path(__file__).resolve().parents[3]
                / "db"
                / "migrations"
                / "20261103_profile_wallet_demo.sql"
            )
            for statement in migration_path.read_text(encoding="utf-8").split(";"):
                statement = statement.strip()
                if statement and statement.upper() not in {"BEGIN", "COMMIT"}:
                    connection.execute(text(statement))
    finally:
        engine.dispose()

    monkeypatch.setenv("DATABASE_URL", database_url)
    assert load_demo_users(apply=True) == 1
    assert load_demo_users(apply=True) == 1

    with create_engine(database_url).connect() as connection:
        profile = connection.execute(
            text("SELECT display_name, source_mode FROM user_profile WHERE user_id = 'USER_001'")
        ).one()
        wallet = connection.execute(
            text("SELECT charge_won FROM db_wallet WHERE wallet_id = 'WALLET_USER_001'")
        ).scalar_one()
    assert profile == ("김개미", "SYNTHETIC")
    assert wallet == 30_000


def test_synthetic_csv_loader_blocks_remote_database_by_default(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://demo:password@example.invalid/demo",
    )
    with pytest.raises(RuntimeError, match="restricted to a local database"):
        load_demo_users(apply=True)
