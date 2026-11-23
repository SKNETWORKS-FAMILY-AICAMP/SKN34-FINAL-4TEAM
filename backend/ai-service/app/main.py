from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import tracing
from app.evaluation.router import router as evaluation_router
from app.health.router import router as health_router
from app.generation.router import router as generation_router
from app.initial_world.router import router as initial_world_router
from app.jobs.router import router as jobs_router
from app.story_qa.router import router as story_qa_router
from app.orchestration import service as orchestration
from app.orchestration.router import router as orchestration_router
from app.preprocessing.router import router as preprocessing_router
from app.rating.router import router as rating_router
from app.research.router import router as research_router
from app.serial.router import router as serial_router
from app.manuscript_review.router import router as manuscript_review_router
from app.work_tags.router import router as work_tags_router
from app.world_review.router import router as world_review_router
from app.writing.router import router as writing_router


@asynccontextmanager
async def lifespan(application: FastAPI):
    """대화 체크포인트를 열고 닫은 뒤 아직 보내지 않은 추적 span을 보낸다.

    SDK의 종료 훅(atexit)에 맡기면 안 된다: uvicorn은 SIGTERM으로 정상 종료한 뒤 그 시그널을 다시 올려 프로세스를 끝내므로
    (컨테이너는 init: true) atexit이 돌지 않아, 요청 뒤 SDK 전송 주기(5초) 안에 재시작하면 마지막 요청의 trace가 사라진다.
    """
    try:
        async with orchestration.lifespan(application):
            yield
    finally:
        tracing.client().flush()


def create_app() -> FastAPI:
    """시작 시 모델 호출 없이 내부 상태·이어쓰기·초기 세계관·원고 API를 조립한다."""
    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.include_router(health_router)
    application.include_router(evaluation_router)
    application.include_router(generation_router)
    application.include_router(initial_world_router)
    application.include_router(jobs_router)
    application.include_router(story_qa_router)
    application.include_router(orchestration_router)
    application.include_router(preprocessing_router)
    application.include_router(rating_router)
    application.include_router(research_router)
    application.include_router(serial_router)
    application.include_router(manuscript_review_router)
    application.include_router(work_tags_router)
    application.include_router(world_review_router)
    application.include_router(writing_router)
    return application
