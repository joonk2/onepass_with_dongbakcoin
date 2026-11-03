BEGIN;

INSERT INTO user_card (
    user_card_id,
    user_id,
    product_id,
    db_wallet_id,
    card_status,
    default_preference_rank
)
SELECT 'DEMO_USER_CARD_001_DB', 'USER_001', 'PRD_DB_SYN', w.wallet_id, 'ACTIVE', 3
FROM db_wallet w
WHERE w.wallet_id = 'WALLET_USER_001'
  AND w.user_id = 'USER_001'
  AND EXISTS (SELECT 1 FROM card_product WHERE product_id = 'PRD_DB_SYN')
ON CONFLICT (user_card_id) DO NOTHING;

COMMIT;
