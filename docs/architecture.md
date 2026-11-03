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
| PostgreSQL·Flyway | 회원·가입 후보·refresh 세션·복구/이메일 변경 challenge 및 콘텐츠 저장 | 인증·프로필 적용. 콘텐츠는 선택적 활성화하며 원문·버전·부분 체크포인트·Fork·AI 이력을 저장. 전체 도메인·운영 검증은 별도 |
| 관계 그래프 DB | 인물·엔티티 관계 저장·조회; 문서·원고 전문은 제외 | MVP 방향(DEC-26), 제품·연동 미정 |
| `pg_git` (`seanwevans/pg_git`) | MVP 이후 PostgreSQL 확장 도입을 신중히 추진 | MVP 미적용. 포크·설치·개발은 아직 안 함(DEC-27·30) |
| MinIO(S3 호환) | 설정 이미지 파일, RDB에는 URL | MVP 방향(DEC-39), 미설치 |
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

Auth의 가입 후보·메일 인증은 `auth/controller → SignupService → SignupRepository` 경로로 저장합니다. 로그인·세션은 `SessionController → SessionService → JdbcTemplate`, 프로필·비밀번호 복구·이메일 변경은 `ProfileController → ProfileService → JdbcTemplate` 경로로 직접 SQL에 접근합니다. `SignupRequest`·`EmailRequest`·`TokenRequest`·`VerificationRequest`는 `auth/controller/dto`에 두고, 나머지 요청 DTO는 각 Controller 안에 둡니다. 미인증 후보는 재가입 요청으로 교체하고 가입 인증은 최신 토큰과 가입 시 정한 비밀번호를 모두 요구합니다. 이메일 변경 확인은 별도 token-only 계약을 유지합니다. CSRF는 모든 변경 요청에 적용하며 실제 약관 동의와 회원 탈퇴는 후속 범위입니다. 공개 경로와 요청·응답은 [Core API 계약](../backend/core-api/README.md#공개-계약)을 따릅니다.

`_common`에는 HTTP 연결 설정 검증·RestClient·통신 실패 분류·안전한 ProblemDetail·전역 CORS와 여러 콘텐츠 기능에서 공유하는 실패·식별자 계약이 있습니다.
Health 연결 불가는 503, timeout은 504, 잘못된 응답과 예상하지 않은 HTTP 상태는 502입니다.
콘텐츠 생성은 `proposal/config/GenerationClientConfig`의 별도 HTTP 클라이언트를 사용합니다. Health 읽기 기본값은 12초, 생성은 75초이며 생성 실패는 콘텐츠 API의 503으로 반환합니다.
내부 URL·오류 원문은 공개하지 않으며 AI 장애가 Core 자체 Health 성공을 막지 않습니다.

## AI Service

`app/main.py`가 Health·generation router를 조립합니다. 내부 인증된 생성 요청에서만 OpenAI를 호출하며 정본은 Core에서 반영합니다.
시작 시 모델 클라이언트를 만들지 않습니다. 생성 요청에서만 AI 런타임의 키·모델·내부 토큰 설정을 사용합니다.
향후 합의된 AI 기능은 필요한 `router → service → agent → OpenAI` 흐름으로 추가합니다.
상세는 [Agent 구현 경계](../backend/ai-service/docs/agent-structure.md)를 따릅니다.

## 실행·보안 경계

`web`, `core-api`, `ai-service`와 로컬 검증용 PostgreSQL·Mailpit이 있습니다.
개발 Compose는 nginx 진입점과 Vite hot reload 및 소스/node_modules volume, prod는 pnpm locked build와 nginx 정적 runtime입니다.
브라우저는 nginx 단일 주소에서 `/api`를 사용하고 nginx가 내부 Core DNS로 중계합니다. 개발 HMR WebSocket도 nginx를 경유합니다.
API 404는 SPA HTML로 바꾸지 않고 UI deep link만 index.html로 연결합니다.

dev는 web과 디버깅용 Core를 loopback에, prod는 web만 loopback에 공개합니다. AI 포트는 내부 전용입니다.
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

이슈 #50 범위의 서버 작품 집필실은 `/studio/{UUID}`에서 회차별 초안·불변 버전·발행본을 구분합니다. Frontend의 기존 EpisodeUseCase/Repository를 재사용합니다. Core는 #84에 따라 기능별 Controller/Service와 JPA Repository로 전환하며 최소 JPA 의존성을 추가합니다. 새 서버·Gradle 모듈은 추가하지 않습니다. 세부 계약은 [이슈 #50 대응](issue-50-alignment.md)을 참고합니다.


## #84 콘텐츠 책임 분리

`work`는 작품·정책, `episode`는 회차 생성·조회·초안 수정, `episode_version`은 불변 버전·복원·부분 체크포인트, `publication`은 발행 사건과 공개 상태를 소유합니다. `world`는 설정 버전·공개 범위, `fork`는 분기 기준·원작 추적·독립·변경 선택, `proposal`은 AI 접수·호출·승인·반영 이력, `context`는 허용 문맥 구성을 담당합니다. `WorkAccessService`는 이들 기능이 공유하는 소유권·공개 접근·작품 잠금 기준을 제공합니다. 전 기능을 대신 저장하는 중앙 Repository·Service는 없습니다.

콘텐츠는 별도 JPA 영속성 단위와 `contentTransactionManager`를 사용하고, Auth는 기존 JDBC 트랜잭션을 유지합니다. 작품·원작의 행 잠금을 ID 순서로 획득하고 오래된 1차 캐시를 갱신한 뒤 revision을 비교합니다. 저장·복원·제안 반영은 각 유스케이스 트랜잭션에서 원자적으로 처리합니다. AI 요청은 짧은 준비 트랜잭션과 결과 검증 트랜잭션 사이에서 실행하며 외부 호출 동안 DB 트랜잭션을 유지하지 않습니다.

SQL 위치는 `db/migration/auth`와 `db/migration/content`이며 기존 `flyway_schema_history`·`content_schema_history`를 유지합니다. 공통 콘텐츠 과거 이력은 분할·재실행하지 않으며 Hibernate는 스키마를 변경하지 않습니다. V5의 JDBC는 이관 전용 패키지에 격리합니다. 회차 삭제 정책·전체 세계관/그래프 체크포인트는 미확정 범위로 남깁니다. 실제 검증 상태는 [#84 대응](issue-84-content-boundaries.md)에 기록합니다.
