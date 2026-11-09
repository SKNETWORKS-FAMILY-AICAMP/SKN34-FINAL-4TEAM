"""기존 제안 API와 합성 Run 내부 경계를 조립한다."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.health.router import router as health_router
from app.generation.router import router as generation_router
from app.runs.router import router as runs_router
from app.runs.service import RunService


def create_app(*, run_service: RunService | None = None) -> FastAPI:
    """기존 API와 내부 Run 경계를 조립하고 주입된 합성 실행을 종료 정리한다."""
    @asynccontextmanager
    async def lifespan(application):
        try:
            yield
        finally:
            if run_service is not None:
                await run_service.close()

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
