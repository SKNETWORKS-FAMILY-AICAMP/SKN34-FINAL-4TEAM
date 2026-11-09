# 초기 세계관 AI 전처리 v1 구현 계약

상태: **계약·합성 fixture·순수 검증만 작성. API·DB·AI 호출·화면은 미구현.**
기준: develop `dff27a53a427cb23e14562e514943258d1f8789b`.
작가가 승인한 방향과 2026-11-09 보완 요청을 반영한다.

## 범위와 책임

저장된 독립 세계관 초안 → AI 후보 → 작가 검토 → 승인 정보의 초안 추가를 다룬다.
인물·장소·조직을 자동 생성하거나 기존 카드 원문을 덮어쓰지 않는다. 같은 이름만으로 병합하지 않는다.
미등록/동명이인 참조는 diagnostics로 남기고 자동 반영하지 않는다. 작가가 등록·정정한 뒤 재분석한다.
Content가 소유권·원문·revision·검토·반영을 관리하고 AI는 전달받은 자료에서 후보만 반환한다.
브라우저는 기존 인증·CSRF를 사용하는 Content의 `/api`만 호출한다.

- [서비스 경계](../service-boundaries.md), [이관 계약](../content-service-migration-contract.md), [현재 관계 MVP](../worldstudio-independent-schema.md)를 따른다.
- [#122](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/122)는 작품/회차 원고·판본·Fork·관측 범위 기반 추출이다. 이번 PR은 #122를 완료/종료하지 않는다.
- 확정은 기존 `POST /api/v1/world-studios/{id}/revisions`의 별도 작업이다. 후보 승인은 확정도 저장 성공도 아니다.
- 관계 정본은 Neo4j 현재 상태 하나다. 관계 후보 감사 기록은 과거 그래프/관계 복원의 정본이 아니다.
- 모델 호출, migration, API 구현, UI 수정, Context 연결, 큐·워커·새 DB·프레임워크는 이 PR에서 제외한다.

## 파일과 스키마 적용

- [contract.schema.json](contract.schema.json): Pydantic이 생성한 JSON Schema 2020-12 호환 구조. `$defs/Input`, `Output`, `AnalysisRequest`, `AnalysisResponse`, `DecisionRequest`, `DecisionRecord`, `ApplicationRequest`, `ApplicationResponse`를 각 경계에서 사용한다.
- 최상위 `Contract`는 한 신규 반영 시도 전후의 검증 자료를 모은 **테스트 전용 봉투**이며 HTTP 요청 DTO가 아니다. 완료 receipt 재조회 경로를 흉내 내는 모델이 아니다. `currentDraftRevision`, `appliedCandidateIds` 등을 클라이언트가 권위 있는 값으로 보내지 않는다.
- [실행 계약](../../../backend/ai-service/tests/initial_world_contract.py)은 테스트 전용이다. 서비스 코드에서 import하지 않는다. 모델의 `extra=forbid`로 미정 필드를 거부한다.
- JSON Schema는 형태/타입/길이/enum을 검증한다. ID 존재, 인용 일치, 해시, 상태 전이, 유형별 필수 조건 등은 실행 계약과 아래 규칙을 함께 적용한다. Schema만 통과했다고 반영 가능하지 않다.
- [홍길동전 fixture](honggildong.json)는 원전 인용이 아닌 직접 작성한 합성 자료다. 정상 7유형, 오류 변형 목록을 포함한다. 모델 정확도나 배포 검증이 아니다.
- UUID 문자열, 기존 프런트와 같은 `0..Number.MAX_SAFE_INTEGER` revision, 기존 카드 본문 3,000자·제목 200자·별칭 100개 제한을 따른다. 저장 전에 JVM의 UTF-16 길이 제한도 별도로 검사한다(JSON Schema 길이는 Unicode 문자 수).
- 요청 key는 기존 서버 한도(UTF-8 200바이트) 안의 ASCII 1~200자로 제한한다. 새 계약만의 좁은 입력 제약이며 기존 API는 변경하지 않는다.

## 입력과 근거: UTF-16

`Input`은 Content가 소유자의 저장된 활성 카드/세계관 설명에서 구성한다. 미저장 입력은 먼저 저장하며 실패하면 분석하지 않는다.
`basis`에는 `draftRevision`, `relationshipVersion`, `currentRevisionId`, `inputHash`를 고정한다.
`sources`는 `sourceId`, 원문 소유 `ownerId`, `field`, 변형하지 않은 `text`, UTF-8 SHA-256 `textHash`를 가진다.
`sourceId`는 `world:{uuid}:description` 또는 `card:{uuid}:{title|body}`이며 분석 안에서 유일하다.
source 소유 ID/필드는 실제 같은 세계관의 원본과 대조한다. `entities`는 같은 초안의 기존 활성 엔터티 ID/유형/이름/별칭이다.
원문 소유 카드가 반드시 인물 카드는 아니다. 규칙·사건 카드도 출처가 될 수 있다.
실행 계약은 sourceId가 ownerId/field로 구성한 값과 정확히 같은지 검사하고,
description 출처의 ownerId가 input.worldId인지 검사한다. 카드가 실제 같은 세계관에 속하는지,
활성 상태인지, 본문이 DB 원문과 같은지는 Content의 snapshot 구성 단계에서 따로 검증한다.
entities에 없는 규칙·사건 카드도 출처가 되므로 entities 목록만으로 출처 소속을 판정하지 않는다.

좌표는 [집필 AI 검색 계약](../../writing-ai-architecture/07-retrieval-contract-and-mocks.md)과 같은 **UTF-16 코드 단위 `[start,end)`**다.
공백·CRLF·Unicode 정규화를 바꾸지 않는다. 입력의 고립 surrogate는 거부한다.
Python에서는 원문을 `encode('utf-16-le')`한 뒤 `[start*2:end*2]`를 `decode('utf-16-le', errors='strict')`한다.
`0 <= start < end <= len(encoded)//2`를 검사하고 surrogate pair 중간 경계는 거부한다. Python 문자열 인덱스를 그대로 사용하지 않는다.
Python 인덱스 p의 변환은 `len(text[:p].encode('utf-16-le')) // 2`다.
`quote`는 이 결과와 완전히 같아야 하고 `quoteHash`는 그 인용문의 원본 UTF-8 바이트 SHA-256이어야 한다.
예: `홍😀\r\n길동`의 이모지 범위는 `[1,3)`, CRLF는 `[3,5)`다.

AI 출력 근거는 `sourceId/start/end/quote/quoteHash` 형식이다. Content는 인용과 해시를 **재계산해 검증**한다. 모델 값을 신뢰하지 않는다.
원문 스냅샷도 PostgreSQL에 보존한다. 해시만 보관하면 원본 수정 이후 근거를 복원할 수 없다.
입력 해시는 `Input`에서 analysisId와 basis.inputHash를 제외하고 sources는 sourceId, entities는 cardId순 정렬한다.
모든 객체 키를 사전순 정렬하고 `ensure_ascii=False`, 구분자 `,`/`:`, 공백 없는 UTF-8 JSON의 SHA-256을 사용한다.
배열 내부 순서는 위 두 정렬을 제외하고 보존한다. 후속 Kotlin 구현은 이 fixture와 동일 바이트/해시를 만들어야 한다.
허용 문맥 한도를 넘으면 명시적 오류로 반환한다. 조용히 자르거나 일부 분석을 전체 완료로 표시하지 않는다.

## 의미 정보와 출처

후보 유형은 `fact/relation/rule/event/conjecture/goal/plan`이다. AI 응답은 `localRef`만 만들며 실제 후보/카드 UUID·승인·저장 상태를 결정하지 않는다.
`subjectId`, `relatedEntityIds`, 관계 양 끝 ID는 입력의 기존 ID만 참조한다. `goal/plan`은 주체가 필수다.
규칙 등 주체가 없는 정보는 null을 허용한다. 조건·시간은 `condition/timeText`로 보존하고 날짜나 발생 여부를 추측하지 않는다.
`relation` 유형에만 관계 payload를 허용한다. `structural/emotional`, `directed/symmetric`, `asserted/denied`와 서로 다른 활성 양 끝 ID를 요구한다.
관계 설명은 후보 text, 관계 제목/명칭은 relation.label로 기존 RelationshipPayload에 매핑한다.
계획·목표·추측은 event/fact/현재 관계로 자동 변환하지 않는다. 정확한 의미 분류는 모델 품질+작가 검토 대상이며 JSON Schema만으로 자연어 진실성을 증명하지 않는다.

| provenance | 유효 근거 | 보존 방식 |
|---|---|---|
| ai_extraction | 원문과 검증된 evidence 필수 | AI 원본 후보와 입력 스냅샷 불변 |
| author_revision | 수정본 evidence는 빈 배열 | 원본 후보 ID로 원래 AI 내용·근거를 별도 조회 |
| author_addition | evidence는 빈 배열 | 작가가 추가한 내용임을 표시 |

작가 수정 전체를 새 내용으로 취급하는 보수적 v1이다. 기존 AI 근거를 수정본의 증명으로 복사하지 않는다.
원래 근거는 삭제하지 않으며 화면에서 “수정 전 AI 제안의 근거”로만 표시한다. 작가가 새로운 독립 엔터티/후보를 만드는 편집기는 이 범위 밖이다.
`edit`는 수정 이력과 pending 상태를 만든다. 이후 별도의 approve가 해당 sequence의 내용을 승인한다.
approve/hold/reject에 본문 수정값을 함께 보내지 않는다. 수정은 반드시 edit로 기록한다.

생성되는 의미 카드의 `semanticMetadata.studio.item`에는 기존 subjectId/relatedIds를 유지한다.
추가 provenance에는 analysisId/candidateId/decisionSequence/basisDraftRevision과 semanticType을 기록한다.
goal/plan은 기존 물리 cardType `other`와 명시적 semanticType을 사용한다. 인물/장소 카드를 복제하지 않는다.
UI는 subjectId와 relatedIds로 “이 인물/장소의 관련 설정”을 묶을 수 있다. 자동 UI 변경은 이 PR에 없다.
현재 프런트 Zod가 새 metadata를 제거할 수 있으므로 후속 PR에서 왕복 보존을 추가해야 한다.
현재 `authorEdit()`는 evidence를 지우므로 AI 원본 기록을 수정하는 용도로 재사용하지 않는다.

후속 DTO 매핑 예(새 필드는 아직 프런트에 구현되지 않음):

```json
{
  "studio": {
    "item": {
      "id": "새 의미 카드 UUID",
      "kind": "note",
      "subjectId": "기존 홍길동 UUID",
      "relatedIds": ["기존 율도국 UUID"]
    }
  },
  "preprocessing": {
    "semanticType": "goal",
    "provenance": "ai_extraction",
    "analysisId": "분석 UUID",
    "candidateId": "후보 UUID",
    "decisionSequence": 1,
    "basisDraftRevision": 12
  }
}
```

위는 필드 위치 설명용 부분 객체다. 실제 CardPayload의 나머지 필수 필드는 기존 DTO대로 채운다.
새 의미 정보의 기본 visibility는 private이다. 원본 카드의 aliases/tags/metadata는 변경하지 않는다.
현재 프런트 관계 predicate의 `other` 그룹은 저장을 거부하므로 DTO 표현 가능 여부와 화면 왕복 가능 여부를 구분한다.
후속 UI PR은 기존 관계의 custom_relation_directed/custom_relation/custom_emotion과 label/body 매핑을 검증해야 한다.

## API와 분석 실행 수명

아래는 **추가 예정 계약**이다. 기본 경로는 `/api/v1/world-studios/{worldId}`다.

| 경로 | 입력/출력 | 응답 |
|---|---|---|
| POST /analyses | AnalysisRequest → AnalysisResponse | 완료 200, 같은 키 실행 중 202, 다른 입력의 같은 키 409 |
| GET /analyses | AnalysisResponse 배열 | 200 |
| GET /analyses/{id} | AnalysisResponse | 200; 실행 중은 상태 필드로 표현 |
| POST /analyses/{id}/candidates/{candidateId}/decisions | DecisionRequest → DecisionRecord | 200; 검토 순번 충돌 409 |
| POST /analyses/{id}/applications | ApplicationRequest → ApplicationResponse | 완료 200, 처리 중 202, stale/중복 내용 충돌 409 |

분석 상세의 candidateIds는 output.localRef → 후보 UUID 매핑이다. decisions는 불변 검토 이력을 순번과 함께 반환한다.
검토 기록이 없는 후보는 sequence=0/pending이며, 이후 가장 큰 sequence의 state/content가 최신 검토 상태다.
동일 후보의 다중 검토 이력을 허용하고 `(candidateId, sequence)`만 유일해야 한다.
배열 순서와 무관하게 최대 sequence가 최신이다. 이후 edit/hold/reject가 있으면 과거 승인으로 반영할 수 없다.
기존 후보 edit는 `author_revision`만 허용한다. `author_addition` 자료형은 보존하지만 독립 추가 API는 범위 밖이다.
검토 API의 expectedDecisionSequence는 이 최신 sequence와 비교한다. edit→pending, approve→approved, hold→held, reject→rejected이다.
인가 실패는 기존 404 정책, 입력/근거/참조 오류는 422, 모델 실패·결과 미확인은 503과 analysisId를 반환한다. 인증 실패는 기존 인증 계층을 따른다.
기존 오류 DTO 형식을 유지하고 구체 오류 code는 후속 API PR에서 추가한다.

1. Content가 짧은 DB 트랜잭션에서 원문 snapshot·입력 hash·요청 key·실행 소유 token·deadline을 저장한다.
2. 트랜잭션 밖에서 한 번 AI를 호출한다. 기존 내부 인증/FastAPI/Pydantic/모델 클라이언트를 재사용한다. 기존 이어쓰기 `/internal/v1/proposals` 계약을 바꾸지 않으며 추출용 내부 DTO는 Input→Output이다.
3. 소유 token·deadline을 재검사하고 검증된 출력/후보를 한 트랜잭션에 저장한다. 원본이 바뀌었으면 완료 결과를 stale로 보존하지만 반영은 차단한다.
4. 같은 world/key와 같은 expectedDraftRevision/입력의 재전송은 기존 기록을 조회한다. 원본을 새로 읽어 기존 요청 내용을 바꾸지 않는다. completed는 같은 결과, running은 202, failed/unknown은 실패 상태를 반환한다. 같은 키 다른 내용은 409다.
5. 202는 `Location`으로 상세 조회 경로를 안내한다. 별도 작업을 큐에 넣었다는 뜻이 아니다. 원래 요청 프로세스만 호출을 계속한다.
6. deadline은 호출/완료 기록 제한시간을 포함한 고정 시각으로 요청 생성 시 저장한다(초기 구현 제안: 모델 timeout 60초, 전체 90초). 재요청으로 연장하지 않는다.
7. 프로세스 종료로 running이 남으면 GET/POST 재조회 시 deadline 경과를 검사해 CAS로 unknown 처리한다. 주기 워커 없이 조회 시 복구한다. 다른 프로세스가 원래 호출을 자동 재실행하지 않는다.
8. 늦은 응답은 token·running 상태·deadline 검사에 실패하면 완료로 덮어쓰지 않는다. 이미 DB에 completed가 있으면 그것이 우선한다.
9. unknown은 모델 실행/과금 여부를 모를 수 있다. 작가의 명시적 새 분석 요청(새 key)만 재호출한다. 같은 요청 중복 실행을 “한 번만 과금”으로 보장한다고 표현하지 않는다.

## 부분 추가 저장과 장애 복구

`HttpWorldStudioRepository.saveStudio()`는 **replace:true 전체 교체**다. AI 반영에 호출하거나 후보만 담아 보내지 않는다.
Content가 저장된 최신 name/description을 유지하고 승인된 신규 의미 카드/관계만 모아 `WorldStudioService.edit()`의 `replace:false`로 전달한다.
기존 ID를 업데이트 payload의 id로 넣지 않는다. 원본 ID는 의미 카드의 참조에만 사용한다.
최신성 검사 후 저장 준비 사이의 경쟁도 기존 expectedDraftRevision/CAS로 막는다. 무조건 승인 시점의 이름·본문으로 덮어쓰지 않는다.

후속 migration은 기존 worldstudio schema에 analysis/candidate/decision/application 기록을 추가한다. 기존 migration 수정, 관계 이력 테이블 재사용은 금지한다.
application에는 요청 hash, 승인된 decision sequence, 생성 ID 매핑, **추가 payload**, basis revision, 상태를 저장한다.
전체 과거 관계 그래프는 저장하지 않는다. 새 UUID는 준비 단계에서 한번 정해 영속화하고 이후 변경하지 않는다.
동일 후보가 다른 application key로 중복 반영되지 않도록 후보별 예약/완료를 잠금·제약으로 보호한다.
검토·반영의 candidateId는 해당 분석이 발급한 localRef→UUID 매핑과 일치해야 한다.
검토와 반영 요청의 UUID를 함께 바꿔도 다른 후보로 인정하지 않는다. 후속 저장 PR은
world→analysis→candidate 소속을 외래 키/검증으로 보호하고 검토 순번은 후보 안에서 유일하게 둔다.

| 장애 위치 | 보존되는 값 | 재시도/완료 판정 |
|---|---|---|
| application 준비 commit 전 | 기존 후보·검토 기록 | 롤백. 새 준비 가능, 아직 정본 변경 없음 |
| 준비 commit 후, Neo4j 전 | application key/hash, 추가 payload, 생성 ID, 후보 예약 | 같은 요청으로만 재개. ID 재생성 금지 |
| Neo4j 응답 유실/timeout | 위 기록과 relationship_state 미완료 | 결과 unknown. 같은 key/hash/CAS로 기존 그래프 결과를 확인/재시도 |
| Neo4j 성공, PG finalize 실패 | 그래프의 요청 식별자와 준비 기록 | 같은 요청으로 finalize 재개. 새 그래프 관계를 중복 생성하지 않음 |
| PG finalize 성공, HTTP 응답 유실 | 초안 revision+반영 완료 receipt | 같은 요청은 receipt 반환. 현재 revision이 더 진행돼도 성공을 stale로 뒤집지 않음 |

카드 반영·draft revision 증가·relationship_state 완료·application 완료 receipt는 **같은 worldstudio PostgreSQL 최종 트랜잭션**에서 commit한다.
이 연결은 후속 저장 PR의 필수 변경이다. 기존 edit 호출 뒤 별도 트랜잭션으로 receipt만 쓰는 구현은 금지한다.
미완료 application이 있으면 다른 초안 쓰기/반영도 차단해 원래 복구 식별자가 유실되지 않게 한다. 복구는 application의 같은 payload로 수행한다.
정본 비적용이 증명된 실패만 재검토 가능 상태로 돌린다. 결과 미확인은 예약을 풀거나 부분 성공을 전체 성공으로 표시하지 않는다.
기존 전송 오류는 PG/Neo4j 전체 rollback을 뜻하지 않는다. 이 표는 구현 요구이며 이번 PR에서 DB 장애 주입으로 증명하지 않았다.
분석 이후 revision 또는 graph version이 달라졌으면 신규 반영은 409 ANALYSIS_STALE이다.
최초 성공 receipt 조회는 stale 검사보다 먼저다. 한 분석에서 선택한 후보를 한 번 반영한 뒤 나머지는 재분석한다.

## 검증과 후속 PR

로컬/CI 순수 단위 명령(backend/ai-service):

```sh
uv run --locked --extra dev python -m pytest -m 'not integration' tests/test_initial_world_contract.py
```

Schema 재생성(저장소 루트, 기존 AI 환경의 Python 사용):

```sh
python -c "import sys,json; from pathlib import Path; sys.path.insert(0,'backend/ai-service/tests'); from initial_world_contract import Contract; Path('docs/design/initial-world-preprocessing/contract.schema.json').write_text(json.dumps(Contract.model_json_schema(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')"
```

JSON Schema와 실행 계약의 일치, 7유형 정상 예, 22개 오류 변형, UTF-16/CRLF/surrogate,
작가 수정 근거 분리, 미완료 응답을 검사한다. ID·근거·검토 순번·중복·stale는 fixture 수준이다.
자연어 추출 정확도, HTTP 상태/경쟁, 실제 persistence·재로그인·DB 장애 복구·UI는 미검증이다.
새 의존성/lockfile 변경 없음. AI 테스트 경로 변경으로 기존 CI가 AI 검증을 선택한다.

| PR | 의존성·완료 조건 |
|---|---|
| 1 이 계약 | 문서/Schema/fixture/순수 검증만. 기능 완료로 roadmap 체크하지 않음 |
| 2 저장 구조 | PR1. 불변 snapshot/검토 이력, application ID 예약, world 소속·중복 제약, migration CI |
| 3 분석 실행 | PR2. snapshot 구성/해시, Input→Output, 202/중복/deadline/프로세스 중단 복구 HTTP 테스트 |
| 4 검토·반영 | PR3. 수정/승인 분리, replace:false, 참조·stale, 단계별 장애/receipt/idempotency DB 테스트 |
| 5 UI | PR4. 후보 UUID/검토 이력 조회 연결, metadata 왕복, 관련 설정 그룹화, 미저장 보호, 검토/반영 표시 |

확정 UI 및 확정본 기반 집필 AI Context는 별도 후속이다. 미승인 후보/초안을 확정 문맥으로 섞지 않고 관계를 넣는다면 current와 graph version을 명시한다.
