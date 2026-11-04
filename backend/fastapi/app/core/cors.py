import os
from urllib.parse import urlparse

LOCAL_FRONTEND_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)
DEPLOYED_FRONTEND_ORIGINS = (
    "https://onepass-with-dongbakcoin-beta.vercel.app",
)


def _is_backend_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    host = (parsed.hostname or "").lower()
    if host.endswith(".onrender.com") or host == "onrender.com":
        return True
    if parsed.path not in ("", "/"):
        return True
    return False


def frontend_origins(configured: str | None = None) -> list[str]:
    """로컬·배포 프론트 Origin은 항상 포함한다. Render API 주소는 Origin으로 쓰지 않는다."""

    raw = os.getenv("FRONTEND_URL", "") if configured is None else configured
    extras: list[str] = []
    for part in raw.split(","):
        origin = part.strip().rstrip("/")
        if not origin or _is_backend_origin(origin):
            continue
        extras.append(origin)

    merged: list[str] = []
    seen: set[str] = set()
    for origin in (*LOCAL_FRONTEND_ORIGINS, *DEPLOYED_FRONTEND_ORIGINS, *extras):
        if origin in seen:
            continue
        seen.add(origin)
        merged.append(origin)
    return merged
