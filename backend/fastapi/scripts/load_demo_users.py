import argparse
import csv
import os
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "demo_users.csv"
PAYMENTS_FILE = Path(__file__).resolve().parents[1] / "data" / "demo_payments.csv"


def load_demo_users(apply: bool, allow_remote: bool = False) -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set.")

    parsed_url = make_url(database_url)
    is_local = (
        parsed_url.get_backend_name() == "sqlite"
        or parsed_url.host in {"localhost", "127.0.0.1", "::1"}
    )
    if not is_local and not allow_remote:
        raise RuntimeError("Demo seed loading is restricted to a local database.")
    if not apply:
        raise RuntimeError("Pass --apply to import the synthetic demo CSV.")

    with DATA_FILE.open(encoding="utf-8-sig", newline="") as csv_file:
        rows = list(csv.DictReader(csv_file))
    if not rows:
        raise RuntimeError("The demo CSV contains no users.")
    with PAYMENTS_FILE.open(encoding="utf-8-sig", newline="") as csv_file:
        payment_rows = list(csv.DictReader(csv_file))

    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            for row in rows:
                connection.execute(
                    text(
                        """
                        INSERT INTO "user" (
                            user_id, user_type, origin_type, user_status
                        ) VALUES (
                            :user_id, :user_type, :origin_type, :user_status
                        )
                        ON CONFLICT (user_id) DO NOTHING
                        """
                    ),
                    {
                        "user_id": row["user_id"],
                        "user_type": row["user_type"],
                        "origin_type": row["origin_type"],
                        "user_status": row["user_status"],
                    },
                )
                existing_user = connection.execute(
                    text(
                        """
                        SELECT user_type, origin_type
                        FROM "user"
                        WHERE user_id = :user_id
                        """
                    ),
                    {"user_id": row["user_id"]},
                ).one_or_none()
                if (
                    existing_user is None
                    or existing_user.user_type != "SYNTHETIC"
                    or existing_user.origin_type != "SYNTHETIC"
                ):
                    raise RuntimeError(
                        "Demo user ID conflicts with a non-synthetic user."
                    )

                connection.execute(
                    text(
                        """
                        INSERT INTO db_wallet (
                            wallet_id, user_id, charge_won, cashback_won,
                            policy_support_won, wallet_status, origin_type
                        ) VALUES (
                            :wallet_id, :user_id, :charge_won, :cashback_won,
                            :policy_support_won, 'ACTIVE', 'SYNTHETIC'
                        )
                        ON CONFLICT (wallet_id) DO NOTHING
                        """
                    ),
                    {
                        **row,
                        "charge_won": int(row["charge_won"]),
                        "cashback_won": int(row["cashback_won"]),
                        "policy_support_won": int(row["policy_support_won"]),
                    },
                )
                wallet_owner = connection.execute(
                    text(
                        """
                        SELECT user_id
                        FROM db_wallet
                        WHERE wallet_id = :wallet_id
                        """
                    ),
                    {"wallet_id": row["wallet_id"]},
                ).scalar_one_or_none()
                if wallet_owner != row["user_id"]:
                    raise RuntimeError(
                        "Demo wallet ID is already assigned to another user."
                    )

                connection.execute(
                    text(
                        """
                        INSERT INTO user_profile (
                            user_id, display_name, student_card_id, phone_number,
                            address, source_mode
                        ) VALUES (
                            :user_id, :display_name, :student_card_id, :phone_number,
                            :address, 'SYNTHETIC'
                        )
                        ON CONFLICT (user_id) DO NOTHING
                        """
                    ),
                    row,
                )
                product_exists = connection.execute(
                    text(
                        """
                        SELECT product_id
                        FROM card_product
                        WHERE product_id = :product_id
                        """
                    ),
                    {"product_id": row["product_id"]},
                ).scalar_one_or_none()
                if product_exists is None:
                    raise RuntimeError(
                        "Demo card product ID is not present in the database."
                    )

                credit_limit = int(row["credit_limit_won"])
                connection.execute(
                    text(
                        """
                        INSERT INTO user_card (
                            user_card_id, user_id, product_id, card_status,
                            credit_limit_won, default_preference_rank,
                            registered_ref
                        ) VALUES (
                            :user_card_id, :user_id, :product_id, 'ACTIVE',
                            :credit_limit_won, 1, 'SYNTHETIC_DEMO'
                        )
                        ON CONFLICT (user_card_id) DO NOTHING
                        """
                    ),
                    {
                        "user_card_id": row["user_card_id"],
                        "user_id": row["user_id"],
                        "product_id": row["product_id"],
                        "credit_limit_won": credit_limit,
                    },
                )
                existing_card = connection.execute(
                    text(
                        """
                        SELECT user_id, product_id, credit_limit_won
                        FROM user_card
                        WHERE user_card_id = :user_card_id
                        """
                    ),
                    {"user_card_id": row["user_card_id"]},
                ).one_or_none()
                if existing_card is None or tuple(existing_card) != (
                    row["user_id"],
                    row["product_id"],
                    credit_limit,
                ):
                    raise RuntimeError(
                        "Demo card ID conflicts with existing card data."
                    )

                for payment in payment_rows:
                    if (
                        payment["user_id"] != row["user_id"]
                        or payment["user_card_id"] != row["user_card_id"]
                    ):
                        continue

                    merchant_exists = connection.execute(
                        text(
                            """
                            SELECT merchant_id
                            FROM merchant
                            WHERE merchant_id = :merchant_id
                            """
                        ),
                        {"merchant_id": payment["merchant_id"]},
                    ).scalar_one_or_none()
                    if merchant_exists is None:
                        raise RuntimeError(
                            "Demo payment merchant ID is not present in the database."
                        )

                    amount = int(payment["amount_won"])
                    existing_payment = connection.execute(
                        text(
                            """
                            SELECT user_id, user_card_id, merchant_id,
                                   gross_purchase_won
                            FROM ledger
                            WHERE request_id = :request_id
                              AND event_type = 'PAYMENT'
                            """
                        ),
                        {"request_id": payment["request_id"]},
                    ).one_or_none()
                    expected_payment = (
                        payment["user_id"],
                        payment["user_card_id"],
                        payment["merchant_id"],
                        amount,
                    )
                    if existing_payment is not None:
                        if tuple(existing_payment) != expected_payment:
                            raise RuntimeError(
                                "Demo payment request ID conflicts with existing data."
                            )
                        continue

                    connection.execute(
                        text(
                            """
                            INSERT INTO ledger (
                                tx_id, request_id, user_id, user_card_id,
                                merchant_id, event_at, event_seq, event_type,
                                bucket_type, delta_won, gross_purchase_won,
                                awarded_benefit_won, approval_status,
                                source_mode, event_note
                            ) VALUES (
                                :tx_id, :request_id, :user_id, :user_card_id,
                                :merchant_id, :event_at, 1, 'PAYMENT', 'NONE',
                                :delta_won, :gross_purchase_won, 0,
                                'APPROVED', 'MOCK',
                                'Synthetic demo payment; no real payment was processed.'
                            )
                            """
                        ),
                        {
                            "tx_id": f"DEMO_TX_{payment['request_id']}",
                            "request_id": payment["request_id"],
                            "user_id": payment["user_id"],
                            "user_card_id": payment["user_card_id"],
                            "merchant_id": payment["merchant_id"],
                            "event_at": datetime.now()
                            - timedelta(days=int(payment["days_ago"])),
                            "delta_won": -amount,
                            "gross_purchase_won": amount,
                        },
                    )
    finally:
        engine.dispose()

    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Load only synthetic demo users into a local database."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the CSV to the configured database.",
    )
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Explicitly allow the synthetic seed to be applied to a remote database.",
    )
    args = parser.parse_args()
    count = load_demo_users(args.apply, args.allow_remote)
    print(f"Loaded {count} synthetic demo user(s).")


if __name__ == "__main__":
    main()
