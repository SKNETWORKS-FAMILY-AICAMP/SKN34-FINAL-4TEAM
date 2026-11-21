# 원고 최초 세계관 구축 저장 계약

2026-11-17 사용자 승인: 기존 WorldStudio PostgreSQL의 job/result/load_step 기록을 사용한다.
**설계와 구현 완료를 구분한다. 이 문서만으로 접수·실행 차단을 해제하지 않는다.**

## 범위와 정본

최초 실행 대상 회차 전체로 한 번 세계관을 구축한다. 완료 후 신규 회차 감지·자동 갱신·Fork 동기화는 제외한다.
기존 world/world_draft, setting_card/draft/version, world_revision과 Neo4j DEC-51을 정본으로 유지한다.
직접 등록의 후보별 검토는 initial_analysis/candidate/decision/application에 유지한다. 원고 작업의 시작 동의는 후보별 승인 기록을 위조하지 않는다.
#344/#351/#428의 특정 실행 프레임워크나 브랜치에 의존할 필요는 없다.

## 최소 영속 기록

Content V41의 preprocessing_job이 공개 작업 ID와 상태를 소유한다(V15 트리거가 `manuscript_build_job`의 진행 수·실패 회차·시각을 같은 id의 이 행에 맞춰 두므로 운영 목록도 이 값을 읽는다). WorldStudio V15는 같은 ID에 입력, 결과와 적재 단계를 연결한다. 기존 WorldStudio V1~V12와 V14는 보존한다(V13은 결번).

| 기록 | 필요한 값 | 불변·고유 조건 |
|---|---|---|
| manuscript_build_job | job UUID, work 문자열 ID, world UUID, owner UUID, 요청 key/hash, manifest JSON, 상태, 실행 token/deadline, 오류 코드, 생성 시각 | 최초 대상 집합/버전/해시/소유자 불변. 동일 작품의 초기 작업은 재시도 시 기존 job 사용 |
| manuscript_build_result | job ID, 결과 종류(extraction/identity/payload), 회차 슬롯, 검증 결과 JSON/hash | 동일 슬롯·동일 결과는 기존 결과 반환. 다른 결과 덮어쓰기 금지. 원문 근거·보류 이유 보존. payload는 생성 UUID 예약 전 원래 적재 입력을 고정해 동일 요청 여부를 비교 |
| manuscript_build_load_step | step UUID, job ID, 순번, 고정 요청 JSON/hash, 상태, 완료 receipt | UUID·관계 ID·request key는 예약 이후 불변. 같은 단계만 재시도. 완료 receipt 불변 |

workId는 기존 Content의 문자열 식별자를 유지한다. UUID로 억지 변환하지 않는다.
manifest에는 정렬된 전체 회차 번호, episodeId, 저장 버전 ID, 제목·본문의 불변 사본과 sourceHash를 담는다. 저장 버전이 없는 끝의 다음 회차 초안(발행·작품 생성이 자동으로 만든다)은 전체 회차에서 뺀다. 중간의 미저장 회차와 Fork 상속 회차는 422다. 공개/발행 여부는 입력 가능 조건이 아니며 소유권이 조건이다. 이후 원문 수정은 고정된 snapshot을 바꾸지 않는다. 요청이 새 원문을 의미한다면 동일 key 재사용을 거절한다. 단 추출이 도는 동안 원고 저장 버전·세계관 초안·작품-세계관 연결이 바뀌면 고정본으로 계속하지 않고 `SOURCE_CHANGED`·`WORLD_CHANGED`·`WORLD_LINK_CHANGED`로 작업을 실패 처리한다(사용자 결정 2026-11-20, [정책 5](manuscript-preprocessing-contract.md#추출정체-정리-정책-2026-11-20-사용자-확정)).
완료 수는 영속 결과에서 계산한다. worker가 보낸 done 숫자만으로 성공 회차를 인정하지 않는다.

## 결과와 재실행

### 2026-11-17 연결 범위

사용자 정정에 따라 이번 연결은 4화 수용 검증 후 10화까지 진행한다. 20~30화 안정성 검증과 100화 이상·유료 모델 평가는 제외한다. AI 내부 접수 경로에서 실행권을 한 번 획득해 누락된 회차만 처리한다. V41이 작업 상태를, V15가 복구 자료를 보존한다. 이전 실행 token을 지목한 명시적 동일 작업 재개로 복구한다.

공개 접수/조회는 `/api/v1/works/{id}/world-preprocessing`이고 시작 동의·작품 및 세계관 소유권을 확인한다. AI는 내부 `/internal/v1/preprocessing/jobs`에서 작업을 받고 Content의 `/internal/v1/ai/manuscript-build/{id}` 하위 경로로 결과를 기록한다. 실제 적재는 Content가 기존 WorldStudioService로 수행한다. AI 실행은 아래 '업로드 자동 시작과 Celery 큐'대로 Celery 큐(순차)다. MCP 적재는 쓰지 않는다.

`app.manuscript-build.enabled` 코드 기본값은 false이고, 2026-11-20 실모델(`gpt-6-luna`) four-episodes 1회 실측(회차당 5~12초, 정체 정리 5초, 제외 항목 0, 카드 11장) 뒤 사용자 결정으로 base compose가 `APP_MANUSCRIPTBUILD_ENABLED`(기본 true)로 켠다. 기존 업로드는 이 플래그와 무관하게 분석·적재·발행을 시작하지 않는다. 작성자가 명시적으로 POST를 호출해야 한다. 카드의 UI 검토 표시 `approved`는 최초 일괄 초안 생성 동의에 따른 편집 가능 상태이며 직접 입력 후보의 검토 결정 기록이나 확정 버전을 뜻하지 않는다. `analysisId`·`decisionSequence`는 생성하지 않는다.

- 회차 결과는 해당 manifest의 번호·원문 버전/해시·인용·좌표와 대조한다. UTF-16 근거와 원문 문자열을 보존한다.
- 실행 token/deadline으로 중복 worker 실행과 중단 뒤 늦은 응답을 구분한다. token 소유자가 아닌 쓰기는 거절한다.
- `ManuscriptBuildExecution.claim`은 queued 작업에 한 번 실행권을 준다. 실패/기한 만료 작업은 이전 token을 지목한 명시적 재개만 허용하며 새로운 token을 발급한다. 아직 살아 있는 실행을 중복 접수로 교체하지 않는다. 시각과 deadline은 Content 서버가 정하며 사용자 입력으로 받지 않는다.
- loading/unknown/completed 작업은 새 추출 실행권을 발급하지 않는다. loading/unknown은 예약한 적재 요청으로 복구하고, completed는 기존 receipt를 사용한다. 실행권 교체는 성공 결과를 삭제하지 않는다.
- 성공 결과의 응답 유실은 같은 슬롯/hash 재요청으로 복구한다. 실패 회차 재시도는 저장된 성공 결과를 재사용한다.
- manifest의 전체 집합과 저장된 결과 집합이 정확히 같을 때만 정체 통합 및 적재를 허용한다. 누락·중복·상이한 입력 해시는 거절한다.
- 정체 통합은 전체 추출 결과 hash 집합에 결합한다. 기존 WorldStudio 인물을 이름만으로 자동 병합하지 않는다(원고 안의 같은 종류·같은 이름은 정책 1에 따라 묶는다). 기존 카드와의 정체가 확인되지 않으면 적재 전에 보류/충돌로 중단한다.

## 적재 경계

1. Content가 소유권·동의·완전성·기준 초안을 확인한다. 같은 성공 job/payload이면 receipt부터 반환한다.
2. 작업 내 key는 `(jobId, worldId, key)` 범위다. 실제 카드 UUID와 관계 UUID는 Content가 준비 단계에 예약한다.
3. DEC-51 회차 순서에 맞는 고정된 부분 추가 요청을 만든다. 기존 카드 원문과 관계를 전체 교체하지 않는다.
4. PG 준비 후 Neo4j를 호출한다. 네트워크 호출 중 PG 트랜잭션을 유지하지 않는다.
5. 기존 WorldStudio 최종 PG 저장 트랜잭션에 단계 receipt를 함께 기록한다. 별도 트랜잭션에서 완료 표시만 덧붙이지 않는다.
6. 모든 단계가 완료돼야 job 완료다. 중간 단계 후 장애는 unknown이며 전체 성공으로 표시하지 않는다. 일반 저장이 미완료 예약을 덮어쓰지 못하게 한다.
7. Neo4j 성공/PG 실패는 동일 UUID/key/hash로 조회·재시도한다. 새 key 자동 생성·예약 해제는 하지 않는다. 완료 후 응답 유실은 보존된 receipt로 처리한다.

## 공개와 출처

`firstAppearanceEpisode`는 첫 등장 출처 정보다. 원고 경로는 `semanticMetadata.manuscriptBuild`에 job/result/key와 함께 보존한다. 기존 `semanticMetadata.preprocessing`는 직접 입력 후보의 analysisId/candidateId/decisionSequence 계약이므로 원고 작업의 시작 동의를 후보 승인 이력으로 위조하여 넣지 않는다. 자동 적재는 `visibility=private`이며 `semanticMetadata.revealFromEpisode`를 지정하지 않는다. 공개 회차는 작가가 직접 지정한다. 기존 작가의 공개 설정은 수정하지 않는다.
현재 프런트 HTTP 어댑터는 빈 메타데이터 또는 유효한 `studio`를 요구한다. 원고 출처만 있는 부분 객체를 그대로 저장하면 재조회 파싱이 실패한다. 적재 매퍼는 유효한 StudioSetting과 별도 원고 출처를 함께 만들고 왕복 테스트로 보존을 확인해야 한다. ManuscriptBuildMapper가 이 매핑을 제공한다. 정본 별칭과 studio.aliases를 일치시키며 실제 서버 응답 Fixture를 프런트 HTTP 어댑터로 왕복 검증한다. 브라우저 수용 검증은 별도로 표시한다.
카드·관계의 출처에 jobId, 원고 버전/결과 식별자, 추출 key를 보존해 영속 결과의 근거로 추적한다. 정체 통합 결정을 원문 자체의 사실성 보증으로 해석하지 않는다.
초안 적재 완료는 확정·공개·발행이 아니다. 확정은 기존 revisions API를 작가가 별도로 호출한다.

## 검증 게이트

실제 독립 PostgreSQL·Neo4j에서 원문 고정, 결과 재사용, 누락 차단, 같은 요청 재호출, worker 중단, Neo4j 성공/PG 실패, 응답 유실, 원본 보존을 검증하기 전 자동 실행을 활성화하지 않는다. 기존 직접 입력 경로도 동일 DB와 실제 Content HTTP로 회귀 검증한다. 실모델 품질·100화 장편 용량은 제공사 대역 테스트와 별도다.

## 실행 제한과 소비자 연결

- 공개 API POST 본문: `{worldId, key, consent: true, resumeToken?}`. worldId와 key는 요청 전에 정하고 재전송할 때 유지한다.
- 진행 중은 202 + Location, 완료·실패·unknown 조회는 상태/실제 완료 receipt를 반환한다. 응답의 `build`에는 `skippedItems`(모든 회차 추출 결과의 `skipped` 합, 결과가 없으면 0)가 있고 완료 화면이 '근거를 확인하지 못한 항목 N개는 초안에 넣지 않았어요'로 알린다. GET은 모델을 실행하지 않는다.
- 실패/실행 기한 만료 후 재개는 조회한 executionToken을 resumeToken으로 명시한다. worker가 Content에 남기는 실패 사유 코드(`failureCode`)의 정본은 `AI_TIMEOUT`(모델 timeout), `AI_RESPONSE_UNCONFIRMED`(응답 미확인), `AI_REQUEST_REJECTED`(모델 미설정·입력 과대 등 요청 거절), `AI_OUTPUT_INVALID`(그 밖의 검증·모델 출력 오류), `CONTENT_REJECTED`(Content가 result/structure/load 콜백을 4xx로 거절), `NO_SETTINGS_FOUND`(정리 결과 카드가 0장)이다. 세부 오류 코드는 로그에 코드 문자열로만 남기고 원고는 남기지 않는다. Content가 적재 전제 위반으로 직접 기록하는 코드는 `SOURCE_CHANGED`·`WORLD_CHANGED`·`WORLD_LINK_CHANGED`이고, 이 경우 뒤따르는 worker의 실패 보고는 409로 거절될 수 있다.
- loading/unknown의 동일 POST는 기존 load_step만 복구한다. 성공 회차나 구조화를 재호출하지 않는다.
- JSONB의 객체 key 순서는 보장되지 않는다. 원고 부분 추가 요청 해시는 예약과 복구 양쪽에서 같은 재귀 정렬을 사용한다. 기존 일반 저장 해시 계약은 변경하지 않는다.
- 기존 카드가 있는 세계관은 자동 정체 병합하지 않고 409('이미 설정이 있는 세계관에는…')로 거절하며 접수 행을 남기지 않는다. 이 작업은 빈 세계관의 최초 구축 전용이다. 시작 시 사유가 있는 거절은 404(작품·세계관 없음)·409(설정이 있는 세계관, 연결 불일치, 진행 중·완료)·422(저장 회차 없음, 중간 미저장, Fork 상속, 입력 형식)이고 한국어 문구와 함께 내려가며 500으로 내보내지 않는다.
- 완료 후 새 회차 추가/재구축/취소는 제공하지 않는다. 기존 직접 등록 후보별 승인과 별개의 시작 동의다.
- 작품 관리에 명시적 동의·시작/상태/동일 작업 재개를 연결했다. 상세 수용 범위는 [브라우저 QA](../verification/two-path-qa/browser-qa.md) 참조. 공개 회차 목록이 비어 있어도 비공개 저장 원고가 있으므로 시작을 차단하지 않고 Content가 원고를 검증한다.
- 명시적 재개는 영속 결과/실행권 기반이다. 프로세스 강제 종료 후 실제 재시작 수용 검증 전에는 운영 실행을 활성화하지 않는다.

DEC-47 저장/화면의 episodes key는 "0", "3" 형태다. 추출 결과의 파일명용 "00", "03"은 V15 result에 그대로 보존하고, 적재 매퍼가 숫자 key로 변환한다. 숫자 변환으로 충돌하는 중복 키는 거절한다.

## 업로드 자동 시작과 Celery 큐 (2026-11-20 사용자 결정)

전처리 담당자가 이어받을 틀이다. 기존 접수·재개·조회 함수를 그대로 부르고 두 번째 경로를 만들지 않는다. 회차별 병렬 실행과 #343 골격(`preprocessing_job`) 정리는 담당자의 후속이다.

- **실행기:** AI의 `POST /internal/v1/preprocessing/jobs`는 `BackgroundTasks` 대신 Celery 태스크(`preprocessing.run`) 하나를 큐에 올리고 202를 돌려준다. 브로커는 기존 `rabbitmq` 컨테이너(Core와 같은 자격), 결과 저장소는 쓰지 않는다. 작업(작품) 하나가 태스크 하나이고 워커 동시성은 1이라 큐에 들어온 순서대로 하나씩 처리한다(순차 처리). 워커는 ai-service와 같은 이미지의 별도 컨테이너(`ai-worker`)다. `acks_late`라 워커가 도중에 죽으면 같은 태스크가 다시 배달되지만 Content 실행권(claim)이 이미 시작된 작업을 거절(`claimed=false`)해 다시 실행되지 않는다(만료된 적재만 load를 다시 시도한다). 죽은 실행의 재개는 실행 기한이 지난 뒤 사용자의 '같은 작업 재개'다. 접수·콜백·검증·적재 계약은 바꾸지 않는다.
- **업로드 자동 시작:** 원고 가져오기(`POST /works/{id}/manuscript-imports`, `…/manuscript-imports/bulk`)가 회차를 하나 이상 저장하면 Content가 같은 요청 안에서 최초 구축 접수(위 '결과와 재실행'의 시작과 같은 검사·작업 행)를 시도한다. 별도 확인 없이 업로드 화면의 안내 문구로 OpenAI 전송을 알린다(동의 기록은 `consent=true`, key는 `import:<가져오기 요청 id>`). 세계관은 작품에 연결된 세계관, 없으면 새 UUID다. 업로드할 때마다 시도하고, 접수 결과를 가져오기 응답의 `worldBuild`에 싣는다: `{ "status": "started" | "rejected", "jobId": string|null, "code": string|null, "message": string|null }`(거절이면 시작 API와 같은 오류 code·한국어 문구). 접수 실패가 가져오기 저장을 되돌리지 않는다. 일괄 가져오기는 묶음(요청)마다 `startWorldBuild`(기본 true)를 받아 화면이 마지막 묶음만 true로 보낸다(앞 묶음에서 일부 회차만 고정되지 않게). 마지막 묶음이 모두 실패하면 접수하지 않는다. 구축 응답(조회·시작·재개)은 `requestKey`를 실어, 브라우저에 요청 기록이 없어도(업로드가 시작한 작업·다른 브라우저) 응답의 worldId·requestKey로 같은 작업을 재개한다.
- **운영 화면:** Content 내부 `GET /internal/v1/preprocessing-jobs`·`POST …/{id}/retry`의 출처를 `manuscript_build_job`으로 바꾼다(응답 형식 유지). 재실행은 실패한 작업을 같은 작업으로 다시 접수한다. 목록은 `manuscript_build_job` 행만 고르고 진행 수·시각은 트리거가 맞춰 둔 같은 id의 `preprocessing_job` 행에서 읽는다(`unknown`은 `loading`으로 보인다).
- **회차 관리 표시:** 작품 관리는 기존 `GET /works/{id}/world-preprocessing`을 읽어 `queued`·`running`·`loading`이면 '세계관 추출 중' 배지를 보인다. 새 API는 없다.

## 최초 구축 사용자 화면

View → ViewModel → ManuscriptBuildUseCase → HttpManuscriptBuildRepository → 기존 Content API를 사용한다. 목업에서는 이 실행 패널을 그리지 않는다.
화면 진입/업로드/새로고침은 GET만 수행한다. 명시적 동의 후 POST 직전에 계정·작품별 localStorage에 worldId/key/consent를 보존한다. 재접수·통신 실패·재로그인으로 key를 교체하지 않는다. 브라우저 Web Lock과 진행 중 버튼 잠금으로 중복 입력을 막는다.
진행 중은 상태 GET만 2초 간격으로 조회하며 조회 실패는 오류로 남긴다. failed/unknown은 사용자가 같은 작업 재개를 눌러야 한다. failed는 항상 '같은 작업 재개'와 함께 동의 뒤 '새로 시작' 폼을 보이고, 새로 시작은 새 key와 지금 작품에 연결된 worldId(없으면 실패한 작업의 worldId, 그것도 없으면 새 UUID)로 POST한다. 서버는 작품에 연결된 세계관만 받으므로 연결이 바뀐 뒤에도 409 없이 새로 시작된다. 조회가 404이거나 `recovery=new_request`이면 저장해 둔 요청 기록을 지운다. 실패 재개는 최신 executionToken, 적재 unknown 복구는 원래 요청을 사용한다. 완료 상태는 전체 회차 수와 해당 job/world의 receipt를 확인한 경우만 표시한다.
초안 열기는 기존 WorldStudio 경로이며 확정/공개/발행을 실행하지 않는다. 이미 작가가 확정한 뒤 돌아올 수 있으므로 완료 안내는 현재 미확정이라고 단정하지 않는다.
요청 key는 구축 응답의 `requestKey`로 받으므로 다른 브라우저에서도 같은 작업을 재개한다(임의 새 key로 재개하지 않는다). 교차 기기 취소/재구축은 이번 범위 밖이다.
