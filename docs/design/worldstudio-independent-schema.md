[메인 README](../../README.md) · [문서 목록](../README.md)

> PR #98 리뷰 반영: 독립성은 worldstudio 스키마·Flyway 이력·업무 경계에 적용한다. 실행 시 기존 Core PostgreSQL DataSource와 기본 JPA/트랜잭션 인프라를 공유한다. 조건부 등록으로 비활성 시작 계약을 유지한다. 독립 SQL에는 Auth/Content migration 선행 조건이 없으며 기존 Content 테이블·코드에 대한 업무 의존을 추가하지 않는다. 아래의 과거 전용 연결/JPA 검증 설명은 [현재 실행 계약](../../backend/content-service/src/main/resources/db/migration/worldstudio/README.md)으로 대체한다.

# WorldStudio 독립 초기 스키마 재설계안

작성일: 2026-11-04. 상태: 독립 V1 및 JPA Repository·Service 구현. 공용 DB 적용·HTTP API/기존 UI 전환 완료를 뜻하지 않는다. 최신 실행 결과는 [JPA 검증 기록](worldstudio-jpa-verification.md)을 따른다.

## 현재 관계 MVP 계약 — #132

2026-11-05 사용자 변경 결정: **관계 내용은 Neo4j의 현재 상태 하나만 정본으로 저장한다. 관계 변경 이력·과거 snapshot·버전 조회·복원은 만들지 않는다.** DEC-27·33의 관계 이력 보존에 대한 이번 MVP만의 예외이며, 인물·설정·원고의 기존 버전 기능과 기존 SQL·데이터를 폐기하는 결정은 아니다. 아래 V1 설계는 역사적 기록이며, 관계 저장·HTTP 연결·실행 소유권은 이 절과 Content 실행 계약을 우선한다. 소스 구현은 병합·hosted CI·실제 이관·배포 완료와 다르다.

### 저장과 인가

- Content의 `WorldStudioController → WorldStudioService → JPA / Neo4jRelationshipRepository`가 처리한다. Core의 기존 인증 확인으로 검증된 UUID Principal만 사용하며 body owner ID·체험 actor를 신뢰하지 않는다. 모든 개별 조회/변경은 소유 world를 먼저 검사한다. 변경 요청의 Bearer·쿠키·CSRF 경계를 유지한다.
- PostgreSQL은 world/card UUID·소유권·카드 원문·기존 카드 버전/manifest와 요청 상태만 소유한다. 추가 V2의 `relationship_state`는 graph token·생성 hash·최근 key/hash·예상 draft revision·완료 여부만 저장한다. 관계 내용·관계 snapshot·outbox를 이중 저장하지 않는다.
- 기존 V1의 12개 테이블과 SQL 바이트는 보존하고 V2로 상태 테이블 하나만 추가한다. 새 경로는 기존 PG `relationship*`/`world_revision_relationship`에 쓰지 않는다. 과거 데이터의 실제 Neo4j 이관은 승인·실행하지 않았고 자동 backfill/import도 없다. 전환 marker가 없는 기존 world는 빈 관계 성공이 아니라 `migration_required`다.
- Neo4j는 안정적인 world/card/relation UUID, 한 쌍의 다중 관계, 방향/대칭·극성·구조/감정·자유 본문·label·semantic metadata를 현재 값으로 보존한다. 삭제는 현재 edge/payload를 제거하며 교차 world 재사용 방지용 ID 예약만 남을 수 있다. `relationshipVersion`/`graphVersion`은 CAS·정합성 token이지 과거 관계를 조회할 수 있는 버전이 아니다.
- 관계 endpoint는 같은 world의 활성 카드만 참조한다. API는 미완성 nullable endpoint도 허용하지만 기존 UI의 명시 저장 검증은 양 endpoint를 요구한다. 요청당 카드·관계 최대 1,000개, 편집 요청 직렬화 크기 2 MB, key 1~200 UTF-8 바이트를 검사한다.

### 두 저장소의 부분 실패

1. 짧은 PG transaction에서 소유권·draft revision·key/hash를 검사하고 새 카드 **논리 ID만** 예약한다. pending receipt를 커밋하며 아직 카드 원문·세계관 이름은 바꾸지 않는다.
2. PG transaction 밖에서 Neo4j의 현재 상태를 CAS 교체한다. 같은 expected token + key/hash의 정확한 재시도는 이미 반영된 현재 결과를 반환한다. 다른 내용·낡은 token은 충돌이다. 다른 world의 관계/endpoint UUID를 callback 안에서 거절하여 graph transaction 비적용이 확정된 경우에만, 소유권·key/hash·예상 draft revision·graph token이 그대로인 pending receipt를 별도 PG transaction으로 해제한다. 카드 원문·현재 graph token은 바꾸지 않고 예약한 카드 UUID는 보존한다. 이 해제의 커밋까지 확인한 뒤 `409 WORLD_WRITE_REJECTED`를 반환하며 해제 실패·다른 receipt·통신/CAS 실패는 미확인 상태로 남긴다.
3. 짧은 PG transaction에서 acknowledgement와 receipt를 확인하고 카드 원문·기본 정보·현재 token을 반영하며 draft revision을 한 번 증가시킨다. 이후 두 저장소의 token·카드 membership·PG 재확인을 통과한 현재 조회만 성공한다.
4. Neo4j 성공 뒤 PG 실패나 응답 유실은 분산 rollback으로 숨기지 않는다. pending 조회는 실패하고, **원래 expected revision·key·입력 그대로** 재시도하면 PG finalization을 재개한다. 마지막 완료 receipt만 보관하므로 후속 저장 이후 낡은 요청을 영구 replay하는 계약은 아니다.

Frontend HTTP adapter는 원래 요청 body/key를 탭 메모리에만 보존하고 모호한 실패 뒤 바뀐 입력의 재전송을 차단한다. 확실한 `422 WORLD_INPUT_INVALID`와 `409 WORLD_WRITE_REJECTED`만 pending을 해제하여 재조회·수정·새 key를 허용한다. `WORLD_WRITE_REJECTED`는 기존 pending/같은 완료 요청이 아닌 prepare 전 stale draft 거절 또는 위 graph 확정 비적용 후 PG 해제 완료에만 사용한다. 일반 `WORLD_CONFLICT`·관계 token 불일치·503은 같은 body/key를 유지한다. 새로고침·프로세스 종료로 원래 body를 잃으면 자동 복구할 수 없다. 대기 요청을 버리거나 다른 내용으로 강제 완료하는 관리 기능·worker는 이번에 만들지 않았다. 원래 입력을 보존해야 하며 승인 없는 실제 DB 복구/수동 변환은 하지 않는다.

### 공개 API와 화면

nginx/Vite의 `/api/v1/world-studios` exact 및 하위 경로는 Content:8081로 간다. 그 밖의 기존 인증 URL은 Core를 유지한다. Frontend는 `View → ViewModel → UseCase → HttpWorldStudioRepository`에서 상대 URL만 호출하며 Neo4j·AI에 직접 접근하지 않는다.

| 메서드·경로 (`/api/v1/world-studios` 기준) | 동작 |
|---|---|
| `GET /` | 소유 world 요약과 `current` / `incomplete` / `migration_required` 상태 |
| `POST /` | caller UUID를 사용한 생성·같은 입력 재시도 |
| `GET /{id}` | token이 일치하는 현재 카드·관계 전체 |
| `PUT /{id}/draft` | 기본 upsert, `replace=true`면 현재 전체 교체. 관계 삭제도 이 요청으로 반영 |
| `POST /{id}/revisions` | 기존 카드·설정의 불변 revision 저장. 관계 snapshot 없음 |
| `GET /{id}/revisions/{revisionId}` | 기존 카드 revision 조회. `relationships=null`, `relationshipStatus=not_recorded` |

기존 관계 편집·관계도는 서버가 확인한 현재 draft를 사용한다. UI의 저장 버튼은 현재 draft PUT이며 카드 revision POST·공개·발행을 자동 실행하지 않는다. AI 후보는 연결하지 않았다. 이탈 시 요청을 취소하고 늦은 응답 설치를 막는다. 지원하는 `semanticMetadata.studio`가 없거나 현재 UI 모델과 불일치하는 서버 응답은 임의 변환/빈 데이터로 대체하지 않고 실패한다. 기존 데이터 호환 import는 별도 승인 대상이다.

| 오류 code | HTTP | 의미 |
|---|---|---|
| `RELATIONSHIP_MIGRATION_REQUIRED` | 409 | 기존 world 전환 필요 |
| `RELATIONSHIP_WRITE_INCOMPLETE` | 503 | 원래 요청 재시도가 필요한 pending |
| `RELATIONSHIP_VERSION_MISMATCH` | 409 | PG/Neo4j token·참조 불일치 |
| `RELATIONSHIP_STORE_UNAVAILABLE` | 503 | Neo4j 연결·저장 실패 |
| `WORLD_WRITE_UNCONFIRMED` | 503 | PG 쓰기/커밋 결과 미확인 |
| `WORLD_WRITE_REJECTED` | 409 | 확정 비적용이며 pending이 없으므로 최신 조회 후 수정 가능 |
| `WORLD_CONFLICT` | 409 | 요청 충돌, 비적용을 보장하지 않으므로 같은 body/key 보존 |
| `RELATIONSHIP_HISTORY_UNSUPPORTED` | 409 | 관계를 포함한 과거 세계관 전체 복원 미지원 |

현재 관계를 과거 revision에 끼워 넣지 않는다. 기존 전체 restore Service는 소유권 검사 뒤 명시적으로 차단하며 restore/history HTTP API를 새로 추가하지 않는다. 관계 시점 조회·복원과 관계까지 포함한 체크포인트/Fork는 미지원이다. 원고·인물·설정의 기존 버전 데이터와 관계 없는 버전 기능은 유지한다.

### 설정과 검증 경계

WorldStudio는 기능 플래그 없이 항상 켜져 있다. Content 서버 시작 시 `world_studio_schema_history`로 전용 schema를 migrate한 뒤 validate하며(repair·baseline 없음), Core 인증 자격과 Neo4j 연결(local·dev compose의 `neo4j` 컨테이너)이 필요하다. `NEO4J_URI/USERNAME/PASSWORD/DATABASE`는 Content 런타임만 받으며 Frontend·Core·AI·build ARG로 전달하지 않는다. 네이티브 기본 URI는 `bolt://127.0.0.1:7687`다.

소스 검증용 `base + docker-compose.prod.yaml`에는 opt-in `worldstudio` profile의 `neo4j:5.26.0-community`, 별도 `worldstudio-neo4j` volume, loopback Bolt 포트만 둔다. 이 조합의 username은 `neo4j`, password는 별도 비밀값(8자 이상), URI는 내부 `bolt://neo4j:7687`을 사용한다. 이미지 전용 `docker-compose.dev.yaml`은 그래프를 자동 배포하지 않으며 승인된 외부 Neo4j가 필요하다. profile·flag가 실제 migration/데이터 이관/기동을 승인하지 않는다.

로컬은 선택 순수 단위·설정 계약·Compose `config --quiet`만 확인한다. Content HTTP/PG/Neo4j 및 React/Hook 통합 회귀는 CI 소스에 두고 격리 자원으로 실행한다. 실제 Core 로그인·nginx를 통과한 Studio HTTP 시스템 시나리오는 추가하지 않았다. hosted `Required CI`·브라우저·실제 이관·배포는 별도 대기이며 관계 이력·시점 복원 기능표는 ❌로 유지한다.

## 플랫폼 장르 템플릿 세계관

장르별 예시 템플릿 11개(카드 248장, [안내](../../infrastructure/sample-data/genre-templates/README.md))는 플랫폼 제공 콘텐츠로, 기존 운영 관리자 계정(Core `auth/V8__member_admin_operations.sql`의 `admin@example.test`, 회원 UUID `5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01`, `operator=true`)에 **임시 할당**해 그 계정이 소유하는 **WorldStudio 독립 세계관으로만** 둔다. 운영자로 로그인하면 세계관 목록에서 보인다. 작품·회차·체크포인트로는 넣지 않으며 사용자 샘플 CSV와 섞지 않는다.

- **적재 경로:** WorldStudio 읽기는 Neo4j 현재 상태 노드가 필요해 SQL로 넣을 수 없다. Content 서버 시작(`ApplicationReadyEvent`) 때 `GenreTemplateSeeder`가 classpath `genre-templates.json`을 읽어 기존 `WorldStudioService`의 create → edit(`expectedDraftRevision=0`) → save를 운영 관리자 subject(`GenreTemplateSeeder.TEMPLATE_OWNER`)로 호출한다. 별도 쓰기 경로나 Neo4j 직접 쓰기는 없다.
- **멱등:** 세계관 ID는 장르별 고정, edit·save key는 `genre-template-<장르>`다. 저장까지 끝난 세계관(`currentRevisionId`가 있음)은 건너뛴다. save가 draft revision을 올려 같은 edit의 중복 판정이 `WORLD_CONFLICT`로 바뀌기 때문이다. 앞선 edit가 미완료(`RELATIONSHIP_WRITE_INCOMPLETE`)로 남은 세계관은 create가 같은 코드로 거절하므로 이를 무시하고 같은 요청으로 edit를 재시도한다.
- **실패:** Neo4j·PG 장애 등 장르별 실패는 장르·예외 클래스·메시지만 `error`로 남기고 다음 장르와 서버 기동을 계속한다. 다음 시작 때 같은 방식으로 다시 시도한다. `genre-templates.json`을 읽지 못해도 `error`만 남기고 기동하며 그 시작에서는 적재하지 않는다.
- **한계(PG만 초기화):** PostgreSQL만 초기화하고 Neo4j 데이터가 남으면 고정 worldId의 create가 graph mismatch(`RELATIONSHIP_VERSION_MISMATCH`)로 실패해 해당 장르가 재시작마다 오류 로그만 남기고 적재되지 않는다. 둘을 함께 초기화해야 한다. CI처럼 여러 PG가 Neo4j 하나를 공유하면 컨텍스트마다 오류 로그가 나오지만 테스트는 깨지지 않는다.
- **한계(임시 소유자):** 템플릿을 기존 운영 관리자 계정에 임시로 할당했다. ① V8 샘플 관리자 비밀번호가 마이그레이션 주석에 공개되어 있어 그 계정으로 로그인하면 누구나 템플릿을 수정·삭제할 수 있다. 실제 운영 계정·공개 템플릿 조회가 생기면 소유자를 바꾼다. ② V8은 `ON CONFLICT (email) DO NOTHING`이라 기존 DB에 `admin@example.test`가 다른 id로 있으면 템플릿 소유자가 실제 로그인 계정과 다를 수 있다. ③ 다른 사용자에게는 여전히 보이지 않는다(가져오기·공개는 후속). 소유자를 바꿔도 이미 적재된 세계관은 옮겨지지 않는다. 고정 worldId의 create가 소유자 불일치로 거절(`WorldNotFound`)되어 장르별 오류 로그만 남으므로, 소유자 변경 때는 기존 세계관(PG·Neo4j)을 승인 하에 정리해야 한다.
- **내용 변경:** 저장된 세계관은 내용 비교 없이 건너뛴다. 같은 key로 입력이 바뀌면 hash 충돌이고 새 key만으로는 낡은 expected revision으로 거절된다. 내용을 바꾸려면 새 세계관 ID와 새 카드 ID(카드 ID는 세계관 사이에서도 유일)의 새 항목을 추가한다.
- **기존 정책과의 관계:** 카드는 DEC-36의 기본값인 비공개로 둔다. 후속 "가져오기"는 [요구사항 F-WLD-01](../requirements.md#f-wld-01)·[유스케이스 6.2](../usecase.md)의 "장르 기본 세계관을 복사해 시작"(원본 관계 없는 새 세계관)이며, 작품 Fork와 무관한 타인 세계관의 직접 이용(DEC-35)은 MVP 제외다.
- **후속(미구현):** 목록은 소유자 전용이라 운영 관리자 계정만 볼 수 있다. 공개/비공개 설정, 다른 사용자의 템플릿 가져오기, Fork 연계는 이번 범위 밖이다. 서버 시작 적재는 로컬 단위(서비스 대역)로만 확인했고 실제 PG·Neo4j 실행은 CI·개발 환경 확인 대기다.

## 기준

초기 세계관은 작품과 회차가 없어도 생성·편집·확정 저장할 수 있다. WorldStudio가 자신의 논리 식별자·초안·불변 버전·확정 묶음을 소유한다. 기존 Content 테이블과 migration 순서에 의존하지 않는다.

이전 안의 `setting_document/setting_draft/setting_version` ALTER, Content V1~V7 선행 조건과 `contentRepository` 시작 의존은 채택하지 않는다. 기존 공유 Content/Auth 테이블과 Flyway 이력은 그대로 둔다. 이전 V1/V2 SQL은 검토 기록으로 보존하며 새 독립 초기 SQL로 오인해 배포하지 않는다.

## 저장 경계

같은 PostgreSQL 서버/DB를 쓰더라도 전용 `worldstudio` schema에 테이블을 둔다. 기존 `public.world` 등과 이름이 겹치지 않고 공유 데이터에 ALTER를 수행하지 않는다. 실제 서버·DB·계정은 적용 전 확인해야 하며 CORE/CONTENT 주소가 같다고 가정하지 않는다.

Flyway location은 `classpath:db/migration/worldstudio`로 유지하되 독립 V1 내용을 새로 작성한다. history는 `worldstudio.world_studio_schema_history`에 둔다. 이전 SQL이 적용된 DB에서는 체크섬 변경·repair로 바꾸지 않는다. 기존 적용 여부를 먼저 확인하고, 적용돼 있다면 별도 전환 migration을 설계한다. 빈 schema의 V1에는 다른 서비스 이력을 baseline으로 재사용하지 않는다.

평소 서버 시작으로 DDL을 실행하지 않는다. 명시적인 migration 실행에서만 대상 DB/schema와 기존 이력을 검사하고 migrate/validate를 수행한다. WorldStudio API를 활성화하는 것과 migration 실행은 별도 설정이다.

> 현재: `WorldStudioConfig`는 조건 없이 Content DataSource로 전용 persistence unit을 만든다. 아래는 과거 기록이다.

`WorldStudioConfig`는 명시적으로 `app.worldstudio.enabled=true`인 경우에만 전용 WORLDSTUDIO_DATABASE_*와 JPA persistence unit을 만든다. Core/Content DB URL로 fallback하지 않으며 Auth/Content 초기화 의존도 없다. 기존 Auth는 자기 Entity 패키지만 스캔하므로 수정하지 않는다. 기존 Content 공존 검증은 데이터 보호를 위한 일회성 opt-in 테스트이며 이후 독립 저장 검증의 선행 조건이 아니다.

과거 확장 이력은 이름/버전 번호만으로 차단하지 않는다. 보관 SQL의 정확한 version·script·Flyway checksum·SQL type·성공 여부를 함께 확인한다. 타 도메인의 정상 동명 V1/V2와 다른 체크섬은 허용한다.

## 테이블과 책임

| 테이블 | 핵심 정보와 책임 |
|---|---|
| world | 안정적인 world ID, 소유자 식별자, 생성 시각, 현재 확정 revision 참조. 작품/회차 FK 없음 |
| world_draft | world당 이름·설명, draft_revision, base_world_revision_id, 수정 시각. 자동저장 대상 |
| setting_card | card ID, world ID, 생성 시각. 제목이나 유형 변경에도 ID 유지 |
| setting_card_draft | card별 제목·원문·card_type·area_code·별칭·태그·자유 분류·semantic metadata·lifecycle·visibility. 초안 |
| setting_card_version | 안정적인 version ID와 card ID, 버전 순번, 동일한 카드 필드 및 visibility snapshot, 생성 시각·복원 기준. 불변 |
| relationship | relation ID, world ID. 실제 관계·감정의 안정적인 논리 식별자 |
| relationship_draft | source/target card, structural/emotional, 자유 본문·선택 label, direction/polarity/lifecycle. 미완성 입력은 nullable 허용 |
| relationship_version | 완성 검증한 방향별 관계 snapshot. 한 쌍 사이 여러 관계·감정 보존. 불변 |
| world_revision | revision ID·world별 순번·이름/설명 snapshot·부모/복원 revision, 생성 시각. 확정 저장 단위 |
| world_revision_card | revision에 포함된 card/version의 정확한 manifest |
| world_revision_relationship | revision에 포함된 relation/version의 정확한 manifest |
| world_save_request | world별 멱등 키·요청 hash·성공 revision. 재시도 중복 저장 방지 |

태그와 별칭은 처음에는 초안/버전의 문자열 배열로 snapshot한다. 사용자 자유 텍스트를 같은 의미라고 추론해 합치지 않는다. 공유 Content tag master를 참조하지 않는다. 교차 세계관 태그 검색 사전은 필요가 확정될 때 별도로 설계한다.

Graph DB·outbox·projection worker·AI job·이미지 저장소는 이 초기 정본 migration에 넣지 않는다. 다른 담당 기능과의 확정 계약이 생기면 후속 migration으로 연결한다.

## 유형·영역·기존 의미

card_type은 character/location/organization/ability/object/rule/event/other 8종이다. area_code는 basic/space/history/society/culture/special/conflict 7종이다. 자유 분류·태그와 별도이며 같은 축으로 합치지 않는다.

기존 JSON의 kind/predicate/polarity/대상 ID/조건/topics/원문 근거는 명시적 import 계약이 생기면 semantic metadata와 적절한 관계 구조에 보존한다. claim/undetermined/note를 other로 일괄 변환하지 않는다. 이번 독립 초기 설계는 기존 H2/Content 데이터를 자동 이관하거나 새 ID로 교체하지 않는다.

## 무결성과 저장

- 같은 world의 카드만 관계 endpoint와 manifest에 연결한다. world/card/version 식별자 관계를 복합 FK로 보장한다.
- 초안 자동저장과 명시 저장을 분리한다. world_draft.draft_revision을 비교해 충돌을 감지하고 실패하면 기존 초안·확정본을 유지한다.
- 명시 저장은 소유권·초안 revision·멱등 hash 검증, 새 카드/관계 버전 생성, manifest 조립, revision 확정과 현재 포인터 갱신을 한 트랜잭션으로 실행한다.
- 조립 중 revision은 커밋할 수 없게 하고 확정 뒤 manifest와 버전은 수정·삭제할 수 없게 한다. 복원은 새 version/revision이다. 구체 봉인 trigger는 새 V1 SQL에서 테스트한다.
- 활성 관계의 양 endpoint는 같은 revision의 활성 카드여야 한다. 관계 입력은 선택적이며 미등록을 관계 없음의 확정 사실로 해석하지 않는다.
- 카드·관계 삭제는 lifecycle tombstone을 새 버전에 기록한다. 과거 version/manifest를 삭제하지 않는다.
- 카드 초안과 불변 버전 모두 `visibility`를 가지며 기본값은 `private`다. `public` V2에서 `private` V1을 복원하면 V3에 V1의 비공개 정책도 복사한다. 명시 저장은 발행이 아니며 카드의 public만으로 독자 접근을 허용하지 않는다. 회차별 공개·지식·상태는 이후 계약으로 연결한다.

## 인증과 회차 연결

인증은 Core의 검증된 Principal을 사용한다. world 소유자는 요청 body의 ownerId나 체험 actor로 결정하지 않는다. `owner_subject`는 PostgreSQL `uuid`이며 Auth/Content FK는 없다. 현재 `auth/entity/AuthMember.kt`는 UUID ID를 사용하고 `SessionService.user/access`는 이를 `UUID.toString()`으로 JWT subject에 발급한다. `SessionController`와 `ProfileController`는 검증된 Jwt.subject를 `UUID.fromString`으로 읽는다. UUID 값으로 저장하므로 대소문자 문자열 비교나 임의 trim/lowercase 정규화는 하지 않는다. 이메일·닉네임·Content member ID로 변환하지 않는다.

JWT 서명·만료 검증과 Principal→UUID 변환은 호출 계층의 책임이다. 독립 Service는 UUID subject를 인자로 받아 모든 읽기/쓰기에서 소유 world를 먼저 잠그고 대조한다. DB 소유자 컬럼이나 FK 부재가 HTTP 인증 완료를 뜻하지 않는다. SQL 관리자 권한으로는 소유권 검사를 우회할 수 있다. 이번에는 독립 Entity·JpaRepository·Service까지만 연결하며 HTTP Controller·기존 작업실 UI는 연결하지 않는다.

### 집필 회차의 기준 세계관 (기능 87)

2026-11-10 사용자 결정에 따라 작가는 소유한 WorldStudio의 봉인된 버전을 집필 회차의 기준으로 선택·조회·변경한다. Content는 회차에 세계관 UUID와 버전 UUID를 함께 기록한다. WorldStudio는 소유권과 해당 세계관의 봉인된 버전을 확인하며 작품·회차를 참조하지 않는다. 두 스키마의 검증과 기록은 각각의 트랜잭션에서 수행하고 회차 선택을 저장할 때 작품 소유권과 회차 수정 가능 여부를 다시 확인한다.

- `GET/PUT /api/v1/works/{id}/episodes/{number}/world-basis`는 소유자의 선택과 변경을 처리한다. 선택 전 응답에는 `basis: null`과 수정 번호가 들어 있다. 수정 번호가 바뀐 상태에서 다른 버전을 선택하면 409로 응답한다. 같은 버전의 재시도는 현재 선택을 돌려준다. 원작에서 상속한 회차는 읽기 전용이다.
- `GET /api/v1/world-studios/{id}/revisions`는 소유한 세계관의 봉인된 버전 목록을 반환한다. 집필실에서 기존 확정 저장 API로 현재 저장된 인물·설정을 새 버전으로 만들 수 있고, 기준으로 선택한 버전의 설정은 기존 버전 상세 API로 읽는다.
- 적용 범위는 집필실의 회차 참조다. 발행본·Fork 기준·집필 AI 문맥과 Neo4j 관계의 과거 상태는 이 참조에 포함하지 않는다. 기존 회차는 기준 선택 없이 열 수 있다.

## 새 SQL 작성 전 확정할 항목

1. 전용 schema `worldstudio` 및 독립 Flyway 이력 사용.
2. Auth UUID subject를 보존하되 외부 테이블 FK 없이 저장. API의 소유권 검사 구현은 별도 작업.
3. 초기 비공개 버전과 향후 회차 공개 정책의 연결 경계. 이번에는 회차 공개 정책을 구현하지 않는다.

위 설계 기준으로 새 독립 V1을 작성하고, 빈 PostgreSQL에서 Content 없이 생성/저장/revision/rollback을 먼저 검증한다. 다음으로 기존 Auth/Content가 있는 별도 일회용 DB에서 기존 이력·건수·ID·원문·버전이 변하지 않는지 확인한다. 두 경우 모두 migrate/validate/재실행 0건과 새 연결 재조회를 검증한다.

공용 개발 DB 적용은 이 PR 범위에서 제외한다. 이전 배포 시도는 인증·접속 확인 실패로 중단했고 백업/migration을 수행하지 않았다. 실제 적용 상태는 미확인이며 [배포 사전 확인](../deployment/worldstudio-v1-rollout.md)에 기록했다. SQL과 독립 JPA 구현은 작업 브랜치에 커밋·일반 push하여 팀 리뷰용 일반 PR로 제출한다. #86·#76과 원본 UX worktree는 변경하지 않는다.

**PR 병합만으로 자동 마이그레이션이 실행되는지는 미확정이다.** 현재 WorldStudioConfig는 validate만 수행하고 migrate를 자동 호출하지 않는다. 실제 개발 DB 적용 여부, 배포 시 Flyway의 명시 실행 주체/시점/권한과 기능 활성화 순서는 팀원 검토가 필요하다.
