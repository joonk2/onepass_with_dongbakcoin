from fastapi import FastAPI

from app.api.routes.health_router import router as health_router


app = FastAPI(
    title="Dongbaek OnePass API",
    version="1.0.0",
)

app.include_router(health_router)