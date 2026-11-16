# 회차 원고 전처리 계약 (DEC-50)

[결정 목록](decisions.md#결정-목록) DEC-50 · [서비스 경계](service-boundaries.md) · [Content MCP 창구](content-mcp-contract.md)

상태: **#351은 Celery·LangGraph 실행 기반만 구현하며 실제 접수·실행은 차단한다. 후속 #344 브랜치에서 extract/resolve/organize 의미 로직을 구현했으나 Content 작업·MCP 도구(#345), 화면(#346), 성공 결과 보존·재시도는 후속이다.** 아래 실행 계약은 목표이며 전체 구현·배포 완료를 뜻하지 않는다([#343](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/343)).

## 목적

작가가 등록한 회차 원고(최소 100화~2,000화 규모)에서 사건·인물·설정을 뽑아 세계관과 회차별 상태로 정리한다.
회차당 LLM 호출이 여러 번이고 전체가 몇 시간 걸리므로 요청 안에서 끝내지 않고 백그라운드 작업으로 실행한다.

## 결정 (2026-11-13 사용자 확정)

| 항목 | 결정 |
|---|---|
| 작업 실행 | AI 서비스에 작업 프레임워크 **Celery**를 추가한다. 브로커는 기존 RabbitMQ를 쓴다. 회차별 추출은 서로 독립인 작업으로 나눠 병렬 실행하고, 정리 단계는 추출이 끝난 뒤 작품당 한 번 순서대로 실행한다 |
| 구현 방식 | Celery task 1개(접수 1건)가 LangGraph `StateGraph`(체크포인터 없음)를 실행한다. 회차별 추출은 `Send`로 병렬, 실패 회차가 있으면 정리 전에 종료한다. 모델 호출은 LangChain `langchain-openai`의 `ChatOpenAI.with_structured_output`(strict, 재시도 0). 2026-11-13 사용자 결정(#344) |
| 결과 적재 | 전처리 결과는 **Content MCP 창구로 적재**한다. AI 서비스가 정본 DB에 직접 쓰지 않는다 |
| 승인 시점 | 작가가 전처리 실행을 **시작할 때 한 번 승인**한다. 이 승인으로 전처리부터 적재까지 자동으로 진행한다 |
| 검토 방식 | 후보를 하나씩 승인한 뒤 반영하지 않는다. 작가는 **적재된 결과를 기존 화면에서 보고 수정**한다 |
| 선택하지 않은 안 | Airflow(사용자 요청으로 시작하는 작업이고 순환·사람 대기가 있어 맞지 않음), Content 안 폴러만으로 실행(병렬·재시도·동시 실행 제한을 직접 구현해야 함) |

## 처리 흐름

1. **회차별 추출 (병렬):** 회차마다 LLM 1회로 사건, 묘사(외모·성격·세계관 규칙처럼 사건이 아닌 서술), 거기 등장한 호칭(인물·장소·물건·조직)을 원문 근거와 함께 뽑는다. 호칭은 그 회차 안에서만 통하는 임시 ID를 받고, 다른 회차의 같은 이름과 연결하지 않는다.
2. **정체 정리:** 호칭을 같은 대상끼리 묶어 정식 ID를 준다. 동명이인은 분리하고 별칭은 병합한다. 같은 이름만으로 병합하지 않는다. 정체가 나중에 밝혀지는 경우는 병합에 "몇 화부터 같은 대상으로 보는지"를 함께 기록해 앞 회차 상태에 미래 정보가 섞이지 않게 한다.
3. **사건 등록:** 사건의 호칭을 정식 ID로 바꿔 회차 순서대로 정리한다.
4. **인물별 정리:** 인물이 나온 사건과 묘사를 모아 프로필·상태·기억을 구성한다.
5. **설정·아이템 정리:** 장소·물건·조직을 4와 같은 방식으로 정리한다.
6. **적재:** 정리 결과를 Content MCP 도구로 세계관과 회차별 상태에 적재한다.

3~6단계는 1·2단계 결과만 읽는다. 작가가 정체 묶음을 고치면 원문을 다시 읽히지 않고 3단계부터 다시 실행할 수 있다.
전체 스토리를 먼저 훑는 참고 단계를 두더라도 그 결과(미래 회차 정보 포함)는 추출 참고용으로만 쓰고 회차별 상태에 넣지 않는다.

## 책임

- **Content:** 실행 승인 접수, 작품·회차 소유권 확인, MCP 도구를 통한 적재 시 검증·저장, 작가 수정.
- **AI 서비스:** Celery 작업 실행, 추출·정리, 진행 상태, 완료 후 MCP 적재 호출.
- **Core:** 기존대로 인증. 크레딧 비용 안내·동의(UC-03 A3)는 기존 크레딧 계약을 따른다.

## 실행 계약 (2026-11-13, [#343](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/343))

화면 진입점은 작품 관리의 **[세계관 만들기]** 버튼이다. 이번 범위는 최초 구축만이고, 새 회차 증분 반영은 후속이다.

| 항목 | 결정 |
|---|---|
| 접수 | 화면 → Content `POST /api/v1/works/{id}/world-preprocessing`(소유자만, 저장 회차 0개 422, 진행 중·완료 작업 409) → AI `POST /internal/v1/preprocessing/jobs`(`X-Internal-Token`, 본문 `{jobId, workId, episodes:[회차 번호]}`, 202). Kotlin은 Celery 메시지를 직접 만들지 않는다. 같은 `jobId` 재접수는 실패 회차만 다시 실행한다 |
| 작업 기록·진행 상태 | Content 작업 테이블(작업 ID·작품·세계관·회원·상태 `queued/running/loading/completed/failed`·완료 수/전체 수·실패 회차·시각). 화면은 `GET /api/v1/works/{id}/world-preprocessing`만 조회한다. Celery 결과 저장소와 AI DB는 쓰지 않는다 |
| 백그라운드 인증 | 전처리 MCP 도구는 사용자 Bearer 대신 `X-Internal-Token` + 도구 인자 `jobId`로 호출한다. Content는 그 작업이 진행 중(`queued/running/loading`)일 때만 받아들이고 작업에 기록된 회원 권한으로 기존 Service를 호출한다. 종료된 작업 ID는 거절한다 |
| 읽을 원문 | 회차별 최신 저장 버전 |
| 적재 위치 | 작품에 연결된 세계관의 **초안**. 연결 세계관이 없으면 접수 때 새 세계관을 만들어 1:1 연결한다(`work.world_studio_id`). 확정 버전은 작가가 수정 후 직접 남긴다 |
| 실패·재실행 | 추출 실패 회차가 하나라도 있으면 정리 단계 전에 `failed`로 멈추고 실패 회차를 기록한다. 적재는 `jobId`로 멱등(같은 작업의 재호출이 카드를 중복 생성하지 않음) |

### 전처리 MCP 도구 (Content, `jobId` 인증)

| 도구 | 인자 | 결과 |
|---|---|---|
| `preprocessing_episode_read` | `jobId`, `number` | `{number, title, body}` 그 회차 최신 저장 버전 |
| `preprocessing_progress` | `jobId`, `stage`(`extracting/resolving/organizing/loading`), `done`, `total`, `failedEpisodes[]`, `failed`(선택, 고정 사유 문구) | 갱신된 작업 상태 |
| `preprocessing_load` | `jobId`, `cards[]`, `relations[]` | 적재 결과(카드 수·관계 수), 작업 `completed` |

`cards[]` 항목: `key`(작업 안 정식 ID), `cardType`(`character/location/organization/object/event`), `title`, `aliases[]`, `body`(마크다운, 인물은 `IDENTITY.md`), `revealFromEpisode`(첫 등장 회차), 인물만 `characterDocs{soul, goal, episodes{"NN": 글}}`(`memory` 키는 쓰지 않음, 이야기 시작 전 기억은 `episodes{"00"}`)(DEC-47, 문서마다 3,000자 이하). 사건 카드 본문은 회차 번호와 참여 인물을 적는다.
`relations[]` 항목: `fromKey`, `toKey`, `label`, `fromEpisode`, `ended`(선택). Content가 DEC-51 회차별 관계로 변환해 `fromEpisode` 시점마다 기록한다. 카드 공개 여부는 기본 비공개(DEC-46) 그대로다.

## 관련

- [#122](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/122) 원고 기반 설정 추출, [#124](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/124) 회차별 세계관 스냅샷.
- 품질 확인(추출·정체 정리 정확도)은 Celery 없이 스크립트로 먼저 한다(메밀꽃 S01~S04, 4회차).

## #351 최신화: 활성화 전 안전 조건 (2026-11-16)

- 인증된 접수도 현재는 503 `PREPROCESSING_NOT_IMPLEMENTED`로 거절하며 Celery에 넣지 않는다. 직접 들어온 worker 메시지도 같은 보호에서 중단하고 Content에 실행·완료를 기록하지 않는다. 이 차단은 #344 의미 로직을 구현한 후에도 #345와 복구 계약 검증 전까지 유지한다. 환경변수만으로 이 차단을 해제하는 스위치는 두지 않는다.
- 202는 브로커 접수일 뿐 작업 완료가 아니다. 향후 #345는 접수 거절을 queued/running이나 완료로 남기지 않아야 하며 #346은 서버의 실제 상태를 표시해야 한다. 지금은 두 경로가 없어 실제 사용자 흐름을 검증하지 않았다.
- worker·Router·LangGraph는 보존하되 이 기반 PR을 기능 출시로 배포하지 않는다. 활성화 전 #344 로직, #345 작업 인증·진행·멱등 적재, #346 실패·미확인 안내와 아래 재시도 계약을 함께 검증해야 한다.

### 실패 회차 재실행의 확인된 갭과 제안 (결정 전)

`graph.run` 호출마다 state를 새로 만들며 체크포인터·Celery result backend가 없다. 첫 실행에서 1화 성공/2화 실패 후 같은 jobId로 2화만 호출하면 `resolve`에는 2화만 전달된다. 기존 성공 결과를 합쳤다고 보고 적재하면 누락이 생긴다. 테스트는 이 현상을 재현하며 접수 차단을 안전장치로 검증한다.

목표인 '실패 회차만 재실행'을 지원하려면 #344/#345에서 다음 계약을 먼저 합의한다. **이번 PR은 결과 저장소를 새로 추가하거나 기존 작업 테이블의 스키마를 확정하지 않는다.**

1. job의 전체 회차 목록·원문 저장 버전/해시를 고정하고 같은 jobId의 재시도에서 검증한다. 현재 `EpisodeText`는 number/title/body만 있어 이 기준 식별도 후속이다.
2. 성공 회차 결과의 보존 주체·형식·보관 기간과 회수 API를 결정한다. 권장 방향은 Content가 관리하는 작업 범위에서 검증된 중간 결과를 보존·재조회하도록 계약화하는 것이며, 새 DB나 Celery 결과 저장소 도입을 뜻하지 않는다.
3. 실패 회차 결과와 기존 성공 결과를 합친 뒤 전체 회차가 정확히 한 번씩 채워진 경우에만 resolve/organize/load로 간다. 누락·중복·원문 변경은 정리·적재를 차단한다.
4. 동일 작업 동시 실행·중복 메시지, worker 종료, 브로커 응답 유실, Content 진행 갱신 실패·적재 결과 미확인은 별도로 처리한다. 적재의 jobId 멱등성과 원래 payload 보존을 검증하고 실패 상태 전송을 못했다고 완료로 추정하지 않는다.
5. 저장 계약을 두지 않는 전체 재추출 대안은 비용·원문 고정·새 실행 식별자·이미 적재됐는지 확인을 포함한 명시적 결정이 필요하다. 부분 결과만으로 적재하거나 자동으로 새 작업을 시작하는 대체 동작은 금지한다.

현재의 함수 대역 테스트 통과는 이 재시도·복구 계약 구현 완료를 뜻하지 않는다. 실패 회차 재시도는 이 계약과 #344/#345 구현·통합 검증 전까지 활성화하지 않는다.


## #344 의미 로직 (실행 비활성, 2026-11-16)

### 구현과 DTO

- `extract(EpisodeText)`: LangChain `ChatOpenAI` Responses API, strict Pydantic 출력, `max_retries=0`, `store=False`, timeout 60초. 원문은 SystemMessage에 끼워 넣지 않고 HumanMessage JSON 데이터로 전달한다. schema/JSON 오류·응답 잘림·거절·timeout은 고정 오류이며 부분 성공이나 임의 보정은 없다.
- `ProposedExtraction`: `mentions{id,name,kind,quote}`, `statements{id,kind,certainty,subjects,knowers,document,occurredEpisode,knownFromEpisode,quote}`, `relationships{id,source,target,label,fromEpisode,ended,change,quote}`. kind는 event/description/rule/fact/conjecture/goal/plan이며 certainty는 asserted/uncertain/intended다. relation change는 실제 시작/변경/종료와 learned(단순 인지)를 구분한다. 이 필드들은 **AI 중간 DTO**이며 기존 LoadPayload 변경이 아니다.
- `EpisodeExtraction`(`manuscript-extraction.v1`): 회차 번호·제목·원문·sourceHash 및 검증된 evidence를 보존한다. sourceHash는 number/title/body의 정렬·공백 없는 JSON UTF-8 SHA-256이다. 인용은 본문에 정확히 한 번 있어야 하며 UTF-16 `[start,end)`와 quoteHash는 프로그램에서 계산한다. CRLF·공백·이모지를 정규화하지 않는다. 같은 인용을 호칭과 진술이 공유할 수 있지만 동일 진술·ID·관계의 중복 및 원문 안의 모호한 중복 위치는 거절한다.
- `resolve`: 실제 모델이 명시적 별칭/재등장 근거와 보류·별개 판정을 제안하고 프로그램이 quote·회차·참조·종류·모순을 검증한다. 이름만 같은 경우 자동 병합하지 않는다. 정렬된 회차-local ID로 작업 내 정식 key를 결정한다. **같은 검증된 추출·정체 제안 입력**의 매핑은 재현 가능하지만 유료 모델의 반복 출력 동일성을 보장하지 않는다. key는 작업 범위에서 쓰며 Content의 실제 WorldStudio UUID를 발급하지 않는다.
- `IdentityResolution`(`manuscript-identity.v1`): mapping, 전체 검증 추출 DTO의 canonical JSON SHA-256인 inputHashes, 원문 근거·confirmedAt·merged/deferred/distinct·reason을 가진 decisions. `organize`가 입력 해시와 결정을 다시 대조하여 다른 추출 결과의 매핑 재사용을 차단한다.
- `organize`: 추가 모델 호출·Content 조회 없이 검증 결과에서 기존 `LoadPayload`를 만든다. 5종 카드·본문 원문과 의미 유형 표식·명시적 인지자의 회차 기억·관계 key를 구성한다. rule은 관련 대상의 진술로 보존하고 미지원 rule 카드를 만들지 않는다. 3,000자 초과를 잘라 맞추지 않는다. 실제 사건만 event 카드이며 계획·추측은 이벤트로 승격하지 않는다.

### 사용자 확정: 보수적 시점 처리

- 전역 제목은 최초 호칭, 전역 별칭은 첫 등장 회차에서 이미 확인된 별칭만 쓴다. 늦은 다른 호칭의 동일인 공개는 `LATE_ALIAS_REQUIRES_VERSIONED_IDENTITY` 보류 기록을 남기고 Payload 생성을 `DEFERRED_IDENTITY_REQUIRES_REVIEW`로 차단한다. 알려진 동일인을 중복 카드로 적재하거나 공개를 관계 생성 사건으로 변환하지 않는다.
- 인물의 전역 IDENTITY·SOUL·GOAL에는 최초 등장 회차의 진술만 넣는다. 이후 목표·성격 변화는 명시적 인지자의 해당 회차 기억에 넣는다. 기억에 넣을 때도 인물이 quote에 명시돼 있어야 하며 다른 인물/미래 회차 bucket으로 퍼뜨리지 않는다. 시작 전 기억은 source가 명시한 fact·occurredEpisode=0·memory·knownFromEpisode=0 조합만 허용한다. 00회차는 보수적으로 원문에 `이야기 시작 전부터`가 명시된 경우만 받으며, 이미 등장한 인물의 뒤 회차 공개 사실을 00회차로 소급하면 `RETROACTIVE_MEMORY_NOT_REPRESENTABLE`로 거절한다. 표현이 다른 시작 전 기억도 현재는 보류/실패 대상이며 실모델 평가 후 근거 규칙 확장이 필요하다. 기억 내용을 전역 GOAL·별칭으로 복사하지 않는다.
- 관계의 실제 시작/종료는 `fromEpisode`와 ended를 보존한다. 원문 회차와 관계 적용 회차가 다르면 공개 시점을 별도로 표현할 수 없어 `UNSUPPORTED_RELATION_TIME`으로 차단한다. 단순 관계 인지(learned)는 `RELATION_DISCOVERY_NOT_REPRESENTABLE`로 차단한다. label 변경의 동일 관계 매핑은 현재 LoadPayload에 관계 정식 key가 없어 `RELATION_CHANGE_NOT_REPRESENTABLE`로 차단하며 #345와 후속 계약이 필요하다. 지원되는 시작/종료의 동일 관계 판단도 Content가 job/key/양 끝/label 기준을 확정해야 한다.
- 이후 비인물 설정 상태처럼 현 스키마로 과거 누출 없이 표현할 수 없는 진술은 `UNSUPPORTED_LATER_SETTING_STATE`, 어떠한 카드·기억·사건에도 담기지 않는 진술은 `UNREPRESENTABLE_STATEMENT`로 전체 Payload 생성을 차단한다. 추출 원문과 identity decisions는 중간 결과에서 확인할 수 있다. 이를 저장하거나 UI로 보여 주는 #345/#346은 이번 구현에 포함하지 않는다.
- revealFromEpisode는 기존 계약대로 첫 등장 회차다. 공개/비공개 필드를 추가하지 않으며 Content 적재 기본 비공개를 유지해야 한다. 미래 상태의 전역 소급 반영을 허용한다는 의미가 아니다.
- 계획/추측의 유형·certainty 불일치와 명시적 한국어 표지(계획·추측·것 같·싶어·예정·지도 모·소문)를 asserted로 내는 출력은 거절한다. 이는 보수적인 보조 규칙으로 거짓 양성도 있고, 한국어 의미 전체나 인물의 실제 지식을 증명하지 않는다. quote 일치·이름 등장만으로 정체/인지/의미적 사실성을 검증 완료라고 보고하지 않는다. 실모델 정답 평가가 필수다.

### Fixture·품질·후속 계약

[4회차 Fixture](../../backend/ai-service/tests/preprocessing/fixtures/four-episodes.json)는 테스트용으로 직접 작성한 홍길동 모티프 원문과 모델 대역 정답이다. 기존 `experiments/preprocessing/`는 현재 기준 트리에 없어 읽지 못했다. 실제 소설이나 실모델 실행 결과를 가장하지 않는다. [예상 적재 Payload](../../backend/ai-service/tests/preprocessing/fixtures/expected-load.json)는 실제 세 함수가 대역 결과를 검증·구성한 산출물이며 카드 5개(인물 2·조직 1·사건 2), 관계 시작/종료 2개다. 길동/홍길동 별칭, 다른 홍길동, 계획→3화 실제 사건, 3화 목표 변화·비밀, 4화 탈퇴를 다룬다. 늦은 정체 공개·미래 문서 소급·관계 인지·변조·모호한 인용·길이 초과는 별도 오류 테스트다.

#345 인계 요구: job 전체 원문 version/hash manifest, 검증된 EpisodeExtraction 및 IdentityResolution(근거·보류 이유 포함) 보존·재조회, 동일 추출 버전만 결합, 전체 회차 완전성·중복 실행·응답 유실 검사, 성공 receipt/부분 실패 복구. 이번 DTO는 메모리에서만 반환하며 내구성 저장·재시작 복구를 구현한 것이 아니다. 부분 재실행 문제는 그대로 남고 `PREPROCESSING_NOT_IMPLEMENTED`를 해제하지 않는다.

실모델 평가는 별도 승인 후: 이 4회차와 별도 미사용 검증 원문에 사람이 호칭 연결·사건/계획/추측·근거·인지자·공개 회차·관계 변화를 라벨링한다. 근거 정확 일치율/모호성 거절률, 엔터티 연결 precision/recall 및 동명이인 오병합 수, 의미 유형 confusion matrix, 미래 정보·타인 비밀 누출 건수, Payload 유효율/보류율, 호출 수·토큰·비용·지연을 측정한다. 안전 위반은 0건이어야 하며 품질 임계값·입력량·비용 상한은 호출 전에 합의한다. 자동화 테스트 통과를 실모델 품질로 대체하지 않는다.

현재 모델 호출 입력은 직렬화 후 120,000자를 넘으면 `MODEL_INPUT_TOO_LARGE`로 거절한다(무음 truncation 없음). 100~2,000회차 전체 정체 통합은 배치·문맥 결합 및 성공 결과 보존 계약이 필요하며 이 소규모 구현으로 지원 완료라고 표시하지 않는다.
