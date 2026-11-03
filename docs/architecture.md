# STORYFORK 아키텍처

## 현재 구현

콘텐츠 저장은 작품·세계관 연결 이력·회차 버전·발행 사건·Fork 기준점·AI 선택/적용 관계로 정규화했습니다. 조회 VIEW가 현재 상태를 계산하며 이전 `content_work` JSONB는 이관 백업입니다. [물리 대응과 보존 경계](content-erd-migration.md)를 참고하세요.

> 설계상 명칭은 **Core Service·AI Service**입니다. 아래 `core-api`, `Core API` 표기는 현재 실행 모듈 이름과 HTTP 인터페이스이며 서비스 이름의 변경을 코드·배포에 적용했다는 뜻이 아닙니다. 새 MVP 방향은 [시스템 설계](design/design.md)·[DEC-26~28](design/decisions.md#결정-목록)에 있습니다.

세 서비스 개발 기반에 개인 브랜치의 선택적 콘텐츠 기능을 추가했습니다. `/content` React 작업실은 Core `/api/v1/works`를 호출하고 Core가 PostgreSQL 정본 및 AI Service `/internal/v1/proposals` 요청을 소유합니다. 상세 범위·인증·검증 한계는 [콘텐츠 통합 안내](content-integration.md)를 참고하세요.
서비스 책임을 분리한 MSA 구조입니다. Frontend는 TypeScript로 Clean Architecture·MVVM을 따르고,
백엔드는 기능 중심 레이어드 구조를 유지합니다.

```text
Browser → React Web → 공개 Core API → 내부 FastAPI AI Service
             /api       /api/v1/health       /internal/v1/health
                        /api/v1/health/ai-service
```

사용자가 명시적으로 생성할 때 AI Service에서 OpenAI Responses API를 호출합니다. 개인 브랜치의 모델 설정은 팀 전체 모델 선정 결정과 구분합니다. 새 Agent 프레임워크·그래프 DB는 도입하지 않았습니다.
키 없이 시작하며 Health는 OpenAI 인증·모델 접근·생성 검증이 아닙니다.
`CONTENT_ENABLED=true`일 때 JDBC·Flyway로 PostgreSQL 콘텐츠 저장을 활성화합니다. Redis·큐·worker·실제 로그인·운영 seed는 추가하지 않았습니다. 인증 공급자가 없는 기본 환경에서 쓰기는 401이며 네이티브 loopback 검증용 작성자는 별도 설정입니다.

## 합의된 향후 구성요소 (미구현)

아래는 **계획**이며 현재 코드·Compose에는 업무 DB가 없습니다. 기존 유스케이스의 세부 정책과 충돌할 때는 [DEC-26~28](design/decisions.md#결정-목록)을 우선합니다.

| 구성요소 | 용도 | 상태 |
|---|---|---|
| PostgreSQL·Flyway | 설정·원고 원문, 버전·체크포인트·Fork·AI 작업·피드백. PostgreSQL 스키마는 Flyway | MVP 방향(DEC-26·27), 미설치 |
| 관계 그래프 DB | 인물·엔티티 관계 저장·조회; 문서·원고 전문은 제외 | MVP 방향(DEC-26), 제품·연동 미정 |
| `pg_git` (`seanwevans/pg_git`) | MVP 이후 PostgreSQL 확장 도입을 신중히 추진 | MVP 미적용. 포크·설치·개발은 아직 안 함(DEC-27·30) |
| MinIO(S3 호환) | 설정 이미지 파일, RDB에는 URL | MVP 방향(DEC-39), 미설치 |
| Elasticsearch·Langfuse·SMTP | 검색 확장·AI 관측·이메일 | 기존 MVP 이후 범위(DEC-18·22 등) |
| 모델 API·프레임워크 | 선택적 AI 집필·시뮬레이션 | 선정 미정. 현재 모델 호출 없음 |

저장 경계: 설정·원고 전문 및 콘텐츠의 확정 버전·되돌리기·체크포인트·Fork는 PostgreSQL, 관계 정보는 그래프 DB에서 다룹니다. 콘텐츠 변경을 기존 버전 덮어쓰기로 처리하지 않습니다. 두 DB의 연결 키·정본 여부·동기화·복구, Fork의 기준 관계 고정과 AI 조회 경로는 아직 설계하지 않았습니다. Gitea는 사용하지 않습니다. 세계관 설정은 항목별 공개·비공개와 회차별 공개 범위를 두고 사용자 권한·미발행 원고·인물별 인지 범위를 구분합니다(DEC-36).

## Frontend

업무 기능은 TypeScript로 Clean Architecture·MVVM을 따릅니다([Frontend 지침](../frontend/AGENTS.md#구조와-의존성)).
실행 흐름은 `View → ViewModel → UseCase → Repository 구현 → HTTP API`, 의존 방향은 `Presentation → Domain ← Data`이며
`app/di`(Awilix)가 UseCase와 Repository 구현체를 연결합니다. 업무 기능은 아직 없어 `domain` 계층은 미구현입니다.

`App`은 `/`의 시작 화면과 알 수 없는 UI 경로의 안전한 홈 이동만 담당합니다.
실제 상태 UI는 `CoreApiConnectionStatus → useCoreApiHealth → appContainer 외부 함수 → Fetch·Zod`입니다.
두 공개 API의 상태·서비스명을 검증하며 AI는 항상 Core를 경유합니다.

- Awilix `app/di`가 두 Health 함수를 등록하고 전역 `appContainer`를 재사용합니다.
- Hook이 로딩·성공·실패·재시도, 요청 취소와 늦은 응답 무시를 담당합니다.
- 화면 상태는 Hook 한 곳에만 있으며 Store·Provider·업무 UseCase·Repository는 없습니다.
- Fetch는 Data Layer에만 있고 20초 제한과 안전한 화면 오류를 사용합니다.
- 기존 Tailwind 색상·타이포그래피·연결 상태 스타일을 재사용합니다.

## Core Service (현재 모듈: `core-api`)

Gradle group은 `ai.storyfork`, 애플리케이션은 `storyfork-core-api`, namespace는 `ai.storyfork.core`입니다.
물리 main/test 소스 루트는 `backend/core-api/src/{main,test}/kotlin/ai/storyfork/core/`입니다.

`_health/controller`는 자체 상태를 반환합니다.
`_health_ai_service/controller → service → client`는 내부 AI Health를 호출합니다.
Client의 nullable payload를 Service에서 `up`·`storyfork-ai-service`로 검증한 뒤 내부 Result와
공개 Response로 변환합니다. 경계별 DTO 소유권을 유지하며 필요 없는 Facade는 없습니다.

기존 `_common`에는 HTTP 연결 설정 검증·RestClient·통신 실패 분류·안전한 ProblemDetail·전역 CORS만 남습니다.
연결 불가는 503, timeout은 504, 잘못된 응답과 예상하지 않은 HTTP 상태는 502입니다.
내부 URL·오류 원문은 공개하지 않으며 AI 장애가 Core 자체 Health 성공을 막지 않습니다.

## AI Service

`app/main.py`가 FastAPI와 Health router를 조립하고 `health/models.py`의 고정된 타입 응답을 반환합니다.
외부 모델 자원이 없어 컨테이너·lifespan·설정 조립은 없습니다.
향후 합의된 AI 기능은 필요한 `router → service → agent → OpenAI` 흐름으로 추가합니다.
상세는 [Agent 구현 경계](../backend/ai-service/docs/agent-structure.md)를 따릅니다.

## 실행·보안 경계

정확히 `web`, `core-api`, `ai-service` 세 서비스만 있습니다.
개발 Compose는 Vite hot reload와 소스/node_modules volume, prod는 pnpm locked build와 nginx 정적 runtime입니다.
브라우저는 `/api`를 사용하고 Vite/nginx가 내부 Core DNS로 중계합니다.
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

이슈 #50 범위의 서버 작품 집필실은 `/studio/{UUID}`에서 회차별 초안·불변 버전·발행본을 구분합니다. 기존 EpisodeUseCase/Repository와 ContentController/Service/Repository 경계를 재사용하며 새 실행 서비스나 production 의존성을 추가하지 않았습니다. 세부 계약은 [이슈 #50 대응](issue-50-alignment.md)을 참고합니다.
