"""회차 원고 전처리 실행 틀(#343, DEC-50, 계약 docs/design/manuscript-preprocessing-contract.md의 6단계).

추출·정리·적재 본문은 아직 없다. 단계 함수를 차례로 부르며 Content 진행 API에 단계·진행·실패를 보고하는 틀만 있고,
첫 미구현 단계에서 '전처리 로직 미구현'으로 실패를 보고한다(작업 감시 화면이 실제 작업 기록을 읽게 하되 성공으로 꾸미지 않는다).
작업 상태·진행의 정본은 Content 작업 테이블이며 AI는 작업 DB를 쓰지 않는다.
"""
import logging
import os

import httpx

from app import tracing
from app.preprocessing.errors import ReportFailure
from app.preprocessing.models import JobRequest, Progress

log = logging.getLogger(__name__)

NOT_IMPLEMENTED = '전처리 로직 미구현'
EXTRACTION_FAILED = '회차 추출에 실패했어요.'
UNEXPECTED_ERROR = '전처리 중 오류가 발생했어요.'

# ponytail: 단계 입출력 구조(사건·호칭·정식 ID·카드)는 로직을 채울 때 models.py의 Pydantic DTO로 바꾼다. 지금은 구조를 못 박지 않고 dict·list로 둔다.


def extract_episode(job_id: str, number: int) -> dict:
    """계약 1단계 — 회차별 추출. 회차마다 독립이라 Celery로 옮길 때 병렬 작업 단위가 된다.

    입력: 작업 ID와 회차 번호. 원문은 Content 전처리 MCP 도구 preprocessing_episode_read(jobId, number)로 읽는다
    (그 회차 최신 저장 버전 {number, title, body}, 도구는 아직 없다).
    출력: 그 회차의 사건, 묘사(외모·성격·세계관 규칙처럼 사건이 아닌 서술), 등장한 호칭(인물·장소·물건·조직)을 원문 근거와 함께.
    호칭은 이 회차 안에서만 통하는 임시 ID를 받고 다른 회차의 같은 이름과 연결하지 않는다. LLM 호출은 회차당 1회다.
    입력·원고·모델 응답을 오류 메시지나 로그에 넣지 않는다.
    """
    raise NotImplementedError


def resolve_identities(extractions: list[dict]) -> dict:
    """계약 2단계 — 정체 정리. 추출이 모두 끝난 뒤 작품당 한 번 실행한다.

    입력: 1단계의 모든 회차 추출 결과(회차 번호 순서).
    출력: 호칭을 같은 대상끼리 묶은 정식 ID 묶음과 「동일 인물」 후보. 동명이인은 분리하고 같은 이름만으로 병합하지 않는다.
    같은 인물로 보이는 서로 다른 이름(별칭·가면·나중에 밝혀지는 정체)은 한 카드로 병합하지 않고 카드를 따로 둔 채
    {다른 이름 카드, 본체 카드, 같은 인물로 보이는 회차, 근거} 후보로 낸다(DEC-53). 후보를 관계로 올리는 것은 작가 승인이다.
    """
    raise NotImplementedError


def organize(extractions: list[dict], identities: dict) -> dict:
    """계약 3~5단계 — 사건 등록, 인물별 정리, 설정·아이템 정리. 1·2단계 결과만 읽는다.

    입력: 1단계 추출 결과와 2단계 정체 묶음(원문을 다시 읽지 않는다. 작가가 정체 묶음을 고치면 이 단계부터 다시 실행할 수 있다).
    출력: 적재할 cards[]·relations[]·identityCandidates[](계약 '전처리 MCP 도구' 절의 preprocessing_load 인자 모양).
    사건은 호칭을 정식 ID로 바꿔 회차 순서대로, 인물은 나온 사건·묘사를 모아 프로필·상태·기억(characterDocs)으로,
    장소·물건·조직은 같은 방식으로 정리한다. 카드는 공개 설정 없이(작가 전용) 싣고 firstEpisode는 제안값으로만 둔다(DEC-53).
    """
    raise NotImplementedError


def load(job_id: str, organized: dict) -> None:
    """계약 6단계 — 적재. 정리 결과를 Content MCP 도구 preprocessing_load(jobId, cards, relations, identityCandidates)로 적재한다.

    입력: 작업 ID와 3~5단계 결과. 출력: 없음(적재 결과로 Content가 작업을 completed로 바꾼다. 도구는 아직 없다).
    적재는 jobId로 멱등이어야 한다(같은 작업의 재호출이 카드를 중복 생성하지 않음). AI는 정본 DB에 직접 쓰지 않는다.
    """
    raise NotImplementedError


def report(job_id: str, progress: Progress) -> None:
    """Content 진행 갱신 API(POST /internal/v1/preprocessing-jobs/{id}/progress)로 단계·진행·실패를 알린다. 못 알리면 ReportFailure다."""
    base, token = os.environ.get('CONTENT_SERVICE_BASE_URL'), os.environ.get('INTERNAL_TOKEN')
    if not base or not token:
        raise ReportFailure('Content 진행 보고 설정이 필요합니다.')
    try:
        response = httpx.post(f'{base.rstrip("/")}/internal/v1/preprocessing-jobs/{job_id}/progress',
                              json=progress.model_dump(exclude_none=True), headers={'X-Internal-Token': token}, timeout=10)
    except httpx.HTTPError:
        raise ReportFailure('Content에 진행을 보고할 수 없습니다.') from None
    if response.status_code >= 400:
        raise ReportFailure(f'Content가 진행 보고를 거절했습니다({response.status_code}).')


# ponytail: 접수한 요청 프로세스의 BackgroundTasks에서 회차를 순차 실행한다(서버가 재시작하면 유실되고 병렬 처리가 없다). Celery(DEC-50)로 이전한다.
def run_job(request: JobRequest) -> None:
    """전처리 작업 하나를 계약 순서(추출 → 정체 정리 → 정리 → 적재)로 실행한다.

    단계마다 시작할 때 Content에 진행을 보고한다. 추출은 회차 하나가 실패해도 나머지를 이어서 하고, 실패 회차가 있으면 정리 전에
    실패 회차를 기록하고 멈춘다. 미구현 단계·예상 밖 오류는 고정 사유로 실패를 보고하며 원고·예외 메시지를 싣지 않는다.
    Content가 진행 보고를 받지 못하면(종료된 작업 등) 더 진행하지 않는다.
    """
    job, total = request.jobId, len(request.episodes)
    stage, done, failed = 'extracting', 0, []

    def send(reason: str | None = None) -> None:
        report(job, Progress(stage=stage, done=done, total=total, failedEpisodes=failed, failed=reason))

    with tracing.observe('preprocessing', as_type='chain', metadata={'feature': 'preprocessing'},
                         input={'jobId': job, 'workId': request.workId, 'episodes': total}) as span:
        reason = None
        try:
            send()
            extractions = []
            for number in request.episodes:
                try:
                    extractions.append(extract_episode(job, number))
                    done += 1
                except NotImplementedError:
                    raise
                except Exception:
                    failed.append(number)
                send()
            if failed:
                reason = EXTRACTION_FAILED
            else:
                stage = 'resolving'
                send()
                identities = resolve_identities(extractions)
                stage = 'organizing'
                send()
                organized = organize(extractions, identities)
                stage = 'loading'
                send()
                load(job, organized)
        except NotImplementedError:
            reason = NOT_IMPLEMENTED
        except ReportFailure:
            log.error('preprocessing job %s stopped: the progress could not be reported', job)
            span.update(level='ERROR', status_message='Content 진행 보고 실패')
        except Exception as error:
            log.error('preprocessing job %s failed in %s: %s', job, stage, type(error).__name__)
            reason = UNEXPECTED_ERROR
        if reason:
            span.update(level='ERROR', status_message=reason)
            try:
                send(reason)
            except ReportFailure:
                log.error('preprocessing job %s failed but the failure could not be reported', job)
