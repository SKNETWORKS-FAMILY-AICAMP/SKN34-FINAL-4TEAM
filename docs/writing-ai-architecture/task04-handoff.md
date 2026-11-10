# TASK 04 — 인수 기록 재구성

2026-11-10: 별도 인수 파일의 Git 이력은 발견하지 못했습니다. 기존 [검색 계약·구현 기록](07-retrieval-contract-and-mocks.md)의 해당 절을 그대로 보존해 재구성했습니다. 아래 검증·미연결·커밋 상태는 기록 당시의 내용이며 현재 재실행 결과가 아닙니다.

### TASK 04 구현 상태 — Coordinator·문맥 투영·Coverage

2026-11-09 로컬 구현. 브랜치 `feat/54-canonical-read-scope`, 시작 HEAD `6d86cc7`. TASK 02·03의 미커밋 파일과 문서 변경을 보존하면서 확장했다. develop 재기반·기존 API 교체는 하지 않았다.

| 파일 | 변경·동작 |
|---|---|
| [coordinator.py](../../backend/ai-service/app/retrieval/coordinator.py) | `RetrievalCoordinator`, `ContextPacket/ContextItem`, 경로 선택·async 병렬 실행·deadline·정본 재검증·중복 제거·예산/누락·확정 판정 보류 |
| [episode_wiki.py](../../backend/ai-service/app/retrieval/episode_wiki.py) | 질문 관련 top-k와 독립된 `coverage(query)` 전체 합성 색인 읽기 |
| [_mock.py](../../backend/ai-service/app/retrieval/_mock.py) | inventory 모드에서 회차 자체의 원문 근거를 유지한다. 일반 검색의 파생 경로 제거는 그대로 유지 |
| [test_retrieval_coordinator.py](../../backend/ai-service/tests/test_retrieval_coordinator.py) | 전체/부분 coverage·보안 격리·점수·인용·병렬 실행·캐시 키·projection·철회 단위 검사 |
| 이 문서·[기능표](../feature-roadmap.md) | 내부 호출 계약·검증 결과·한계를 기록. 서비스 흐름 완료 체크는 승격하지 않음 |

내부 `Query.operation`은 quote→원고, current→현재 관계, templates→카탈로그, review/full_context→Wiki+원고와 별도 전체 Wiki 조회, context→Wiki+원고다. search에서는 required_fields의 템플릿 필드→카탈로그, 장면/지식/사건 참조→Wiki, span/hash→원고 순으로 경로를 좁힌다. 알 수 없는 operation은 unsupported다. 이는 내부 읽기 계약이며 자연어 Router·Agent/DAG는 구현하지 않았다. 선택된 독립 검색은 `asyncio.gather`로 병렬 실행하고 각 호출은 남은 deadline으로 제한한다. 재시도·Mock 자동 대체·무한 재검색은 없다.

현재 Coordinator는 기존 합성 Content 대역 전용이다. source revision·문서/작품/Fork·허용 시점·인물 knownBy·UTF-16 span·UTF-8 hash와 실제 반환 본문을 Content에서 재확인한다. 한 Adapter에 범위 밖/위조 항목이 섞이면 성공분도 노출하지 않고 packet 전체를 denied로 폐기한다. 현재 관계/Catalog는 반환 직전 해당 공급자를 한 번 더 읽어 현재 CAS/라이선스와 일치하는지 확인한다. 현재 관계의 과거 복원은 계속 미지원이다. grants/Scope 원문은 ContextPacket에 포함하지 않고 scope digest만 기록한다.

전체 coverage는 manifest 중 요청 범위·허용 출처가 있는 회차를 분모로 삼으며, top-k를 분자로 쓰지 않는다. Mock Wiki의 별도 coverage는 유한한 주입 fixture를 한 번 전수 검증한다. 실 provider의 페이지/대용량 전체 확인 계약은 아직 구현하지 않았다. 정상 1~3화는 3/3, 2화 Wiki 누락은 2/3이다. 누락된 회차 범위와 그 누락을 원인으로 하는 다른 회차의 인과 경로 미확인은 구분한다. 회차 자체의 원문/색인 판본이 확인되어도 인과 참조가 없으면 critical gap을 남기므로 complete/확정 판정을 허용하지 않는다. 분모 0건도 complete로 표시하지 않는다. 필수 Wiki 장애·stale·disputed는 확정을 보류하고, 독립된 선택 자료 장애는 확보한 자료와 partial로 반환한다. can_conclude는 읽기 판단 가능성일 뿐 실제 저장 승인 권한이 아니다.

Evidence는 `(source kind/출처 문서, id, revision, span)`을 기준으로 중복 제거하며 원고의 동일 판본·동일 span은 chunk ID가 달라도 한 번만 담는다. 공급자 순서를 유지하고 cosine·rank 등 서로 다른 점수를 산술 합산하지 않는다. 같은 근거의 상태/주장이 상충하면 disputed와 conflict 참조를 남기고 확정을 보류한다. ContextItem은 요청한 필드만 투영하되 판본·hash·retrieval_type·canonical_status는 항상 포함한다. Agent에는 packet 전체가 아니라 context slice를 전달해야 한다. 사용량은 projection의 `exclude_none=True` JSON 기준 UTF-8 byte 상한이며 모델 tokenizer의 정확한 토큰 수는 아니다. 예산으로 제외된 ID를 기록하고 하위 공급자가 이미 제외해 ID를 모르면 확인 가능한 허용 회차 범위를 보수적으로 기록한다.

캐시 본문·관계 snapshot은 저장하지 않는다. `cache_key(query)`는 subject/grant/purpose/audience/character/work/fork/world/basis/manifest를 담은 Scope digest, 전체 Query와 index_generation을 결합한 SHA-256이다. 권한/철회는 매번 확인하므로 키가 같아도 이전 성공을 재사용하지 않는다. 실제 캐시 도입에는 Content의 grant epoch·삭제/철회 전파 계약이 먼저 필요하다.

근거는 [02 실행·실패 제어](02-ai-architecture.md), [03 Coverage 판정과 ContextPacket](03-rag-simulation-design.md), [06 결정 7·10·15](06-design-decisions.md), 이 문서의 입력/반환·정규화 계약과 DEC-36·37·41이다. [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56)(kyo-135), [#125](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/125)(담당 미지정)를 다시 조회했으며 모두 open이었다. 실제 내부 인증/위임·Studio 연결의 #163/#109 결정은 여전히 대기다.

검증은 AI 서비스 디렉터리에서 선택 단위만 실행했다.

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_retrieval_coordinator.py tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py tests/test_generation.py
```

결과: **152 passed, 1 deselected**(TASK 04 25개 + 기존 127개, HTTP 통합 1개 제외). 모듈 부재 Red를 먼저 확인했고 예산 누락 기록·인과 critical gap의 추가 실패를 확인한 뒤 수정했다. 회차 색인 누락과 인과 참조 누락의 missing_ranges를 분리해 회귀를 통과했다. 테스트는 sandbox 기본 asyncio 대기 문제 때문에 승인된 호스트 실행으로 수행했으며 Event 기반 양방향 대기 테스트로 독립 경로의 실제 중첩 실행을 확인했다. 외부 모델/DB/검색기 호출은 없었다. `uv run --offline --no-cache --locked --extra dev ...`는 Python 3.11을 찾지 못해 실패했고 설치된 Python으로 검사했다. locked 환경 재현은 대기다.

`ponytail-review` 자체 점검을 수행했으며 검색 DB·LangGraph·캐시 저장 계층·새 의존성을 추가하지 않았다. CodeRabbit 외부 리뷰는 설치 출처 미확인으로 미실행이다. 통합·시스템·브라우저·전체 suite·빌드·실 검색 품질/성능 평가는 미실행이다. production 의존성·lockfile·설정·DB/DDL·실제 provider/유료 호출·원고 적용은 변경/실행하지 않았다. Mock 근거는 모두 is_mock=true이며 실제 원고에 적용할 수 없다.

제안 커밋: `feat: 검색 문맥 조립과 전체 회차 근거 검증 구현`(#56·#125). 기존 미커밋분과 함께 작업 트리에 남기며 새 로컬 커밋·push·PR·배포는 하지 않았다. TASK 05는 새 요청 시 착수 가능하고 자동 시작하지 않는다. 실제 연결/캐시는 Content 위임·인덱스 세대·삭제 전파 계약 확정 후 별도 단계에서 진행하는 것을 추천하며, 그전에는 현재 합성 대역과 매 요청 재검증을 유지한다.
