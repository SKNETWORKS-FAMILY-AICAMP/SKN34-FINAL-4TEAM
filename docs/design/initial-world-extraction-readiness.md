# 초기 세계관 AI 추출 5단계 구현 준비

2026-11-09, 소스 기준 develop `51b7024a`. #219 계약 보완 `6c5ed7d8`, #225 저장 구조를 선행으로 한다.
이 문서는 구현 준비이며 모델 호출·새 API·DB 변경을 수행하지 않는다. #223 UI와 관계 과거 복원은 별도다.

## 계약 감사

- #219의 동일 후보 검토 중복 판정은 `(candidateId,sequence)`로 보완했다. 최신 순번만 승인 반영 대상으로 선택한다.
- sourceId/ownerId/field와 world description의 worldId 일치를 검사한다. 실제 카드 소속·활성·원문 검증은 Content가 담당한다.
- edit는 author_revision/evidence=[]로 #225와 일치한다. author_addition은 데이터 표현이며 독립 추가 API는 제공하지 않는다.
- #225의 candidate/decision 복합 FK·불변 trigger·순번 유일성은 위 계약과 일치한다. JSONB만으로 전체 스키마·인용 검증을 대체하지 않는다.
- **후속 검토 API 전 보완 필요:** DecisionRequest.key/comment/expectedDecisionSequence 중 #225는 sequence/action/content/actor만 보관한다.
  검토 요청 멱등 key/hash와 comment를 기록할 migration 및 회귀를 검토 API PR에 포함해야 한다. 지금 검토 API가 완성됐다는 뜻이 아니다.
- 실행 상태 전이·token/deadline·최신성 검사는 저장 엔터티만으로 제공되지 않는다. 아래 실행 PR의 필수 조건이다.
- Input.basis.inputHash는 스냅샷 내부 입력 내용 hash다. analysis.request_hash는 요청 key의 입력 일치 판정용이며 둘을 혼용하지 않는다.

## 재사용 지점과 경계

| 기존 소스 | 재사용 | 추가할 최소 동작 |
|---|---|---|
| WorldStudioService.draft, owned, WorldDraftResponse | 소유자·완료 관계 상태·두 저장소 version 정합성 검증 | 반환된 저장 초안에서 Input 구성, snapshot 예약 직전 잠금 후 revision/graph 재검사 |
| world.studio entity/repository, worldStudioTransactionManager | #225 분석·후보 저장, @Version | key 조회·잠금·완료 CAS를 실행 서비스에 연결 |
| #219 Input/Output 및 fixture | 스키마/UTF-16/해시/ID 회귀 | 테스트 모듈 import 금지. production DTO로 옮기고 schema parity 테스트 유지 |
| AI app/generation/router.py | 기존 내부 인증 방식, OpenAI timeout=60/max_retries=0/store=False | 추출 전용 router/DTO/함수. 이어쓰기 /internal/v1/proposals 입력·출력은 유지 |
| 기존 HTTP proxy·CoreAuthClient·CSRF | Content만 사용자 인가 | 브라우저는 Content /api 호출, AI/DB 직접 접근 금지 |

현재 develop의 AI 앱에는 전처리 production 모듈이 없다. 기존 PoC는 이 브랜치로 통째로 이식하지 않는다.
재사용 가능한 것은 검증된 스키마/fixture/프롬프트 자료뿐이며 PoC의 자동 정본 쓰기·자체 ID 발급·정규화는 재사용하지 않는다.
모델 제품/모델명은 기존 환경 설정을 사용하고 새 프레임워크·큐·워커·DB·production 의존성을 추가하지 않는다.

## 입력 스냅샷 구성

1. 인증된 소유자가 POST /api/v1/world-studios/{worldId}/analyses에 key와 expectedDraftRevision을 보낸다.
2. 소유자 검증 후 같은 world/key 기록을 먼저 확인한다. 이미 있는 요청은 원본을 다시 읽거나 hash를 바꾸지 않는다.
3. 신규 요청만 저장된 draft를 읽는다. 미저장 UI 내용은 받지 않는다. 관계 상태가 incomplete/migration_required이면 분석하지 않는다.
4. 활성 카드 title/body 및 세계관 description을 원문 그대로 sources에 넣는다. sourceId는 world/card 소유 ID와 field에서 만든다.
   필드 빈 값의 포함 규칙은 DTO 구현 시 fixture로 고정한다. 원문 trim/CRLF/Unicode 정규화 금지.
5. entities에는 기존 활성 엔터티 ID와 유형·이름·별칭을 넣는다. 새 인물·장소·조직 ID를 AI가 만들지 않는다.
   규칙·사건 카드도 sources에는 가능하지만 엔터티 목록을 억지로 늘리지 않는다.
6. 같은 PG tx에서 소유자/world 잠금을 획득하고 draftRevision/relationshipVersion/currentRevisionId를 재검사한 뒤
   analysis ID·snapshot·요청 hash·executionToken·createdAt/deadline을 고정한다. 준비 중 원본 변경이면 409.
   해시는 #219의 정렬 및 UTF-8 JSON 규칙을 fixture와 대조한다. Kotlin/JVM UTF-16 길이 한도도 검사한다.

## 실행·출력

- 내부 추출 입력/출력은 #219 Input → Output. API 경로는 기존 proposals와 다른 내부 경로로 정하고 실행 PR에서 명시한다.
- 7유형 fact/relation/rule/event/conjecture/goal/plan만 허용. 목표/계획/추측을 이미 발생한 사건으로 변환하지 않는다.
- evidence는 UTF-16 [start,end), sourceId, quote, quoteHash다. Content에서 소속·인용·해시·경계를 다시 확인한다.
- 후보 참조 ID는 입력 entities에 있어야 한다. relation의 서로 다른 양 끝·종류·방향·극성, goal/plan의 subject 필수 검증.
- AI는 localRef만 발급한다. Content가 UUID를 발급하고 validated Output·후보들을 완료 상태와 **같은 PG tx**에 저장한다.
- 외부 모델 요청은 PG tx 밖에서 실행한다. 호출 중 원문 변경은 결과를 보존하되 freshness=stale로 응답한다.
- 후보 검토/초안 반영/확정 저장을 호출하지 않는다. 카드·Neo4j 관계를 변경하지 않는다.
- 부분 후보만 저장하고 completed로 표시하지 않는다. JSON/근거 검증 실패는 전체 분석 실패로 기록한다.

## 동일 요청·장애 계약

| 상황 | 처리 |
|---|---|
| 같은 world/key·같은 요청 | running 202+Location, completed 200 동일 결과, failed/unknown 실패 상태 반환 |
| 같은 key·다른 expectedDraftRevision/요청 hash | 409, 기존 snapshot 보존 |
| 모델 실패/timeout | analysisId 포함 503, 명백한 실패 failed·실행 결과 미확인 unknown을 구분 |
| 서버 종료로 running 잔존 | GET/POST 재조회에서 deadline 경과 CAS로 unknown. 자동 재호출 금지 |
| 늦은 모델 응답 | token/status/deadline 조건과 @Version CAS를 재검사. unknown/완료 결과 덮어쓰기 금지 |
| 모델 완료 후 PG 저장 실패 | 새 UUID/일부 후보가 밖으로 노출되지 않게 롤백. 동일 키에서 모델을 다시 호출하지 않음; commit 여부를 재조회해 완료 우선 |
| 결과 응답 유실 | 같은 key로 저장 결과 재조회. 현재 draft가 바뀌어도 기존 분석을 새 요청으로 대체하지 않음 |
| 재분석 | 사용자가 새 key로 명시적으로 요청. timeout이 한 번만 과금됐다는 보장은 하지 않음 |

초기 모델 timeout 60초/전체 deadline 90초는 #219의 제안값이며 실행 PR에서 구성·검증한다.
freshness는 현재 revision 비교 결과이며 과거에 저장된 current 값으로 판단하지 않는다.

## 작은 PR 순서와 검증

1. Content snapshot/검증 함수와 production DTO: 한국어·이모지·CRLF hash parity, source 위조, 같은 이름 다른 ID, 비엔터티 출처,
   카드 삭제·세계관 권한·경합·입력 한도 테스트. 서비스 단위 Red→Green, HTTP/DB는 CI.
2. AI 내부 추출: 제공사 대역으로 7유형, 잘못된 JSON/ID/근거·프롬프트 주입·timeout/불완전 응답을 확인. 유료 모델 호출 없음.
3. Content 분석 실행 연결: key 동시 요청 1회 실행, 202, token/deadline, 서버 중단 복구, stale, 완료 commit 실패/응답 유실,
   후보와 완료의 원자성 검증. 입력과 기존 정본이 변경되지 않는 DB/Neo4j 회귀 포함.
4. 별도 검토/반영 PR: 검토 key/comment 보관 보완, 최신 승인·부분 추가·receipt 원자성, Neo4j/PG 단계별 장애 테스트.

시점 관계·회차 체크포인트·Fork 확장은 이 1~3의 선행 조건이 아니다. 초기 세계관 분석은 소유자의 **저장 초안/current 관계 기준**이며
회차 기반 #122나 특정 회차 집필 Context 조회를 완료 처리하지 않는다.
