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

공개 접수/조회는 `/api/v1/works/{id}/world-preprocessing`이고 시작 동의·작품 및 세계관 소유권을 확인한다. AI는 내부 `/internal/v1/preprocessing/jobs`에서 작업을 받고 Content의 `/internal/v1/ai/manuscript-build/{id}` 하위 경로로 결과를 기록한다. 실제 적재는 Content가 기존 WorldStudioService로 수행한다. AI 실행은 아래 '업로드 자동 시작과 Celery 큐'를 따른다.

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

`firstAppearanceEpisode`는 첫 등장 출처 정보다. 원고 경로는 `semanticMetadata.manuscriptBuild`에 job/result/key와 함께 보존한다(적재 요청도 초안 편집과 같은 `semanticMetadata` 허용 키 검사를 거치며 이 키는 허용 키다, [계약](worldstudio-independent-schema.md#초안-semanticmetadata-계약-541)). 기존 `semanticMetadata.preprocessing`는 직접 입력 후보의 analysisId/candidateId/decisionSequence 계약이므로 원고 작업의 시작 동의를 후보 승인 이력으로 위조하여 넣지 않는다. 자동 적재는 `visibility=private`이며 `semanticMetadata.revealFromEpisode`를 지정하지 않는다. 공개 회차는 작가가 직접 지정한다. 기존 작가의 공개 설정은 수정하지 않는다.
현재 프런트 HTTP 어댑터는 빈 메타데이터 또는 유효한 `studio`를 요구한다. 원고 출처만 있는 부분 객체를 그대로 저장하면 재조회 파싱이 실패한다. 적재 매퍼는 유효한 StudioSetting과 별도 원고 출처를 함께 만들고 왕복 테스트로 보존을 확인해야 한다. ManuscriptBuildMapper가 이 매핑을 제공한다. 정본 별칭과 studio.aliases를 일치시키며 실제 서버 응답 Fixture를 프런트 HTTP 어댑터로 왕복 검증한다. 브라우저 수용 검증은 별도로 표시한다.
카드·관계의 출처에 jobId, 원고 버전/결과 식별자, 추출 key를 보존해 영속 결과의 근거로 추적한다. 정체 통합 결정을 원문 자체의 사실성 보증으로 해석하지 않는다.
초안 적재 완료는 확정·공개·발행이 아니다. 확정은 기존 revisions API를 작가가 별도로 호출한다.

## 검증 게이트

실제 독립 PostgreSQL·Neo4j에서 원문 고정, 결과 재사용, 누락 차단, 같은 요청 재호출, worker 중단, Neo4j 성공/PG 실패, 응답 유실, 원본 보존을 검증하기 전 자동 실행을 활성화하지 않는다. 기존 직접 입력 경로도 동일 DB와 실제 Content HTTP로 회귀 검증한다. 실모델 품질·100화 장편 용량은 제공사 대역 테스트와 별도다.

## 실행 제한과 소비자 연결

- 공개 API POST 본문: `{worldId, key, consent: true, resumeToken?}`. worldId와 key는 요청 전에 정하고 재전송할 때 유지한다.
- 진행 중은 202 + Location, 완료·실패·unknown 조회는 상태/실제 완료 receipt를 반환한다. 응답의 `build`에는 `skippedItems`(모든 회차 추출 결과의 `skipped` 합, 결과가 없으면 0)가 있고 완료 화면이 '근거를 확인하지 못한 항목 N개는 초안에 넣지 않았어요'로 알린다. GET은 모델을 실행하지 않는다.
- 실패/실행 기한 만료 후 재개는 조회한 executionToken을 resumeToken으로 명시한다. worker가 Content에 남기는 실패 사유 코드(`failureCode`)의 정본은 `AI_TIMEOUT`(모델 timeout), `AI_RESPONSE_UNCONFIRMED`(응답 미확인), `AI_REQUEST_REJECTED`(모델 미설정·입력 과대 등 요청 거절), `AI_OUTPUT_INVALID`(그 밖의 검증·모델 출력 오류), `CONTENT_REJECTED`(Content가 result/structure/load 콜백을 4xx로 거절), `NO_SETTINGS_FOUND`(정리 결과 카드가 0장)이다. 세부 오류 코드는 로그에 코드 문자열로만 남기고 원고는 남기지 않는다. Content가 적재 전제 위반으로 직접 기록하는 코드는 `SOURCE_CHANGED`·`WORLD_CHANGED`·`WORLD_LINK_CHANGED`이고(만든 적재 요청이 초안 편집 검사를 통과하지 못해도 `CONTENT_REJECTED`를 직접 기록해 작업을 running으로 남기지 않는다), 이 경우 뒤따르는 worker의 실패 보고는 409로 거절될 수 있다.
- loading/unknown의 동일 POST는 기존 load_step만 복구한다. 성공 회차나 구조화를 재호출하지 않는다.
- JSONB의 객체 key 순서는 보장되지 않는다. 원고 부분 추가 요청 해시는 예약과 복구 양쪽에서 같은 재귀 정렬을 사용한다. 기존 일반 저장 해시 계약은 변경하지 않는다.
- 기존 카드가 있는 세계관은 자동 정체 병합하지 않고 409('이미 설정이 있는 세계관에는…')로 거절하며 접수 행을 남기지 않는다. 이 작업은 빈 세계관의 최초 구축 전용이다. 시작 시 사유가 있는 거절은 404(작품·세계관 없음)·409(설정이 있는 세계관, 연결 불일치, 진행 중·완료)·422(저장 회차 없음, 중간 미저장, Fork 상속, 입력 형식)이고 한국어 문구와 함께 내려가며 500으로 내보내지 않는다.
- 완료 후 새 회차 추가/재구축/취소는 제공하지 않는다. 기존 직접 등록 후보별 승인과 별개의 시작 동의다.
- 작품 관리에 명시적 동의·시작/상태/동일 작업 재개를 연결했다. 상세 수용 범위는 [브라우저 QA](../verification/two-path-qa/browser-qa.md) 참조. 공개 회차 목록이 비어 있어도 비공개 저장 원고가 있으므로 시작을 차단하지 않고 Content가 원고를 검증한다.
- 명시적 재개는 영속 결과/실행권 기반이다. 프로세스 강제 종료 후 실제 재시작 수용 검증 전에는 운영 실행을 활성화하지 않는다.

DEC-47 저장/화면의 episodes key는 "0", "3" 형태다. 추출 결과의 파일명용 "00", "03"은 V15 result에 그대로 보존하고, 적재 매퍼가 숫자 key로 변환한다. 숫자 변환으로 충돌하는 중복 키는 거절한다.

## 업로드 자동 시작과 Celery 큐 (2026-11-20 사용자 결정)

업로드 자동 시작은 기존 접수·재개·조회 함수를 사용한다. #343 골격(`preprocessing_job`) 정리는 후속 범위다.

- **실행기:** AI의 `POST /internal/v1/preprocessing/jobs`는 작품 작업 하나를 Celery 태스크(`preprocessing.run`) 하나로 큐에 올리고 202를 돌려준다. 브로커는 기존 `rabbitmq` 컨테이너(Core와 같은 자격)다. ai-service와 같은 이미지의 `ai-worker`가 `AI_PREPROCESSING_CONCURRENCY`(Compose 기본 3)만큼 작업을 동시에 실행한다. `acks_late`라 워커가 도중에 죽으면 같은 태스크가 다시 배달되지만 Content 실행권(claim)이 이미 시작된 작업을 거절(`claimed=false`)한다. 만료된 적재만 load를 다시 시도한다. 추출 중 중단된 작업은 기한이 지난 뒤 사용자의 '같은 작업 재개'로 복구한다.
- **회차 추출 병렬화 ([#673](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/673)):** 같은 실행권에서 미저장 회차를 최대 4개씩 묶어 동시에 추출한다. 각 묶음의 `result` 콜백은 회차 순서대로 보내고, 저장이 확인된 회차를 실패 보고 대상에서 뺀다. `result`가 4xx면 남은 미저장 회차 전체를 `failed`에 보고하고 다음 묶음을 시작하지 않는다. 5xx·응답 유실은 실행 실패로 전파해 같은 작업을 재개할 때 Content의 저장 상태를 다시 읽는다. 정체 통합과 적재는 전체 회차의 결과가 저장된 뒤 순서대로 진행한다.
- **성능 비교** 기본값이면 워커 한 대에서 회차 추출 요청이 최대 12개 겹칠 수 있다. 모델 응답 스트리밍 적용 후 Windows 송신 경로로 재검증한 결과, 업로드 요청부터 적재 완료 확인까지 1작품×8회차는 129.23초, 3작품×2회차는 58.03~62.69초가 걸렸다. WSL 직접 송신에서 재현된 모델 연결 오류와 이전 측정값은 [#673 검증](../verification/issue-673-preprocessing.md)에 남겼다.
- **업로드 자동 시작:** 원고 가져오기(`POST /works/{id}/manuscript-imports`, `…/manuscript-imports/bulk`)가 회차를 하나 이상 저장하면 Content가 같은 요청 안에서 최초 구축 접수(위 '결과와 재실행'의 시작과 같은 검사·작업 행)를 시도한다. 별도 확인 없이 업로드 화면의 안내 문구로 OpenAI 전송을 알린다(동의 기록은 `consent=true`, key는 `import:<가져오기 요청 id>`). 세계관은 작품에 연결된 세계관, 없으면 새 UUID다. 현재 연결된 세계관의 최초 구축이 완료됐으면 다시 접수하지 않고 `WORLD_UPDATE_ON_PUBLISH` 코드와 “새 회차를 처음 발행하면 세계관 초안에 반영돼요.”를 반환한다. 그 밖의 경우 접수 결과를 가져오기 응답의 `worldBuild`에 싣는다: `{ "status": "started" | "rejected", "jobId": string|null, "code": string|null, "message": string|null }`(거절이면 시작 API와 같은 오류 code·한국어 문구, `WORLD_UPDATE_ON_PUBLISH`는 접수 대신 표시하는 다음 행동 안내다). 접수 실패가 가져오기 저장을 되돌리지 않는다. 일괄 가져오기는 묶음(요청)마다 `startWorldBuild`(기본 true)를 받아 화면이 마지막 묶음만 true로 보낸다(앞 묶음에서 일부 회차만 고정되지 않게). 마지막 묶음이 모두 실패하면 접수하지 않는다. 구축 응답(조회·시작·재개)은 `requestKey`를 실어, 브라우저에 요청 기록이 없어도(업로드가 시작한 작업·다른 브라우저) 응답의 worldId·requestKey로 같은 작업을 재개한다.
- **운영 화면:** Content 내부 `GET /internal/v1/preprocessing-jobs`·`POST …/{id}/retry`의 출처를 `manuscript_build_job`으로 바꾼다(응답 형식 유지). 재실행은 실패한 작업을 같은 작업으로 다시 접수한다. 목록은 `manuscript_build_job` 행만 고르고 진행 수·시각은 트리거가 맞춰 둔 같은 id의 `preprocessing_job` 행에서 읽는다(`unknown`은 `loading`으로 보인다).
- **회차 관리 표시:** 작품 관리는 기존 `GET /works/{id}/world-preprocessing`을 읽어 `queued`·`running`·`loading`이면 '세계관 추출 중' 배지를 보인다. 새 API는 없다.

### 긴 회차 추출 시간 예산 (#675)

- 모델 요청은 회차 추출의 읽기 최대 대기 시간 120초, 정체 정리 70초다(연결·쓰기·풀 대기는 기본 60초). 호출마다 자동 재시도 없이 한 번 실행하며 시간 초과는 작업에 `AI_TIMEOUT`으로 기록한다.
- Content의 실행권은 claim에서 `200초 × 입력 회차 수 + 150초`로 계산한다. 회차별 추출 120초와 정체 정리 70초에 각 연결 여유 60초와 검증·콜백 여유 20초를 더한 작업 예산이다. 요청마다 적용하는 읽기 대기와 작업 전체의 실행권은 별도 제한이다.
- 회차 추출과 정체 정리는 모델 응답을 Responses 스트리밍으로 받는다([#673](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/673)). 위 읽기 120초·70초는 응답 전체의 시간 제한이 아니라 스트림 이벤트 사이의 최대 대기 시간이다. 실행권 `200초 × 입력 회차 수 + 150초`는 회차를 직렬로 처리한다고 가정한 상한이다. #673 이후 회차를 최대 4개씩 동시에 추출하므로 정상 실행에는 넉넉하고, 대신 워커가 멈추면 실행 기한 만료 표시(`EXECUTION_EXPIRED`)가 그만큼 늦어진다(8회차 1,750초). 아래 5건의 측정은 스트리밍을 적용하기 전 #675 기준 코드에서 했다.

**4만 자 실모델 검증 (2026-11-24).** 합성 원고 다섯 건을 1회차 작업으로 하나씩 등록했다. 모델은 `gpt-6-luna`, 추출·정체 정리 프롬프트는 저장소 기본 버전으로 고정했다. 격리 테스트가 접수된 작업을 전처리 워커에 순서대로 전달했다. 작업 전체 시간은 업로드 요청부터 Content 완료 확인까지이며, 각각 PostgreSQL에 추출 결과와 적재 영수증이 1건씩 기록됐다. 시간 초과와 기타 실패는 모두 0건이었다.

| 사례 | 추출(초) | 정체 정리(초) | 작업 전체(초) | 추출 입력 / 출력 토큰 | 정체 정리 입력 / 출력 토큰 | 상태 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 35.08 | 1.70 | 47.49 | 27,915 / 3,372 | 1,198 / 66 | 완료 |
| 2 | 33.77 | 3.34 | 45.19 | 28,770 / 3,319 | 1,449 / 193 | 완료 |
| 3 | 29.42 | 1.81 | 38.22 | 28,202 / 2,810 | 932 / 68 | 완료 |
| 4 | 36.31 | 2.66 | 46.11 | 29,137 / 3,770 | 1,610 / 134 | 완료 |
| 5 | 35.22 | 2.06 | 45.09 | 29,310 / 3,973 | 2,118 / 105 | 완료 |

5건의 완료 결과와 앞선 70초 읽기 제한의 실측 실패 사례를 근거로, 회차 추출의 읽기 대기 한도를 120초로 확정한다. [기존 실측](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/665#issuecomment-7076335766)

## 발행 회차로 세계관 업데이트 (2026-11-22 사용자 결정)

최초 구축이 끝난 작품에서 회차를 처음 발행하면, 업로드 자동 시작과 같은 방식으로 그 회차를 세계관 **초안**에 더한다. 별도 화면·동의 단계는 없다. 위 '범위와 정본'의 "완료 후 신규 회차 자동 갱신 제외"와 409('이미 설정이 있는 세계관…')는 최초 구축(`kind=initial`)에만 적용한다.

- **기록:** `manuscript_build_job`에 `kind`(`initial`|`update`, 기존 행 `initial`)를 더한다. 업데이트도 같은 테이블·결과·적재 단계·`preprocessing_job` 트리거·운영 목록·재실행을 그대로 쓴다. 첫 발행에서 접수한 요청 key는 `publish:<episodeVersionId>`, 앞 작업 종료로 접수한 요청 key는 `continue:<jobId>:<lockVersion>`, 발행본 변경 때문에 운영이 새로 접수한 키는 `retry:<새 jobId>`다. 동의 기록은 `consent=true`다.
  구현: WorldStudio V16이 `kind`와 claim 때 정하는 `basis`(jsonb)를 더하고(V15 불변 트리거가 비교하는 입력 칼럼이 아니라 그대로 동작한다), Content V43이 V41 `preprocessing_job`에도 `kind`를 더해 부분 유니크 인덱스를 둘로 가른다: initial은 이전처럼 작품당 진행 중·완료 하나, update는 작품당 진행 중(`queued`·`running`·`loading`) 하나다(완료된 최초 구축 옆에 접수되고 동시 접수는 이 인덱스가 막는다). V15 트리거는 같은 id의 V41 행에 상태·진행만 맞추므로 update 행에서도 그대로 동작한다.
- **시작 조건:** 발행 동작이 `publish`(첫 발행, 수동·예약 모두)이거나 업데이트가 `completed`·`failed`로 커밋되면 접수를 시도한다(#674). `replace`·`republish`·되돌리기는 시도하지 않는다. 작품에 세계관이 연결돼 있고, 그 작품·세계관의 `initial` 작업이 `completed`이며, 같은 세계관에 끝나지 않은(`queued`·`running`·`loading`·`unknown`) 작업이 없을 때만 접수한다. 조건이 맞지 않거나 접수가 실패해도 발행은 그대로 성공하고, 사유는 코드 문자열로 로그에만 남긴다.
  구현: 최종 적재 또는 실패 전이에서 발행한 이벤트는 커밋 뒤에만 처리한다. `unknown`은 종료 상태가 아니다. 첫 발행·종료의 접수와 운영 재실행은 작품 행 잠금으로 중복 반영을 막고, AI 접수는 트랜잭션 밖에서 한다. `PublicationService.apply`가 `publish`일 때 트랜잭션이 있으면 커밋 뒤 콜백(롤백이면 없다)으로, 없으면 바로 `PreprocessingService.startUpdate`를 부른다(`PublicationService`는 의존 순환을 끊으려고 `@Lazy`로 받는다). 이 함수는 호출자의 트랜잭션을 중단하고 실행하며 예외를 던지지 않고 결과 코드(`STARTED`·`NO_WORK`·`NO_WORLD`·`INITIAL_NOT_COMPLETED`·`OPEN_JOB`·`NO_NEW_EPISODES`·거절 코드 또는 `HTTP_<상태>`·예외 종류)만 돌려준다.
  한계: 커밋 뒤 처리는 메모리 이벤트·콜백이라 영속 재처리 경로가 없다. 커밋과 처리 사이에 Content가 종료되면 그 접수는 사라지고, 미반영 발행 회차는 다음 첫 발행의 접수에 함께 포함된다. 다음 발행이 없으면 반영되지 않은 채 남는다(발표 범위에서 감수, 필요하면 기동 시 미반영 회차 재접수로 보완).
- **대상 회차:** 발행된 회차 중 아직 반영되지 않은 회차 전체다. 반영된 회차는 `completed` 작업 manifest에 들어 있던 회차 번호다. 앞선 업데이트 중에 발행한 회차는 작업이 끝난 뒤 이어서 처리한다. 실패 업데이트의 manifest에 있는 회차는 새 첫 발행과 종료 후 이어받기 모두에서 제외한다. 일부 회차의 추출이 저장된 실패 작업도 초안에 반영되기 전이므로 해당 manifest 전체를 보류한다. manifest는 각 회차의 **발행본** 버전(제목·본문·sourceHash)이다. Fork 상속 회차는 넣지 않는다.
  구현: 반영된 회차는 `completed` 작업(initial·update 모두) manifest 번호의 합집합이고, 발행본은 `episode_current.published_version_id`의 버전(`versionId`는 `contentVersionId`)이다. 발행본이 아닌 저장 버전·초안은 읽지 않는다. 원고 변경 검사(`SOURCE_CHANGED`)도 고정한 회차의 발행본만 비교한다(다른 회차의 새 발행은 다음 업데이트 몫이다).
- **기준 초안:** 업데이트 작업은 `claim` 때의 세계관 초안을 기준으로 고정한다. 추출 중에 초안이 바뀌면 최초 구축과 같이 `WORLD_CHANGED`로 실패한다.
  구현: manifest는 접수 때 고정하는 불변 입력이라 기준 초안을 거기에 쓰지 않고 V16 `basis`에 claim이 실행권을 받은 직후 현재 초안을 읽어 쓴다(읽을 수 없으면 `WORLD_CHANGED`). 이후 `prepareManuscript` 기준 검사와 카드 맞춤은 이 값을 쓰고, 큐에서 기다리는 동안의 작가 편집은 실패가 아니다. 최초 구축은 그대로 manifest의 `basis`를 쓴다.
- **AI:** 최초 구축과 같은 `preprocessing.run` 태스크와 회차 추출 병렬화 규칙으로 manifest 회차를 처리한 뒤 같은 적재 요청을 보낸다.
- **적재(Content):** 적재 요청의 카드를 기준 초안의 카드와 맞춘다.
  - 종류(`cardType`)와 이름(제목 또는 별칭)이 같은 기존 카드가 **정확히 하나**면 같은 대상으로 본다. 그 카드의 본문·제목·별칭·SOUL·GOAL·공개 설정은 바꾸지 않고, 인물 기억(`characterDocs.episodes`)에서 아직 없는 회차 키만 더한다. 적재 요청의 `00` 기억은 이 작업에서 처음 등장한 회차의 기억으로 옮긴다.
  - 맞는 카드가 없으면 새 카드(`visibility=private`)로 더한다.
  - 맞는 카드가 둘 이상이면 새 카드로 더하고 `semanticMetadata.manuscriptBuild.needsReview=true`를 남긴다. 화면은 이 카드를 '확인 필요'로 보인다.
  - 관계는 맞춘 카드 ID로 바꿔 DEC-51 회차별 관계로 더한다. 기존 관계는 교체하지 않는다. 사건 카드는 새 카드다.
  - 구현(`ManuscriptBuildMapper.build(update=true)`): 이름은 제목·별칭을 `trim`해 하나라도 같으면 같은 이름이고 삭제된(`removed`) 카드는 맞추지 않는다. 한 기존 카드를 요청 카드 여럿이 노리면 둘 이상 맞는 경우와 같이 새 카드+`needsReview`다. `00` 기억은 이 인물(요청 카드)이 이 작업에서 처음 등장한 회차(`firstAppearanceEpisode`) 키로 옮긴다: 작업의 첫 회차로 옮기면 뒤 회차에서 처음 나온 인물의 기억이 앞 회차 독자에게 먼저 보이기 때문이다. 새 카드의 `00`은 그대로 시작 전 기억(`0`)이다. 더할 키가 없는 맞춘 카드는 요청에 싣지 않는다(인물이 아닌 카드는 늘 그렇다). 적재 단계의 `WorldStudioService.edit`은 update 작업의 단계에서만 이미 있는 카드 초안을 다시 쓸 수 있고 최초 구축 단계는 계속 거절한다. 맞춘 카드가 요청에 든 만큼 영수증의 `cardIds`에도 든다.
- **확정:** 초안에 더하기만 하고, 확정은 작가가 기존 revisions API로 한다.
- **조회·화면:** `GET /works/{id}/world-preprocessing` 응답 최상위(`build`와 나란히)에 `update`(진행 중인 업데이트를 우선하고 없으면 가장 최근 작업의 `{jobId, status, episodes:[회차 번호], failureCode}`, 없으면 null)를 더한다. 기존 필드는 계속 최초 구축 작업을 가리킨다(`update.status`는 `build.status`와 같은 값이라 만료된 실행·적재 결과 확인 대기는 `unknown`이다). 작품 관리 '공개 회차' 머리에는 `update.status`가 `queued`·`running`·`loading`이면 '세계관 업데이트 중' 배지를 보인다.
- **한계:** 실패한 업데이트는 이후 작업이 끝난 뒤에도 운영 작업 감시에서 재실행할 수 있다. 작품이 같은 세계관에 연결돼 있어야 하고, 다른 작업이 진행 중이면 409다. `SOURCE_CHANGED`로 실패한 작업은 운영이 재실행할 때 원래 입력 중 아직 반영되지 않고 현재 발행본이 있는 회차만 새 작업으로 접수한다. 남은 회차가 없으면 409다. 기존 작업을 그대로 재실행할 때는 이미 다른 작업이 반영한 회차가 원래 입력에 하나라도 섞여 있으면 409다. 이름이 다른 같은 대상(별칭이 처음 나온 경우)은 자동으로 합치지 않는다.
  구현: 최초 구축은 같은 종류의 가장 최근 작업만 재실행한다. 발행본 변경으로 새로 접수할 때는 이전 작업을 실패 이력으로 보존한다. 그 밖의 업데이트 재실행은 기존 manifest·추출 결과를 재사용하고 실패 회차(없으면 manifest 전체)를 재접수한다. AI 접수 응답이 없으면 실행권이 없는 `queued` 작업을 `AI_INTAKE_FAILED`로 실패 처리한다(AI가 이미 받았다면 그 `claim`이 먼저 실행권을 가져가 거절되고, 늦게 도착한 접수는 `claim`이 `queued`가 아니라서 거절한다). 업데이트 작업이 끝나지 않은 채 AI가 멈추면 최초 구축과 같이 다음 접수를 막는다(실패했거나 실행 기한이 지난 작업은 운영 재실행으로 푼다). 발행 요청은 AI 접수 호출(읽기 제한 10초)이 끝난 뒤 응답한다. 기존 관계와 같은 (시작·끝·이름)의 새 관계가 나오면 따로 합치지 않고 그대로 더한다.

## 최초 구축 사용자 화면

View → ViewModel → ManuscriptBuildUseCase → HttpManuscriptBuildRepository → 기존 Content API를 사용한다. 목업에서는 이 실행 패널을 그리지 않는다.
화면 진입/업로드/새로고침은 GET만 수행한다. 명시적 동의 후 POST 직전에 계정·작품별 localStorage에 worldId/key/consent를 보존한다. 재접수·통신 실패·재로그인으로 key를 교체하지 않는다. 브라우저 Web Lock과 진행 중 버튼 잠금으로 중복 입력을 막는다.
진행 중은 상태 GET만 2초 간격으로 조회하며 조회 실패는 오류로 남긴다. failed/unknown은 사용자가 같은 작업 재개를 눌러야 한다. failed는 항상 '같은 작업 재개'와 함께 동의 뒤 '새로 시작' 폼을 보이고, 새로 시작은 새 key와 지금 작품에 연결된 worldId(없으면 실패한 작업의 worldId, 그것도 없으면 새 UUID)로 POST한다. 서버는 작품에 연결된 세계관만 받으므로 연결이 바뀐 뒤에도 409 없이 새로 시작된다. 조회가 404이거나 `recovery=new_request`이면 저장해 둔 요청 기록을 지운다. 실패 재개는 최신 executionToken, 적재 unknown 복구는 원래 요청을 사용한다. 완료 상태는 전체 회차 수와 해당 job/world의 receipt를 확인한 경우만 표시한다.
초안 열기는 기존 WorldStudio 경로이며 확정/공개/발행을 실행하지 않는다. 이미 작가가 확정한 뒤 돌아올 수 있으므로 완료 안내는 현재 미확정이라고 단정하지 않는다.
요청 key는 구축 응답의 `requestKey`로 받으므로 다른 브라우저에서도 같은 작업을 재개한다(임의 새 key로 재개하지 않는다). 교차 기기 취소/재구축은 이번 범위 밖이다.
