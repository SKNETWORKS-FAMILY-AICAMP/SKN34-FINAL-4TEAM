import os
from fastapi import FastAPI

from app.health.router import router as health_router


def create_app() -> FastAPI:
    """Health는 키 없이 조립하고 분석 라우트는 명시적으로 켰을 때만 등록한다."""
    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
    )
    application.include_router(health_router)
    if os.environ.get("WORLD_STUDIO_AI_ENABLED") == "true":
        from app.world_wiki.knowledge import initial_knowledge
        application.add_api_route("/internal/v1/initial-world-knowledge", initial_knowledge, methods=["POST"])
    return application
