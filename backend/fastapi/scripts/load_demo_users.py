import argparse
import csv
import os
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "demo_users.csv"


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
