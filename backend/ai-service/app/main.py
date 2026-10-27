from fastapi import FastAPI

from app.health.router import router as health_router


def create_app() -> FastAPI:
    """키나 모델 클라이언트 없이 내부 상태 확인 API만 조립한다."""
    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
    )
    application.include_router(health_router)
    return application
