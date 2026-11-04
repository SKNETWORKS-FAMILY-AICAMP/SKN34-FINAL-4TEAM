# STORYFORK 아키텍처

## 현재 구현

콘텐츠 저장은 작품·세계관 연결 이력·회차 버전·발행 사건·Fork 기준점·AI 선택/적용 관계로 정규화했습니다. 조회 VIEW가 현재 상태를 계산하며 이전 `content_work` JSONB는 이관 백업입니다. [물리 대응과 보존 경계](content-erd-migration.md)를 참고하세요.

> 설계상 명칭은 **Core Service·AI Service**입니다. 아래 `core-api`, `Core API` 표기는 현재 실행 모듈 이름과 HTTP 인터페이스이며 서비스 이름의 변경을 코드·배포에 적용했다는 뜻이 아닙니다. 새 MVP 방향은 [시스템 설계](design/design.md)·[DEC-26~28](design/decisions.md#결정-목록)에 있습니다.

STORYFORK 화면 데모와 Core·AI 연결 확인, Core의 이메일 가입·인증, 로그인·세션, 비밀번호 복구·프로필 API를 제공하는 개발 기반입니다. 선택적 `/content` React 작업실과 `/studio/{UUID}`는 Core 콘텐츠 API를 사용하며 Core가 PostgreSQL 정본 및 AI Service `/internal/v1/proposals` 요청을 소유합니다. 나머지 목업 화면과 구분하며 상세 범위·검증 한계는 [콘텐츠 통합 안내](content-integration.md)를 참고하세요. 실제 약관·동의와 회원 탈퇴는 미구현이므로 운영 가입용이 아닙니다.
서비스 책임을 분리한 MSA 구조입니다. Frontend는 TypeScript로 Clean Architecture·MVVM을 따르고,
백엔드는 기능 중심 레이어드 구조를 유지합니다.

```text
Browser → React Web → 공개 Core API → 내부 FastAPI AI Service
             /api       /api/v1/health       /internal/v1/health
                        /api/v1/health/ai-service
```

사용자가 명시적으로 생성할 때 AI Service에서 OpenAI Responses API를 호출합니다. 개인 브랜치의 모델 설정은 팀 전체 모델 선정 결정과 구분합니다. 새 Agent 프레임워크·그래프 DB는 도입하지 않았습니다.
키 없이 시작하며 Health는 OpenAI 인증·모델 접근·생성 검증이 아닙니다.
가입 후보·회원·refresh 세션·복구/이메일 변경 challenge 저장에 PostgreSQL·Flyway, 로컬 메일 확인에 Mailpit을 사용합니다. SMTP는 가입 인증·비밀번호 복구·이메일 변경에 사용하며, 가입 인증은 24시간, 복구·이메일 변경 challenge는 1시간 유효합니다. `CONTENT_ENABLED=true`일 때 같은 PostgreSQL에서 별도 `content_schema_history`로 콘텐츠 저장을 활성화합니다. 비공개 콘텐츠 API는 JWT Bearer 인증을 요구하고 공개 작품은 GET만 익명으로 조회합니다. Redis·큐·worker·운영 seed는 없습니다.

## 합의된 향후 구성요소 (미구현)

아래 미구현 구성은 **계획**이며 현재 적용된 부분과 구분합니다. DB에는 인증·프로필과 선택적으로 활성화한 콘텐츠 데이터가 저장됩니다. 기존 유스케이스의 세부 정책과 충돌할 때는 [DEC-26~28](design/decisions.md#결정-목록)을 우선합니다.

| 구성요소 | 용도 | 상태 |
|---|---|---|
| PostgreSQL·Flyway | 회원·가입 후보·refresh 세션·복구/이메일 변경 challenge 및 콘텐츠 저장 | 인증·프로필 적용, 콘텐츠는 선택적 활성화 |
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

기존 `_common`에는 HTTP 연결 설정 검증·RestClient·통신 실패 분류·안전한 ProblemDetail·전역 CORS만 남습니다.
Health 연결 불가는 503, timeout은 504, 잘못된 응답과 예상하지 않은 HTTP 상태는 502입니다.
콘텐츠 생성은 `ContentConfig`의 별도 HTTP 클라이언트를 사용합니다. Health 읽기 기본값은 12초, 생성은 75초이며 생성 실패는 콘텐츠 API의 503으로 반환합니다.
내부 URL·오류 원문은 공개하지 않으며 AI 장애가 Core 자체 Health 성공을 막지 않습니다.

### WorldStudio 독립 JPA 저장소·Service (HTTP API 연결 전)

개발 CD는 기존 Core 이미지의 별도 `WorldStudioMigration` main을 일회성으로 실행한 뒤 새 Core를 기동합니다.
일반 서버 시작에서는 WorldStudio DDL을 실행하지 않습니다. 대상 allowlist·백업 복원 기록·명시 활성화가 없으면 기본 비활성이며,
실제 공유 DB 적용은 이번 구현과 구분합니다. [배포 실행 계약](deployment/worldstudio-v1-rollout.md)을 따릅니다.

[독립 초기 설계](design/worldstudio-independent-schema.md)는 기존 Content/Auth와 다른 `worldstudio` schema에 12개 정본 테이블을 둡니다. 전용 Flyway location/history는 `db/migration/worldstudio` / `worldstudio.world_studio_schema_history`이며 서버 기본 DataSource·Auth migration 경로·Content writer를 변경하지 않습니다. `WorldStudioConfig → WorldStudioService → Spring Data JpaRepository`가 기존 Core 기본 EntityManager·TransactionManager와 `@Transactional`로 생성·초안·확정·과거 조회·복원을 처리합니다. subject는 검증된 JWT의 UUID를 전달받으며 모든 world 접근에서 소유권과 world별 잠금을 검사합니다. 세계관 업무에는 Content·Auth 테이블 FK/조회 의존이 없습니다. Core 공통 JPA는 기존 Auth 초기화와 함께 사용합니다. 서버 시작 DDL·HTTP API·기존 UI 연결·공용 DB 적용은 포함하지 않으며 Graph·AI·이미지를 추가하지 않습니다.

### 설정 첨부 (#87)

`attachment/controller → AttachmentService → JPA repository / S3 client`가 기존 소유 로컬 Setting의 이미지·일반 파일 CRUD와 표지·회차 이미지를 처리합니다. `SettingAttachmentController`·`WorkCoverController`·`EpisodeImageController`와 기존 HTTP 계약은 유지합니다.
요청/응답 DTO는 `attachment/service/dto`, S3 전용 계약은 `attachment/client/dto`에 둡니다. `AttachmentConfig`·`AttachmentProperties`는 기존 `app.setting-attachments` 속성·활성화 조건을 유지하며 기존 Auth JPA·Content JDBC 경계는 바꾸지 않습니다.
`setting_document`·`world`·`work_current`의 기존 소유권을 확인하고 following Fork·익명 공개·URL만 아는 접근은 허용하지 않습니다.
이미지는 설정당 10개를 설정 행 잠금으로 보호하고 일반 파일에는 그 한도를 적용하지 않습니다.
파일은 비공개 버킷에 UUID key로 저장하며 원본 endpoint가 아닌 Core의 인증 download API만 노출합니다.
새 Flyway leaf/history는 `db/migration/settingattachment`/`setting_attachment_schema_history`입니다.
Auth SQL은 내용과 기존 이력을 보존한 채 `db/migration/auth`로 이동하여 독립 V1과 충돌하지 않게 합니다.

공식 AWS SDK는 배포에서 기본 자격증명 체인·S3 region을, 로컬 MinIO에서는 endpoint override·path-style을 사용합니다.
MinIO는 [선택 overlay](../infrastructure/compose.attachments.yaml)의 소스 빌드 로컬 runtime이며 AWS 인프라·버킷을 자동 생성하지 않습니다.
교체/삭제의 일반적인 DB/저장소 실패는 제한된 메모리 백업으로 복원하지만 분산 원자성·프로세스 종료 복구를 보장하지 않습니다.
복원 실패는 명시적인 503이고 미참조 object는 수동 대조 대상입니다. worker/outbox는 없습니다.
허용 형식·10 MiB 기술 제한·안전한 attachment 응답·API·한계는 [Core 계약](../backend/core-api/README.md#설정-이미지일반-파일-87)에 있습니다.
#92에서 실제 `/content` 설정 첨부 UI와 연결합니다. 이 변경은 브라우저 흐름에 영향을 주므로 실제 MinIO HTTP lifecycle 외에 Aside 정상·실패 E2E가 필요합니다.

### 작품 표지·본문 이미지 (#92)

`attachment/controller → AttachmentService → JPA repository / 기존 S3 client`가 표지·회차 이미지 정본을 관리합니다. 별도 production 의존성·실행 계층을 추가하지 않고 attachment의 bounded Hikari pool·EntityManager를 재사용합니다. `content_image`(회차 0 = 단일 표지, 양수 = 불변 회차 이미지)와 별도 `content_image_schema_history`만 추가하며 기존 Auth·Content·설정 첨부 migration은 보존합니다.

원고의 `[[image:<UUID>]]` 참조가 삽입 위치와 불변 bytes를 연결합니다. Core는 동일 작품·회차의 참조만 저장하고 공개 download는 기존 공개 회차 본문에 실제 포함된 marker로 제한합니다. inherited 원고는 기존 고정 본문의 참조만 허용하며 새로운 Fork 공유 정책은 추가하지 않습니다. 표지 변경/삭제의 미참조 object는 모호한 DB commit 때 기존 bytes 손실을 피하도록 비공개 버킷에 남을 수 있고 자동 정리 worker는 없습니다. 상세 [표지·원고 계약](../backend/core-api/README.md#작품-표지원고-이미지-92)을 따릅니다.

Frontend의 공유 `MediaPanel/useMediaViewModel → MediaUseCase → HttpMediaRepository`가 실제 UUID 대상으로 인증 multipart/bytes를 전송합니다. View에서 Repository를 호출하지 않으며 이미지 Blob URL은 교체·이탈 때 해제합니다. `/content`의 생성 표지·기존 표지·설정 첨부 및 `/studio/{UUID}`의 커서 이미지·저장 버전 미리보기·텍스트 전용 TXT에 연결하고 기존 이름 기반 데모에는 서버 미저장 안내를 둡니다. 실패한 표지/첨부 요청은 기존 데이터와 생성된 작품을 보존하며 성공 fallback을 두지 않습니다.

## AI Service

`app/main.py`가 FastAPI와 Health router를 조립하고 `health/models.py`의 고정된 타입 응답을 반환합니다.
외부 모델 자원이 없어 컨테이너·lifespan·설정 조립은 없습니다.
향후 합의된 AI 기능은 필요한 `router → service → agent → OpenAI` 흐름으로 추가합니다.
상세는 [Agent 구현 경계](../backend/ai-service/docs/agent-structure.md)를 따릅니다.

## 실행·보안 경계

공통 `docker-compose.yaml`은 세 앱의 환경·내부 포트를 정의하며 단독 실행하지 않습니다.
base + `docker-compose.prod.yaml`은 소스 빌드한 nginx 정적 web·Core·AI와 PostgreSQL·Mailpit을 사용합니다.
base + `docker-compose.dev.yaml`은 CI가 게시한 `:develop` 이미지 세 개와 기존 외부 PostgreSQL·SMTP를 사용하며 소스 build·mount는 없습니다.
선택 첨부 overlay는 base + prod 뒤에만 추가하는 로컬 MinIO 구성입니다. HMR은 Compose가 아닌 각 서비스의 기본 네이티브 명령을 사용합니다.
브라우저는 nginx 단일 주소에서 `/api`를 사용하고 nginx가 내부 Core DNS로 중계합니다.
API 404는 SPA HTML로 바꾸지 않고 UI deep link만 index.html로 연결합니다.

두 조합 모두 web만 loopback에 공개하며 Core·AI 포트는 내부 전용입니다. 선택 MinIO의 API·Console도 loopback에만 공개합니다.
인증·TLS가 없는 **로컬 검증용**이며 인터넷 운영 준비가 된 배포가 아닙니다.
OpenAI 설정을 사용할 때도 AI 런타임만 받고 Core·Frontend·build ARG에는 키를 넣지 않습니다.
실행과 검증, 환경파일 경계는 [인프라 안내](../infrastructure/README.md)를 따릅니다.

## 제품 목표와 미정 정책 — 미구현

- Core는 작품·세계관·회차 버전·Fork 정본과 권한·승인·발행·크레딧 최종 판단·저장을 소유합니다.
- AI는 Core가 허용한 최소 문맥에서 생성·시뮬레이션·검토 제안만 반환합니다.
- 작품 Fork의 기준 회차·버전은 보존합니다. 세계관은 수정 전 원본의 허용된 변경을 따르고, 최초 수정으로 독립한 뒤에는 알림에 따른 사용자 선택으로만 원본 변경을 반영합니다(DEC-32·34).
- 설정 항목별 공개/비공개와 회차별 공개 범위를 적용하고, 사용자 권한·미발행 원고·인물별 인지도 구분합니다(DEC-36).
- 생성·제안과 사용자 승인·정본 반영을 구분합니다.
- 외부 IP 등록 시 등록자에게 2차 창작 권리 확인 여부를 묻지만 플랫폼이 작품별 권리를 직접 검증한다고 가정하지 않습니다(DEC-38). 비용·실행 한도·신고·자동 연재 조건은 [README 기획](../README.md)을 참고하며 임의 확정하지 않습니다.

기능마다 서버를 복제하지 않으며 새 빈 업무 계층·인프라는 실제 계약과 요구가 정해질 때만 추가합니다.

이슈 #50 범위의 서버 작품 집필실은 `/studio/{UUID}`에서 회차별 초안·불변 버전·발행본을 구분합니다. 기존 EpisodeUseCase/Repository와 ContentController/Service/Repository 경계를 재사용하며 새 실행 서비스나 production 의존성을 추가하지 않았습니다. 세부 계약은 [이슈 #50 대응](issue-50-alignment.md)을 참고합니다.
