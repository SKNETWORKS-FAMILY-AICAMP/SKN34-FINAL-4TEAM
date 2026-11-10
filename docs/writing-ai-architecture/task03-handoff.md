# TASK 03 — 인수 기록 재구성

2026-11-10: 별도 인수 파일의 Git 이력은 발견하지 못했습니다. 기존 [검색 계약·구현 기록](07-retrieval-contract-and-mocks.md)의 해당 절을 그대로 보존해 재구성했습니다. 아래 검증·미연결·커밋 상태는 기록 당시의 내용이며 현재 재실행 결과가 아닙니다.

### TASK 03 구현 상태 — 네 합성 검색기

2026-11-09 로컬 구현. 시작 브랜치는 `feat/54-canonical-read-scope`, HEAD는 `6d86cc7`이다. 시작 시 TASK 02의 `contracts.py`, `test_retrieval_contract.py`, `tests/fixtures/story.json`과 이 문서·기능표가 미커밋 상태였으며 그대로 보존·확장했다. develop 재기반이나 다른 변경 덮어쓰기는 하지 않았다.

| 파일 | 동작·범위 |
|---|---|
| [relationships.py](../../backend/ai-service/app/retrieval/relationships.py) | `RelationshipGraphRetriever`와 명시 주입한 합성 `MockRelationshipGraph`. 같은 Content Scope·작품·world에 바인딩한 작가 개인의 현재 보기만 지원. 허용 카드 양 끝·방향·라벨·현재 CAS token을 보존하고 history/snapshot/회차 제한 조회는 unsupported |
| [episode_wiki.py](../../backend/ai-service/app/retrieval/episode_wiki.py) | `EpisodeWikiRetriever`. 회차·장면·사건·지식 습득·복선의 합성 Evidence와 판본·인과 참조를 보존. 누락/stale/비허용 출처를 참조한 파생 경로도 제거하고 partial로 구분 |
| [manuscript.py](../../backend/ai-service/app/retrieval/manuscript.py) | `ManuscriptVectorRetriever`. 미리 분할한 합성 문단 chunk를 작품/Fork·문서·종류(manuscript/draft/conti)·회차·revision으로 필터링한 뒤 Content의 UTF-16 구간·UTF-8 SHA-256 확인. 다른 회차로 span을 확장하지 않음 |
| [templates.py](../../backend/ai-service/app/retrieval/templates.py) | `TemplateVectorRetriever`. 서버가 명시한 허용 라이선스와 공개·활성/만료·언어·장르를 검사하는 별도 카탈로그. Evidence의 work/fork/document ID는 null. 반환 직전 철회·권리 변경도 폐기 |
| [_mock.py](../../backend/ai-service/app/retrieval/_mock.py), [contracts.py](../../backend/ai-service/app/retrieval/contracts.py), [fixture](../../backend/ai-service/tests/fixtures/story.json), [단위 테스트](../../backend/ai-service/tests/test_mock_retrievers.py) | Mock 전용 공통 인가·정확 인용·고정 순위/상한, Query의 선택적 source_kinds/language/genre, 명시적 합성 Studio 연결·언어/권리 메타데이터, 부정/회귀 계약 |

모든 결과·Evidence는 `is_mock=true`다. 이 표시는 실제 원고 적용 금지이며 `apply` 등 쓰기 작업은 unsupported다. 실행 router·실제 Content 적용 경로에 등록하지 않았다. 기존 CanonicalAdapter의 현재/과거 관계 읽기는 여전히 unsupported다. 합성 관계 binding은 #109의 실제 작품↔Studio 계약이나 #163의 실제 전송·서비스 인증·위임 수명을 확정하지 않는다.

Mock의 검색어는 검증된 발췌의 대소문자 무시 부분 문자열로 비교하고, fixture rank→ID 순서로 재현한다. Wiki의 `scene_id`, JSON 문자열인 `fact_or_relation`의 kind/fact/actor, `evidence_refs`의 노드 ID로 장면·지식·인과를 보존한다. 추론·disputed 표시는 그대로 유지하며 진실로 승격하지 않는다. 실제 semantic/Vector 검색, Wiki 추출이나 원고 chunk 생성기는 구현하지 않았다. Wiki의 missing/stale gap은 요청 문서·회차 범위 안에서만 기록하며 전체 Coverage 집계는 TASK 04에 남긴다.

검색 corpus에 있는 다른 작품·미래·비공개 행은 Content manifest로 사전 제외한다. 허용된 출처와 응답의 work/fork/document/회차 메타데이터가 모순되거나 span/hash가 위조된 경우에는 성공분을 포함한 응답 전체를 denied로 폐기한다. 반환 본문은 후보의 캐시 문자열을 사용하지 않고 Content 정확 조회 결과로 교체한다. 인물 known_by·공개 범위도 합성 Content 행에서 얻는다. 시작·정확 조회·반환 직전에 위임과 manifest를 재확인하며 캐시·원문 로그는 만들지 않는다.

`top_k`와 deadline은 검사한다. Mock의 `token_budget`은 본문·관계/사실 문자열의 UTF-8 byte 수를 상한으로 쓰는 보수적 대역이며 정확한 모델 토큰 수나 metadata를 포함한 전체 ContextPacket 예산이 아니다. 상한 초과·필수 필드 부족은 unverified gap/partial, 알 수 없는 필수 필드·작업은 unsupported, timeout/전송 실패는 unavailable다. 실제 tokenizer·통합 예산은 모델/Coordinator 단계에서 연결한다.

설계 근거는 [05 구현 순서 1단계](05-implementation-roadmap.md#구현-순서와-수용-기준), 이 문서의 입력/반환 규약·네 Adapter 책임·Fixture 절, DEC-36·37·41과 [#132 현재 관계 계약](../design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)이다. [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56)(kyo-135), [#125](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/125)(담당 미지정)를 다시 조회했으며 모두 open이었다. 실제 소유권은 #56의 종전 Core 표현보다 현재 Content 서비스 경계를 따른다.

`backend/ai-service`에서 다음 선택 단위를 실행했다.

```powershell
python -B -m pytest -p no:cacheprovider -o addopts= -q -m 'not integration' tests/test_mock_retrievers.py tests/test_retrieval_contract.py tests/test_canonical_read.py tests/test_generation.py
```

결과: **127 passed, 1 deselected**(TASK 03 37개 + 기존 90개, HTTP 통합 1개 제외). Red는 검색 모듈 부재, 요청 밖 원고까지 읽는 prefilter 부재, 반환 중 템플릿 철회 미반영, 요청 밖 Wiki 누락 gap으로 확인한 뒤 Green으로 바꿨다. 권한 철회/만료/주체 교체, 타 Fork/미래/비공개·인물 지식, old revision·누락 의존 경로, timeout, 라이선스 철회/만료, 캐시 오염·조회 후 변경, 방향·CAS·정확 span을 검증했다. 네 검색기의 공통 계약 검사에 실제 네 구현체를 사용했고 소켓 생성/연결 spy로 외부 네트워크 호출 0회를 확인했다.

`uv run --offline --no-cache --locked --extra dev ...`도 interpreter 임시 cache 쓰기 권한 오류로 실패했다. 기존 설치 Python으로 단위를 실행했으므로 locked 환경 재현은 대기다. I/O 없는 async 검색은 coroutine 완료 값으로 검사했으며 실제 비동기 네트워크 실행의 증거는 아니다. 로컬 통합·시스템·브라우저·전체 suite·빌드·실 모델/DB 평가와 CodeRabbit 외부 리뷰(설치 출처 미확인)는 미실행이다. `ponytail-review` 자체 점검으로 중복된 템플릿 선택 ID 집합 계산을 루프 밖으로 옮겼으며 추가 계층·의존성은 도입하지 않았다.

production 의존성·lockfile·설정·정본 DB·Neo4j·인덱스·실제 provider 호출/인프라 설치·유료 호출·실 사용자 원고 전송은 모두 0건이다. 실제 품질/recall/부하·권리 계약이 검증된 것은 아니다. 권한 밖 노출 방지와 Mock 계약의 단위 증거로만 해석한다.

제안 커밋: `feat: 네 합성 검색기의 범위와 근거 검증 구현`(#56·#125). TASK 02 미커밋분과 이번 변경은 작업 트리에 남기고 새 로컬 커밋·push·PR·배포는 하지 않았다. 다음 TASK 04는 새 요청 시 착수 가능하며 자동 시작하지 않는다. 추천은 실제 연결 결정 전 합성 대역 유지이고, 대안인 실제 Content/검색기 연결은 #109/#163·권리·환경 계약 확정 후 별도 승인 단계에서 수행한다.
