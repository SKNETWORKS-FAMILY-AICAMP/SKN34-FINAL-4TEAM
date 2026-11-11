from fastapi import FastAPI

from app.health.router import router as health_router
from app.generation.router import router as generation_router
from app.manuscript.router import router as manuscript_router
from app.research.router import router as research_router


def create_app() -> FastAPI:
    """모델을 즉시 로드하지 않고 내부 API를 조립한다."""
    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
    )
    application.include_router(health_router)
    application.include_router(generation_router)
    application.include_router(manuscript_router)
    application.include_router(research_router)
    return application
