# TASK 02 — 인수 기록 재구성

2026-11-10: 별도 인수 파일의 Git 이력은 발견하지 못했습니다. 기존 [검색 계약·구현 기록](07-retrieval-contract-and-mocks.md)의 해당 절을 그대로 보존해 재구성했습니다. 아래 검증·미연결·커밋 상태는 기록 당시의 내용이며 현재 재실행 결과가 아닙니다.

### TASK 02 구현 상태 — DTO·네 Port·합성 fixture

2026-11-09 로컬 구현. 시작 브랜치는 `feat/54-canonical-read-scope`, 기준 HEAD는 `6d86cc7`이며 시작 작업 트리는 clean이었다. 기존 TASK 01 위에 변경했으며 develop 재기반·기존 API 변경은 하지 않았다.

| 파일 | 구현 범위 |
|---|---|
| [contracts.py](../../backend/ai-service/app/retrieval/contracts.py) | Pydantic `Query/Evidence/Gap/Conflict/Coverage/RetrievalResult`, 비동기 `RetrievalPort`와 relationship/wiki/manuscript/template 네 Port |
| [story.json](../../backend/ai-service/tests/fixtures/story.json) | 합성 1~3화·카이/리나/암호·현재 관계·템플릿, 다른 작품/Fork·미래·비공개·stale/timeout/conflict/missing/unauthorized 변형 |
| [test_retrieval_contract.py](../../backend/ai-service/tests/test_retrieval_contract.py) | 공통 반환 스키마, mock 표시, coverage, UTF-16·UTF-8 SHA-256, 기존 Content 대역의 인가·판본·정확 인용 계약 |

`Scope`, `SourceVersion`, `CanonicalAdapter`, `MockContentReadPort`는 TASK 01 구현을 재사용한다. `CanonicalAdapter`는 contracts에서도 같은 클래스를 내보내며 중복 구현하지 않는다. Evidence의 `source_revision`은 기존 `SourceVersion`의 `(work_id, kind, document_id, revision)`을 보존한다. 템플릿 fixture의 `catalog` 출처 식별자는 합성 카탈로그 전용이며 Content 읽기 권한을 부여하지 않는다.

회차 범위는 양 끝 포함, 원문 span은 UTF-16 `[start,end)`이다. 점수와 score kind를 함께 요구하며 점수를 사실 확률로 바꾸지 않는다. `known_by=null`은 지식 미확인으로 보존한다. Coverage는 승인 manifest의 대상 회차별 항목을 누락 상태까지 담고, 개수·중복·요청 범위를 검증한다. 미완전 coverage나 gap이 있으면 `ok`를 거부한다. 정상 0건은 `ok`·빈 evidence이며, 실패 상태는 evidence를 담을 수 없다. mock evidence/coverage를 실제 결과로 표시할 수 없다.

TASK 02 완료 당시에는 네 Port의 구체 검색 구현·후보 필터·전체 응답 격리가 없었다(후속 TASK 03 상태는 아래 참조). 테스트의 I/O 없는 Stub은 같은 async 반환 계약만 확인하며, 인가 부정 사례는 실제 기존 합성 Content 대역으로 검증한다. DTO의 `verified_source` 값 자체는 검증 증명이 아니며, 소비자는 여전히 Content manifest/read로 모든 후보를 확인해야 한다. 결과를 모으는 Coordinator·Normalizer는 이번 단계에서 구현하지 않았다. Query에는 서버 Scope가 있으므로 모델 입력이나 로그로 DTO 전체를 직렬화하지 않는다.

설계 근거는 [05 구현 순서의 1단계](05-implementation-roadmap.md#구현-순서와-수용-기준), 이 문서의 입력·반환 규약 및 Fixture 절, DEC-36·37·41이다. [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56)(담당 kyo-135), [#125](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/125)(담당 미지정)는 2026-11-09 조회 당시 open이었다. #56의 종전 Core 읽기 표현에는 현재 Content 소유권을 적용했다.

검증은 `backend/ai-service`에서 다음 선택 단위만 실행했다.

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_retrieval_contract.py tests/test_canonical_read.py tests/test_generation.py
```

결과: **90 passed, 1 deselected**(TASK 02 48개 + 기존 42개, HTTP 통합 1개 제외). Red는 contracts 모듈 미구현과 미완전 coverage의 `ok` 허용 실패로 확인한 뒤 Green으로 전환했다. 표준 `uv run --locked --extra dev ...`는 sandbox의 uv interpreter cache 쓰기 권한 오류로 실패해 기존 설치 Python으로 실행했다. 따라서 locked 환경 재현 확인은 대기다. 기본 asyncio 이벤트 루프조차 이 환경에서 대기해 중단했으며, I/O 없는 async Stub의 반환 계약은 coroutine 완료 값으로 검사했다. 실제 비동기 I/O를 검증한 결과는 아니다.

`ponytail-review` 자체 점검에서 제거할 추가 계층·의존성은 없었다. CodeRabbit CLI는 발견했으나 설치 출처를 확인하지 못해 외부 리뷰는 실행하지 않았다. 통합·시스템·브라우저·빌드·실제 모델 품질/검색 성능 평가는 미실행이다. production 의존성·lockfile·설정·DB·서비스 등록·정본 데이터는 변경하지 않았다. 유료 호출·실 사용자 원고 전송은 없으며 합성 증거만 `is_mock=true`로 사용했다.

제안 커밋: `feat: 검색 DTO와 네 Port의 합성 계약 추가`(#56·#125). 새 로컬 커밋·push·PR·배포는 수행하지 않았다. TASK 03은 새 요청 시 착수 가능하지만 이번 작업에서는 시작하지 않는다. 실제 Content 전송·서비스 인증·위임 수명(#163)과 작품↔Studio 연결(#109)은 기존 결정 대기이며, 추천은 결정 전 합성 대역 유지다. 실제 연결은 계약 확정 후 별도 단계에서 진행한다. 관계 정본 읽기는 계속 `unsupported`다.
