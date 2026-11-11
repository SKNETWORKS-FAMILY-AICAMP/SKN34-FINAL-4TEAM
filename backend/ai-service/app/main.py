"""기존 제안 API와 작업별 위임을 검증하는 내부 Run 경계를 조립한다."""
import asyncio
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.health.router import router as health_router
from app.generation.router import router as generation_router
from app.runs.router import router as runs_router
from app.runs.service import RunService
from app.runs.remote_content import RemoteContent
from app.runs.checkpoints import configured_saver
from app.retrieval.ingestion import sync_public


def create_app(*, run_service: RunService | None = None) -> FastAPI:
    """기존 API와 내부 Run 경계를 조립하고 주입된 합성 실행을 종료 정리한다."""
    if run_service is None and os.environ.get("CONTENT_AI_RUN_BASE_URL"):
        run_service = RunService(RemoteContent(os.environ["CONTENT_AI_RUN_BASE_URL"], os.environ.get("INTERNAL_TOKEN", "")))

    @asynccontextmanager
    async def lifespan(application):
        async with configured_saver() as saver:
            application.state.checkpointer = saver
            if run_service is not None:
                run_service.checkpointer = saver
            indexer = None
            if os.environ.get("ELASTICSEARCH_URL") and run_service and isinstance(run_service.content, RemoteContent):
                indexer = asyncio.create_task(sync_public(run_service.content.base_url))
            try:
                yield
            finally:
                if indexer:
                    indexer.cancel()
                    await asyncio.gather(indexer, return_exceptions=True)
                if run_service is not None:
                    await run_service.close()
                    run_service.checkpointer = None
                application.state.checkpointer = None

    application = FastAPI(
        title="STORYFORK AI Service",
        description="STORYFORK Core API가 호출하는 내부 서비스 개발 기반",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.run_service = run_service

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # FastAPI 기본 오류의 input/context에 grant나 사용자 원문을 되돌려 보내지 않는다.
        if request.url.path.startswith("/internal/v1/ai/runs"):
            return JSONResponse(status_code=422, content={"detail": "invalid_request"})
        return await request_validation_exception_handler(request, error)

    application.include_router(health_router)
    application.include_router(generation_router)
    application.include_router(runs_router)
    return application
