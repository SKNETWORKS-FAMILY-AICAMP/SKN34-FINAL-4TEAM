"""운영 정기 작업 실행 요청 DTO(계약 docs/design/operations-funnel-credit-contract.md §4). 접수 요청만 있다. 실행 기록·상태는 운영 서비스가 소유한다."""
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.preprocessing.models import JobId


class JobRunRequest(BaseModel):
    """운영 스케줄러가 접수시키는 작업 실행 한 건. runId는 운영 내부 호출 경로에 들어가므로 경로 문자를 허용하지 않는다(JobId)."""
    model_config = ConfigDict(extra='forbid')

    runId: JobId
    kind: Annotated[str, Field(pattern=r'^[a-z][a-z0-9_]{0,63}$')]  # 운영 정기 작업 종류(예: llm_alert_check). 종류의 뜻은 운영이 안다
