# STORYFORK 아키텍처

[메인 README](../README.md) · [문서 목록](README.md)

> **현재 소스 상태:** Core는 Auth·세션·Health, Content는 기존 콘텐츠·첨부·WorldStudio 코드/테스트를 소유한다. nginx/Vite의 works와 world-studios exact·하위 경로는 Content:8081, 나머지 `/api`는 Core:8080으로 간다. #132의 관계 정본은 Neo4j 현재 상태 하나이며 관계 이력·과거 snapshot·전체 세계관 복원은 지원하지 않는다. 아래 WorldStudio 절은 현재 계약으로 갱신했다. 같은 기존 DB에서 writer/migration만 분리했고 Content 초기 SQL은 승인된 fresh 7개 업무 leaf/전역 V1~V9로 재작성했다. Auth·첨부·독립 Studio SQL은 보존한다. Operations는 loopback 8082의 독립 공지·이벤트·문의/답변 CRUD와 전용 서비스 토큰 인증, operations schema/Flyway/JPA 설정을 소스 구현했다(Core/Content/프런트 호출 없음). hosted CI·실제 DB 전환·게시/배포는 대기다. 현재 정본은 [서비스 경계](design/service-boundaries.md)와 [이관 계약](design/content-service-migration-contract.md)이다. **아래 본문은 분리 전 구현의 역사적 설명으로, Core 소유·JSONB importer·통합 migration 경로·세 이미지 안내를 현재 실행 지침으로 사용하지 않는다.**

## 운영 서비스의 현재 범위

[Operations API 인계](../backend/operations-service/README.md)는 `/api/v1/operations/{notices,events,inquiries}` 및 문의 하위 답변의 UUID CRUD를 정의한다. 각 리소스의 `Controller → Service → JpaRepository`와 명시적 DTO를 사용하고 `X-Operations-Service-Token`으로 모든 운영 접근을 보호한다. 설정이 없거나 공백뿐이면 거절하며 서비스 자격을 사람의 관리자·회원 신원/소유권으로 해석하지 않는다. 이 서비스 토큰 CRUD는 브라우저에 노출하지 않는다. 브라우저용 `/api/v1/operations/{reports,members,admins,admin/notices}`는 회원 Bearer를 Core로 확인하고 운영자 권한으로 인가하며, `/api/v1/operations/public/notices`는 인증 없는 공지 조회(GET)다([운영 공지 계약](design/operations-notice-contract.md)). nginx/Vite는 이 경로만 운영 서비스로 보낸다.

기존 PostgreSQL에서 `operations` schema와 `operations.operations_flyway_schema_history`를 독립 소유한다. V1 공지·V2 이벤트·V3 문의/답변만 운영 location에서 적용하고 다른 서비스 이력을 재실행하지 않는다. JPA `validate`/UTC/`@Version`, 기본 20·최대 100개 고정 정렬 목록과 안전한 400/404/409를 사용한다. 공개 게시·이벤트 진행 상태·내 문의·처리 상태·알림·사람별 관리자 권한·배포는 제외한다.

선택 순수 단위만 로컬 실행하며 Spring/HTTP/PostgreSQL/Flyway 통합은 CI의 Operations job에서 격리 DB로 실행하도록 구성한다. 실제 hosted `Required CI` 결과와 DB 적용·배포는 아직 확인하지 않았고 기능표는 ❌를 유지한다. 아래 기존 Core/Content 본문은 상단 고지대로 분리 전 역사 설명이다.

## 현재 구현

11번 플롯·장면 계획은 Content의 `plan` 기능과 추가 `db/migration/plan/V10__story_plan.sql`에 분리했습니다. V11은 작품의 실제 삭제 시 해당 계획과 계획 참조만 종속 정리합니다. V12는 인물·장소 순서 목록 갱신의 일시 중복을 허용하고 커밋 시 최종 중복을 거부하며 기존 V1~V11 SQL·체크섬을 보존합니다. 기존 7개 leaf에 plan을 더한 8개 leaf를 사용합니다. `/studio/{id}?view=narrative`에서 실제 작품은 계획 API를, 메모리 데모는 독립 계획 저장소를 사용하고 기존 설정집·회차 조회를 참조합니다. 계획 저장은 원고·사전·인물 상태·Fork 독립을 변경하지 않습니다. 사용자 승인으로 5433의 별도 검증 DB에서 신규 생성·V10/V11 업그레이드·작품 삭제·인물/장소 선택 해제와 순서 교체 회귀를 확인했으며 공유 DB 적용은 별도 절차이며 후속 변경의 hosted 검증은 해당 head의 Required CI 결과로 판정합니다.

콘텐츠 저장은 작품·세계관 연결 이력·회차 버전·발행 사건·Fork 기준점·AI 선택/적용 관계로 정규화했습니다. 조회 VIEW가 현재 상태를 계산하며 이전 `content_work` JSONB는 이관 백업입니다. [물리 대응과 보존 경계](content-erd-migration.md)를 참고하세요.

> 현재 Content의 실제 코드 추출·8081 라우팅과 Operations의 독립 CRUD·8082 서비스 자격/저장은 위 현재 소스 상태 및 각 서비스 README를 따릅니다. Operations는 Compose·공개 proxy·배포에 연결하지 않습니다. 목표는 [DEC-41의 Core·콘텐츠·운영·AI 4개 서비스](design/service-boundaries.md)이며 아래 연결 구조는 분리 전 상태를 유지합니다.

STORYFORK 화면 데모와 Core·AI 연결 확인, Core의 이메일 가입·인증, 로그인·세션, 비밀번호 복구·프로필 API를 제공하는 개발 기반입니다. 선택적 `/content` React 작업실과 `/studio/{UUID}`는 Core 콘텐츠 API를 사용하며 Core가 PostgreSQL 정본 및 AI Service `/internal/v1/proposals` 요청을 소유합니다. 나머지 목업 화면과 구분하며 상세 범위·검증 한계는 [콘텐츠 통합 안내](content-integration.md)를 참고하세요. 실제 약관·동의와 회원 탈퇴의 최종 처리(콘텐츠 삭제·익명화)는 미구현이므로 운영 가입용이 아닙니다.
서비스 책임을 분리한 MSA 구조입니다. Frontend는 TypeScript로 Clean Architecture·MVVM을 따르고,
백엔드는 기능 중심 레이어드 구조를 유지합니다.

```text
Browser → React Web → 공개 Core API → 내부 FastAPI AI Service
             /api       /api/v1/health       /internal/v1/health
                        /api/v1/health/ai-service
```

사용자가 명시적으로 생성할 때 AI Service에서 OpenAI Responses API를 호출합니다. 개인 브랜치의 모델 설정은 팀 전체 모델 선정 결정과 구분합니다. 새 Agent 프레임워크·그래프 DB는 도입하지 않았습니다.
키 없이 시작하며 Health는 OpenAI 인증·모델 접근·생성 검증이 아닙니다.
가입 후보·회원·refresh 세션·복구/이메일 변경 challenge 저장에 PostgreSQL·Flyway, 로컬 메일 확인에 Mailpit을 사용합니다. SMTP는 가입 인증·비밀번호 복구·이메일 변경에 사용하며, 가입 인증은 24시간, 복구·이메일 변경 challenge는 1시간 유효합니다. Content는 같은 PostgreSQL에서 별도 `content_schema_history`로 콘텐츠를 저장합니다. 비공개 콘텐츠 API는 JWT Bearer 인증을 요구하고 공개 작품은 GET만 익명으로 조회합니다. Redis·큐·worker·운영 seed는 없습니다.

## 합의된 향후 구성요소 (미구현)

아래 미구현 구성은 **계획**이며 현재 적용된 부분과 구분합니다. DB에는 인증·프로필과 선택적으로 활성화한 콘텐츠 데이터가 저장됩니다. 기존 유스케이스의 세부 정책과 충돌할 때는 [DEC-26~28](design/decisions.md#결정-목록)을 우선합니다.

| 구성요소 | 용도 | 상태 |
|---|---|---|
| PostgreSQL·Flyway | 회원·가입 후보·refresh 세션·복구/이메일 변경 challenge 및 콘텐츠 저장 | 인증·프로필 적용. 콘텐츠는 선택적 활성화하며 원문·버전·부분 체크포인트·Fork·AI 이력을 저장. 전체 도메인·운영 검증은 별도 |
| 관계 그래프 DB | 인물·엔티티 관계 저장·조회; 문서·원고 전문은 제외 | MVP 방향(DEC-26), 제품·연동 미정 |
| `pg_git` (`seanwevans/pg_git`) | MVP 이후 PostgreSQL 확장 도입을 신중히 추진 | MVP 미적용. 포크·설치·개발은 아직 안 함(DEC-27·30) |
| S3 호환 object storage | 설정 이미지·TXT/MD/CSV/PDF 첨부, RDB에는 비공개 object key와 인증 API 참조 | #87 선택적 Core API 구현; 로컬 MinIO 소스 빌드, 배포 대상 AWS S3(실제 AWS 미검증) |
| Elasticsearch·Langfuse·SMTP | 검색 확장·AI 관측·이메일 | 로컬 SMTP를 가입 인증·비밀번호 복구·이메일 변경에 사용, 운영 제공사는 미정 |
| 모델 API·프레임워크 | 선택적 AI 집필·시뮬레이션 | 팀 선정 미정. 콘텐츠의 명시적 생성은 설정한 OpenAI 모델 호출 |

저장 경계: 설정·원고 전문 및 콘텐츠의 확정 버전·되돌리기·체크포인트·Fork는 PostgreSQL, 관계 정보는 그래프 DB에서 다룹니다. 콘텐츠 변경을 기존 버전 덮어쓰기로 처리하지 않습니다. 두 DB의 연결 키·정본 여부·동기화·복구, Fork의 기준 관계 고정과 AI 조회 경로는 아직 설계하지 않았습니다. Gitea는 사용하지 않습니다. 세계관 설정은 항목별 공개·비공개와 회차별 공개 범위를 두고 사용자 권한·미발행 원고·인물별 인지 범위를 구분합니다(DEC-36).

## Frontend

업무 기능은 TypeScript로 Clean Architecture·MVVM을 따릅니다([Frontend 지침](../frontend/AGENTS.md#구조와-의존성)).
실행 흐름은 `View → ViewModel → UseCase → Repository 구현 → HTTP API`, 의존 방향은 `Presentation → Domain ← Data`이며
`app/di`(Awilix)가 인증·프로필 및 데모 기능의 UseCase와 Repository 구현체를 연결합니다.

`App`은 라우팅과 세션 복원 상태 연결을 담당하고, 실제 복원·DI 호출은 Presentation의 `useSessionRestore` Hook에 둡니다.
인증·프로필 ViewModel은 Domain UseCase를 통해 공개 Core API를 호출하며 Redux Store가 로그인 사용자와 화면 상태를 관리합니다. 콘텐츠의 EpisodeUseCase는 HttpEpisodeRepository를 통해 Core를 호출하고 기존 메모리 Bearer·CSRF 경계를 재사용합니다. 나머지 목업 Repository 화면은 서버 저장·권한 구현과 구분합니다.

연결 상태 UI는 `CoreApiConnectionStatus → useCoreApiHealth → appContainer 외부 함수 → Fetch·Zod`입니다.
두 공개 API의 상태·서비스명을 검증하며 AI는 항상 Core를 경유합니다.
Hook이 로딩·성공·실패·재시도, 요청 취소와 늦은 응답 무시를 담당하고, Health Fetch는 Data Layer에서 20초 제한과 안전한 화면 오류를 사용합니다.

## Core Service (현재 모듈: `core-api`)

Gradle group은 `ai.storyfork`, 애플리케이션은 `storyfork-core-api`, namespace는 `ai.storyfork.core`입니다.
물리 main/test 소스 루트는 `backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`입니다.

`_health/controller`는 자체 상태를 반환합니다.
`_health_ai_service/controller → service → client`는 내부 AI Health를 호출합니다.
Client의 nullable payload를 Service에서 `up`·`storyfork-ai-service`로 검증한 뒤 내부 Result와
공개 Response로 변환합니다. 경계별 DTO 소유권을 유지하며 필요 없는 Facade는 없습니다.

Auth는 `auth/controller → SignupService·SessionService·ProfileService → auth/repository` 흐름을 사용합니다. Controller는 DTO·명시적 쿠키/헤더·검증된 JWT를 바인딩하고 Service가 업무·트랜잭션을 담당합니다. 공개 요청·응답은 클래스별 `auth/service/dto` 계약을 공유하며 내부 `LoginResult`의 refresh token은 공개 `LoginResponse`에서 제외하고 HttpOnly 쿠키로만 전달합니다. `X-Auth-User`는 인증 수단이 아니라 계정 혼선을 막는 사전조건입니다. Spring Security OAuth2 Resource Server·CSRF·JWT 검증은 유지하고 BCrypt를 Spring DI로 공유합니다.

Auth 영속성은 5개 JPA Entity와 Spring Data `JpaRepository`의 파생 쿼리·JPQL·Entity 변경으로 처리합니다. 기존 UUID·Flyway SQL 바이트·`flyway_schema_history`는 유지하며 Hibernate는 스키마 검증만 수행합니다(`ddl-auto=validate`, `open-in-view=false`). 기존 Content JDBC 저장과 별도 `content_schema_history`는 이번 전환 범위 밖입니다. 회원별 `PESSIMISTIC_WRITE` 잠금 뒤에 자격 증명·refresh 상태를 읽어 로그인/비밀번호 재설정 및 refresh/로그아웃의 경합을 보호합니다. 재사용 감지 시 세션 폐기는 Service가 커밋한 뒤 HTTP 401로 변환합니다. 가입 후보는 행 잠금을 사용하며 아직 행이 없는 최초 가입의 삽입 충돌만 새 트랜잭션에서 한 번 재시도합니다. 미인증 후보는 재가입 요청으로 교체하고 가입 인증은 최신 토큰과 가입 시 정한 비밀번호를 모두 요구합니다. 이메일 변경 확인은 별도 token-only 계약을 유지합니다. CSRF는 모든 변경 요청에 적용하며 실제 약관 동의와 회원 탈퇴는 후속 범위입니다. 공개 경로와 요청·응답은 [Core API 계약](../backend/core-api/README.md#공개-계약)을 따릅니다.

회원 탈퇴 요청은 `auth/controller → WithdrawalService → JpaRepository`가 `auth_withdrawal`(Flyway V7, `db/migration/auth`)에 요청·30일 유예·복구 상태만 기록하고 refresh 세션을 폐기합니다. 콘텐츠 숨김·삭제·익명화와 유예 만료 후 최종 처리는 콘텐츠 서비스와의 계약이 확정된 뒤 후속으로 연결합니다.

알림함(#89)은 `notification/controller → NoticeService → JpaRepository`로 Auth와 분리된 `notification`·`notification_preference` 테이블에 저장합니다. Flyway는 Auth와 같은 `flyway_schema_history`를 공유하고 `db/migration/notification`(V5~)을 추가로 읽으며, 회원이 삭제되면 알림·설정도 함께 삭제됩니다(`ON DELETE CASCADE`). 조회·읽음·삭제 API와 분류별 수신 설정, 서버 내부 생성(`NoticeService.create`), 웹 알림함·배지·설정 화면의 Core API 연결, 알림 저장 커밋 후 본인에게 보내는 SSE 변경 신호(`GET /api/v1/me/notifications/stream`, 단일 Core 인스턴스 전제, 신호를 받으면 프론트가 DB에서 재조회)까지입니다. RabbitMQ outbox·소비자와 모바일 푸시는 후속 범위입니다.

`_common`에는 HTTP 연결 설정 검증·RestClient·통신 실패 분류·안전한 ProblemDetail·전역 CORS와 여러 콘텐츠 기능에서 공유하는 실패·식별자 계약이 있습니다.
Health 연결 불가는 503, timeout은 504, 잘못된 응답과 예상하지 않은 HTTP 상태는 502입니다.
콘텐츠 생성은 `proposal/config/GenerationClientConfig`의 별도 HTTP 클라이언트를 사용합니다. Health 읽기 기본값은 12초, 생성은 75초이며 생성 실패는 콘텐츠 API의 503으로 반환합니다.
내부 URL·오류 원문은 공개하지 않으며 AI 장애가 Core 자체 Health 성공을 막지 않습니다.

### WorldStudio Content HTTP·Neo4j 현재 상태 (#132)

이 절은 현재 소스 계약이다. `WorldStudioController → WorldStudioService → JPA / Neo4jRelationshipRepository`가 `/api/v1/world-studios`를 제공하고 nginx/Vite는 exact·하위 경로를 Content:8081로 보낸다. 기존 Core 인증 확인의 UUID Principal·CSRF·world 소유권 검사를 유지한다. Frontend는 기존 UseCase/Repository 경계를 통해 현재 draft를 저장하고 기존 관계 편집·관계도에 사용한다. 화면 저장은 draft PUT이며 카드 revision POST·공개·발행이 아니다.

기존 `worldstudio` V1의 12개 테이블·SQL·데이터를 보존하고 V2로 관계 내용 없는 `relationship_state`를 추가한다. PG는 카드 원문/버전·소유권·UUID와 요청 상태만, Neo4j는 현재 관계 내용만 소유한다. 짧은 PG prepare → PG 밖 Neo4j CAS → 짧은 PG finalization 순서이며 분산 원자성을 가정하지 않는다. graph token은 이력 버전이 아니다. pending은 원래 key/입력으로만 재시도하며 탭을 잃은 뒤 자동 복구할 수 없다. 미전환·미완료·불일치는 빈 관계 성공으로 대체하지 않는다.

관계 변경 이력·과거 snapshot·시점 조회·복원은 최신 사용자 결정으로 제외했다(DEC-27·33의 관계만의 MVP 예외). 기존 카드 revision은 `relationships=null` / `not_recorded`이고 전체 세계관 restore는 명시적 미지원이다. 기존 인물·설정·원고 버전과 과거 SQL/데이터는 유지한다.

서버는 Content DataSource와 studio-only EntityManager/TransactionManager로 validate만 한다. 명시 migration main은 Content 이미지에 있으며 실제 DB 적용·기존 관계 변환은 별도 승인 대상이다. opt-in Neo4j profile과 격리 CI 서비스는 소스에 연결했지만 실제 이관·hosted CI·배포·브라우저 검증은 대기다. API·설정·실패/재시도 한계는 [현재 계약](design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132), 기존 배포 승인은 [배포 실행 계약](deployment/worldstudio-v1-rollout.md)을 따른다.

### 설정 첨부 (#87)

`attachment/controller → AttachmentService → JPA repository / S3 client`가 기존 소유 로컬 Setting의 이미지·일반 파일 CRUD와 표지·회차 이미지를 처리합니다. `SettingAttachmentController`·`WorkCoverController`·`EpisodeImageController`와 기존 HTTP 계약은 유지합니다.
요청/응답 DTO는 `attachment/service/dto`, S3 전용 계약은 `attachment/client/dto`에 둡니다. `AttachmentConfig`·`AttachmentProperties`는 기존 `app.setting-attachments` 속성·활성화 조건을 유지하며 기존 Auth JPA·Content JDBC 경계는 바꾸지 않습니다.
`setting_document`·`world`·`work_current`의 기존 소유권을 확인하고 following Fork·익명 공개·URL만 아는 접근은 허용하지 않습니다.
이미지는 설정당 10개를 설정 행 잠금으로 보호하고 일반 파일에는 그 한도를 적용하지 않습니다.
파일은 비공개 버킷에 UUID key로 저장하며 원본 endpoint가 아닌 Core의 인증 download API만 노출합니다.
새 Flyway leaf/history는 `db/migration/settingattachment`/`setting_attachment_schema_history`입니다.
Auth SQL은 내용과 기존 이력을 보존한 채 `db/migration/auth`로 이동하여 독립 V1과 충돌하지 않게 합니다.

공식 AWS SDK는 배포에서 기본 자격증명 체인·S3 region을, 로컬 MinIO에서는 endpoint override·path-style을 사용합니다.
MinIO는 local·개발 배포 compose에 항상 포함된 소스 빌드 runtime이며(고정 버전 `storyfork-minio:RELEASE…` 이미지를 버전당 한 번만 빌드해 재사용), 버킷은 Content 시작 시 만듭니다. AWS 인프라는 자동 생성하지 않습니다.
교체/삭제의 일반적인 DB/저장소 실패는 제한된 메모리 백업으로 복원하지만 분산 원자성·프로세스 종료 복구를 보장하지 않습니다.
복원 실패는 명시적인 503이고 미참조 object는 수동 대조 대상입니다. worker/outbox는 없습니다.
허용 형식·10 MiB 기술 제한·안전한 attachment 응답·API·한계는 [Core 계약](../backend/core-api/README.md#설정-이미지일반-파일-87)에 있습니다.
#92에서 실제 `/content` 설정 첨부 UI와 연결합니다. 이 변경은 브라우저 흐름에 영향을 주므로 실제 MinIO HTTP lifecycle 외에 Aside 정상·실패 E2E가 필요합니다.

### 작품 표지·본문 이미지 (#92)

`attachment/controller → AttachmentService → JPA repository / 기존 S3 client`가 표지·회차 이미지 정본을 관리합니다. 별도 production 의존성·실행 계층을 추가하지 않고 attachment의 bounded Hikari pool·EntityManager를 재사용합니다. `content_image`(회차 0 = 단일 표지, 양수 = 불변 회차 이미지)와 별도 `content_image_schema_history`만 추가하며 기존 Auth·Content·설정 첨부 migration은 보존합니다.

원고의 `[[image:<UUID>]]` 참조가 삽입 위치와 불변 bytes를 연결합니다. Core는 동일 작품·회차의 참조만 저장하고 공개 download는 기존 공개 회차 본문에 실제 포함된 marker로 제한합니다. inherited 원고는 기존 고정 본문의 참조만 허용하며 새로운 Fork 공유 정책은 추가하지 않습니다. 표지 변경/삭제의 미참조 object는 모호한 DB commit 때 기존 bytes 손실을 피하도록 비공개 버킷에 남을 수 있고 자동 정리 worker는 없습니다. 상세 [표지·원고 계약](../backend/core-api/README.md#작품-표지원고-이미지-92)을 따릅니다.

Frontend의 공유 `MediaPanel/useMediaViewModel → MediaUseCase → HttpMediaRepository`가 실제 UUID 대상으로 인증 multipart/bytes를 전송합니다. View에서 Repository를 호출하지 않으며 이미지 Blob URL은 교체·이탈 때 해제합니다. `/content`의 생성 표지·기존 표지·설정 첨부 및 `/studio/{UUID}`의 커서 이미지·저장 버전 미리보기·텍스트 전용 TXT에 연결하고 기존 이름 기반 데모에는 서버 미저장 안내를 둡니다. 실패한 표지/첨부 요청은 기존 데이터와 생성된 작품을 보존하며 성공 fallback을 두지 않습니다.

## AI Service

`app/main.py`가 Health·generation router를 조립합니다. 내부 인증된 생성 요청에서만 OpenAI를 호출하며 정본은 Core에서 반영합니다.
시작 시 모델 클라이언트를 만들지 않습니다. 생성 요청에서만 AI 런타임의 키·모델·내부 토큰 설정을 사용합니다.
향후 합의된 AI 기능은 필요한 `router → service → agent → OpenAI` 흐름으로 추가합니다.
상세는 [Agent 구현 경계](../backend/ai-service/docs/agent-structure.md)를 따릅니다.

## 실행·보안 경계

공통 `infrastructure/docker-compose.yaml`은 web·Core·Content·AI 네 앱의 공통 환경·내부 포트를 정의하며 단독 실행하지 않습니다.
루트 `compose.yaml`은 base + `docker-compose.local.yaml`을 include합니다. 루트 `.env`를 자동으로 읽는 `docker compose up -d --build`는 네 앱을 기존 runtime Dockerfile로 빌드하고 내부 PostgreSQL·Mailpit을 함께 사용합니다.
base + `docker-compose.dev.yaml`은 게시된 `:develop` 앱 이미지와 같은 내부 PostgreSQL·Mailpit 구조를 사용하며 앱 소스 build·mount는 없습니다. local/dev의 프로젝트·DB volume은 서로 격리합니다. 기존 외부·공유 DB의 내부 DB 전환과 데이터 이관은 실행하지 않았으며 개발 CD에는 별도 전환 승인이 필요합니다.
base + `docker-compose.prod.yaml`은 `:main` 앱 이미지와 외부 PostgreSQL·SMTP를 사용하는 운영 설정 준비입니다. 현재 게시 workflow는 develop 전용이므로 main 이미지 가용성·실제 게시·배포는 확인되지 않았습니다.
선택 첨부 overlay는 base + local 뒤에 추가하는 로컬 MinIO 구성입니다. 소스 빌드 web은 nginx 정적 이미지이지 HMR이 아니며, hot reload는 각 서비스의 기본 네이티브 명령을 사용합니다.
브라우저는 nginx 단일 주소에서 `/api`를 사용하고 nginx가 Core·Content 내부 DNS로 중계합니다. API 404는 SPA HTML로 바꾸지 않고 UI deep link만 index.html로 연결합니다.

local은 web 5173·Core 8080·Content 8081·PostgreSQL 5432·Mailpit 1025/8025를 기본 loopback 포트로 공개하며 AI는 내부 전용입니다. dev는 기존 `CD_WEB_PORT` loopback 바인딩만 유지하고 DB·Mailpit은 호스트에 공개하지 않습니다. prod도 `WEB_PORT` loopback 바인딩이며 local과 같은 이름의 필수 입력과 항상 Secure인 쿠키를 사용합니다. 선택 MinIO도 loopback 전용입니다.
TLS·공개 ingress·외부 서비스는 제공하지 않으며 운영 준비 완료가 아닙니다. 모든 환경의 기본 Auth V4에 공개 비밀번호 샘플 회원 생성이 남아 있어 운영 사용 전 별도 보안 판단이 필요합니다. 이번 설정 변경에서 기존 migration은 수정하지 않습니다.
OpenAI 설정을 사용할 때도 AI 런타임만 받고 Core·Frontend·build ARG에는 키를 넣지 않습니다.
실행과 검증, 환경파일 경계는 [인프라 안내](../infrastructure/README.md)를 따릅니다.

## 제품 목표와 미정 정책 — 미구현

- Core는 회원·인증·세션·크레딧·회원 알림을 소유합니다.
- 콘텐츠 서비스는 작품·세계관·회차·버전·Fork·발행·독서·작품 피드백·첨부 및 콘텐츠 인가·제안 채택·반영을 소유합니다.
- 운영 서비스는 고객지원·공지·이벤트·신고 사건·소명·운영 판단·감사·작업 감시를 소유합니다. 실제 회원 제한은 Core, 콘텐츠 제한은 콘텐츠 서비스에 적용 요청합니다.
- AI는 업무 소유 서비스가 허용한 최소 문맥에서 생성·시뮬레이션·검토 결과만 반환합니다. LLMOps는 운영 영역으로 분리하며 Langfuse 자체 UI/API 통합은 미정입니다.
- 작품 Fork의 기준 회차·버전은 보존합니다. 세계관은 수정 전 원본의 허용된 변경을 따르고, 최초 수정으로 독립한 뒤에는 알림에 따른 사용자 선택으로만 원본 변경을 반영합니다(DEC-32·34).
- 설정 항목별 공개/비공개와 회차별 공개 범위를 적용하고, 사용자 권한·미발행 원고·인물별 인지도 구분합니다(DEC-36).
- 생성·제안과 사용자 승인·정본 반영을 구분합니다.
- 외부 IP 등록 시 등록자에게 2차 창작 권리 확인 여부를 묻지만 플랫폼이 작품별 권리를 직접 검증한다고 가정하지 않습니다(DEC-38). 비용·실행 한도·신고·자동 연재 조건은 [README 기획](../README.md)을 참고하며 임의 확정하지 않습니다.

기능마다 서버를 복제하지 않으며 새 빈 업무 계층·인프라는 실제 계약과 요구가 정해질 때만 추가합니다.

이슈 #50 범위의 서버 작품 집필실은 `/studio/{UUID}`에서 회차별 초안·불변 버전·발행본을 구분합니다. Frontend의 기존 EpisodeUseCase/Repository를 재사용합니다. Core는 #84에 따라 기능별 Controller/Service와 JPA Repository로 전환하며 최소 JPA 의존성을 추가합니다. 새 서버·Gradle 모듈은 추가하지 않습니다. 세부 계약은 [이슈 #50 대응](issue-50-alignment.md)을 참고합니다.


## #84 콘텐츠 책임 분리

`work`는 작품·정책, `episode`는 회차 생성·조회·초안 수정, `episode_version`은 불변 버전·복원·부분 체크포인트, `publication`은 발행 사건과 공개 상태를 소유합니다. `world`는 설정 버전·공개 범위, `fork`는 분기 기준·원작 추적·독립·변경 선택, `proposal`은 AI 접수·호출·승인·반영 이력, `context`는 허용 문맥 구성을 담당합니다. `WorkAccessService`는 이들 기능이 공유하는 소유권·공개 접근·작품 잠금 기준을 제공합니다. 전 기능을 대신 저장하는 중앙 Repository·Service는 없습니다.

콘텐츠는 별도 JPA 영속성 단위와 `contentTransactionManager`를 사용하고, Auth는 기존 JDBC 트랜잭션을 유지합니다. 작품·원작의 행 잠금을 ID 순서로 획득하고 오래된 1차 캐시를 갱신한 뒤 revision을 비교합니다. 저장·복원·제안 반영은 각 유스케이스 트랜잭션에서 원자적으로 처리합니다. AI 요청은 짧은 준비 트랜잭션과 결과 검증 트랜잭션 사이에서 실행하며 외부 호출 동안 DB 트랜잭션을 유지하지 않습니다.

SQL 위치는 `db/migration/auth`와 `db/migration/content`이며 기존 `flyway_schema_history`·`content_schema_history`를 유지합니다. 공통 콘텐츠 과거 이력은 분할·재실행하지 않으며 Hibernate는 스키마를 변경하지 않습니다. V5의 JDBC는 이관 전용 패키지에 격리합니다. 회차 삭제 정책·전체 세계관/그래프 체크포인트는 미확정 범위로 남깁니다. 실제 검증 상태는 [#84 대응](issue-84-content-boundaries.md)에 기록합니다.

Content 세계관의 `world.entity`·`world.repository`와 독립 WorldStudio의 `world.studio.entity`·`world.studio.repository`는 별도 JPA 스캔 범위입니다. Content의 `WorldRepository`(String)와 WorldStudio의 `StudioWorldRepository`(UUID)를 구분하며, WorldStudio 비활성 시 Content에 독립 스키마를 요구하지 않습니다. 공존 검증은 현재 WorkService·WorldService와 WorldStudioService로 수행합니다.
