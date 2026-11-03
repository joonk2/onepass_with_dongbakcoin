# Frontend API integration

The Next.js frontend calls FastAPI through same-origin Route Handlers. The
browser only requests `/api/v1/...`; `BACKEND_URL` is read by the Next.js
server and must include the `/api/v1` prefix.

## Local development with Neon

The FastAPI backend is already deployed on Render; a local FastAPI process is
not required. Keep the Render origin in the repository-root `.env`:

```dotenv
BACKEND_URL=https://onepass-with-dongbakcoin.onrender.com
```

The script also accepts a value that already ends with `/api/v1`. Start
Next.js from the `frontend` directory using the usual command:

```text
npm run dev
```

The npm script invokes the PowerShell startup helper. Render is the default
target, and `/api/v1` is added when omitted. The helper reads and passes only
`BACKEND_URL` to Next.js. The Neon `DATABASE_URL` remains on the Render FastAPI
service and is never passed to Next.js or the browser. Do not create a frontend
`.env` file for backend configuration.

To intentionally use a local FastAPI server at
`http://127.0.0.1:8000/api/v1`, run
`.\scripts\dev-frontend.ps1 -Backend local` from the repository root. The
separate `.\scripts\dev-backend.ps1` helper is optional for that local-backend
mode; it passes only `DATABASE_URL` to FastAPI. Neither helper is needed to
connect to the already-deployed Render backend.

For local UI testing, `NEXT_PUBLIC_DEMO_USER_ID` supplies the assumed
signed-in user's stable database ID and defaults to `USER_001`. The UI shows
the profile display name returned by the API (the synthetic seed uses
`김개미`); the ID remains an internal foreign-key/API identifier. This does
not implement authentication.

The existing UI calls these FastAPI endpoints:

| Frontend feature | Backend endpoint |
| --- | --- |
| Card catalog | `GET /api/v1/cards/products` |
| Connected user cards | `GET /api/v1/users/{user_id}/cards` |
| Connect / disconnect a card | `POST /api/v1/users/{user_id}/cards`, `DELETE /api/v1/users/{user_id}/cards/{user_card_id}` |
| User profile and civic-service demo fields | `GET`, `PUT /api/v1/users/{user_id}/profile` |
| Wallet balance | `GET /api/v1/users/{user_id}/wallet` |
| Demo wallet top-up | `POST /api/v1/users/{user_id}/wallet/top-ups` |
| Merchant selection | `GET /api/v1/merchants?limit=100` |
| Card benefit details | `GET /api/v1/benefits/products/{product_id}` |
| Payment recommendation | `POST /api/v1/payments/recommend` |
| Demo payment approval | `POST /api/v1/payments` |
| Recent payment history | `GET /api/v1/users/{user_id}/payments` |

On the card management screen, `GET /users/{user_id}/cards` is displayed as
the user's connected cards. The card product catalog is shown separately as
products available to add, excluding products already connected to that user.
The user profile API returns display name, student-card ID, mobile number,
and address from the local profile record. Updating those fields stores demo
profile data only. It does not call an external student-card issuer, municipal
civic-service provider, mobile carrier, or address-verification service.

The wallet API aggregates the active user's `db_wallet` balance buckets.
Demo top-ups increase `charge_won` and write a `TOPUP` event to `ledger` in
one transaction. They do not charge a payment method or move real money.
Top-up requests are limited to 500,000 won, require a request ID, and are
protected against duplicate request IDs by a partial unique index. Deploy the
database migration before deploying the top-up API.

The existing user card endpoints already provide card management, and the
existing user payments endpoint provides recent payment history. The home
screen labels the latter “최근 결제 내역”; no separate “recent approval”
endpoint is added.

The current frontend uses the configured demo ID (`USER_001` by default), not
an authenticated session; real users will require identity verification and
authorization before any personal data or wallet operation is exposed.

## Profile and demo wallet database migration

The existing schema already contains `user`, `user_card`, `onecard`,
`db_wallet`, and `ledger`. Do not drop or recreate these tables. Apply
`backend/fastapi/db/migrations/20261103_profile_wallet_demo.sql` as an
additive migration to the intended PostgreSQL database before deploying the
new API. It creates a separate one-to-one `user_profile` table for display
name and contact/civic demo fields, plus the top-up idempotency index. It does
not alter or truncate existing user records.

`backend/fastapi/data/demo_users.csv` contains one clearly synthetic user
(`USER_001` / `김개미`), placeholder student-card and phone values, and a
demo-only address. The CSV loader refuses remote databases by default. To
load into a local database after applying the migration:

```powershell
cd backend\fastapi
$env:DATABASE_URL = "your-local-postgresql-url"
python scripts\load_demo_users.py --apply
```

Only if you intentionally choose to add this synthetic record to a remote
database after reviewing the target, pass both `--apply` and `--allow-remote`.
Do not put real personal information in the demo CSV or commit database
credentials. The migration and seed are not automatically run by the API
server.

The payment screen starts with no merchant or amount selected. It presents
card benefit recommendations as part of the payment flow, then calls the mock
payment endpoint only after the user enters an amount and selects a merchant.

The Route Handler allows only these paths and methods, validates merchant
pagination parameters, limits JSON request bodies, disables caching, and
applies a 10-second backend timeout. Recommendation and user-specific data are
never cached. The browser request client also disables caching and reports
network, timeout, HTTP, and malformed-JSON failures separately.

Run the API proxy/client tests with Node.js 24:

```powershell
cd frontend
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test tests\api-proxy-policy.test.mjs
```

## Security limitations

The current FastAPI OpenAPI document declares no authentication scheme, and
user-specific routes accept a caller-supplied `user_id`. The Route Handler is
an allowlisted same-origin proxy, not authentication or authorization. The
current integration is for local demo use only; it must not be treated as safe
for real users or public deployment until the backend verifies user identity
and ownership.

The mock payment API accepts `request_id` but its table has no unique
constraint for that value. Client-side double-click prevention and this
endpoint's current existence check do not guarantee concurrency-safe or
retry-safe payment idempotency.

## Confirmed API behavior

- Card products and benefits return arrays matching the FastAPI Pydantic
  response schemas.
- Merchants support `limit` (1–500) and `offset` (0 or greater); the current UI
  requests the first 100 and does not expose pagination.
- Payment history returns `{ "payments": [...] }`; the current service reads at
  most 100 records and does not expose pagination parameters.
- Card priority and category-priority endpoints exist in FastAPI, but the
  current UI has no priority controls and does not call them.
- Payment recommendation and mock payment are distinct endpoints. The latter
  writes a mock ledger event and does not initiate a real card charge.
