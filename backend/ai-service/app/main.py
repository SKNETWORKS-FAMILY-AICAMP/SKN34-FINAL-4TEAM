from fastapi import FastAPI

from app.health.router import router as health_router
from app.generation.router import router as generation_router
from app.initial_world.router import router as initial_world_router
from app.manuscript.router import router as manuscript_router
from app.orchestration import service as orchestration
from app.orchestration.router import router as orchestration_router
from app.preprocessing.router import router as preprocessing_router
from app.research.router import router as research_router
from app.writing.router import router as writing_router


def create_app() -> FastAPI:
    """시작 시 모델 호출 없이 내부 상태·이어쓰기·초기 세계관·원고·전처리 접수 API를 조립한다."""
    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
        lifespan=orchestration.lifespan,
    )
    application.include_router(health_router)
    application.include_router(generation_router)
    application.include_router(initial_world_router)
    application.include_router(manuscript_router)
    application.include_router(orchestration_router)
    application.include_router(preprocessing_router)
    application.include_router(research_router)
    application.include_router(writing_router)
    return application
