# STORYFORK Content Service

Core에 있던 작품·회차·원고 버전·발행·세계관·독립 WorldStudio·Fork·제안·문맥·첨부 코드와 테스트를 소유하는 독립 Spring Boot 앱입니다. Core는 회원·인증·세션과 Auth migration을 유지하며 콘텐츠 요청을 중계하지 않습니다. [서비스 경계](../../docs/design/service-boundaries.md)와 [이관·연동 계약](../../docs/design/content-service-migration-contract.md)을 따릅니다.

**소스 추출·연결과 운영 전환은 다릅니다.** fresh 콘텐츠 초기 스키마로 이력을 재작성했으므로 기존 Content history에 바로 배포할 수 없습니다. 실제 DB 초기화·데이터 이동·공용 DB 적용·이미지 게시·배포는 수행하지 않았으며 최신 head의 hosted `Required CI` 성공도 확인 대기입니다. 운영 서비스는 실행 골격 그대로입니다.

## 실행 기반과 책임

- 독립 Gradle 프로젝트 `storyfork-content-service`, group `ai.storyfork`, 패키지 `ai.storyfork.content`, main `ContentServiceApplication` (`Application.kt`).
- Core와 같은 JDK 21·Kotlin 2.4.10·Spring Boot 4.1.0·Gradle 9.5.1 wrapper를 재사용합니다.
- MVC·RestClient·Security·Validation·JPA/JDBC·Flyway·PostgreSQL과 기존 Jackson/AWS S3 의존성을 실제 이전 기능에 사용합니다. 공통 starter·새 큐/worker/DB는 추가하지 않습니다.
- `work`, `episode`, `episode_version`, `publication`, `world`, `fork`, `proposal`, `context`, `attachment`, `plan`의 Controller → Service → Repository를 유지합니다. 중복 `content.content`와 중앙 production ContentService는 없습니다.
- 공개 API는 기존 `/api/v1/works`와 `/api/v1/public/works`를 유지합니다. nginx 및 Vite가 이 경로만 Content로 보내고 나머지 `/api`는 Core로 보냅니다. 내부 인증 endpoint는 공개 proxy에 등록하지 않습니다.
- [콘텐츠 사용자 흐름](../../docs/content-integration.md), [설정 첨부 계약](../core-api/README.md#설정-이미지일반-파일-87), [표지·원고 이미지 계약](../core-api/README.md#작품-표지원고-이미지-92)은 기존 URL 호환을 유지합니다. 첨부 계약 문서의 위치는 호환 링크를 위해 남겨 두었지만 실행 소유자는 Content입니다.

## 네이티브 실행

JDK 21의 `JAVA_HOME`과 필요한 변수만 해당 프로세스에 설정하고 이 디렉터리에서 실행합니다. 다음은 수동 실행 안내이며 로컬 자동 검증에서 앱을 기동하지 않습니다.

```bash
./gradlew bootRun
```

기본 주소는 `127.0.0.1:8081`, 앱 이름은 `storyfork-content-service`입니다. Core 8080·운영 골격 8082와 구분합니다. 콘텐츠·WorldStudio·첨부는 활성화 변수 없이 항상 켜져 있어 아래 필수 설정이 없으면 기동이 실패합니다. 이 기본 실행은 업무 API 준비 완료를 뜻하지 않습니다. 포트는 Spring 표준 `--server.port`로 변경할 수 있습니다.

Content 기동에는 기존 대상의 `DATABASE_URL/USER/PASSWORD`(기본값 없음, `jdbc:postgresql:` URL), Core와 동일한 별도 `CONTENT_CORE_AUTH_TOKEN`(32자 이상·개행 없음), WorldStudio 관계 정본용 `NEO4J_PASSWORD`(`NEO4J_URI`·`NEO4J_USERNAME` 기본값 `bolt://127.0.0.1:7687`·`neo4j`)가 필수이며, 없거나 형식이 맞지 않으면 시작이 실패합니다. 시작할 때 Content·WorldStudio·설정 첨부·콘텐츠 이미지 migration을 각자의 history에 적용하고 JPA는 `validate`만 합니다. `OPERATIONS_SERVICE_TOKEN`은 비어도 기동하지만 운영 전용 내부 API는 403입니다. 기본 Core 인증 origin은 `http://127.0.0.1:8080`, 연결/읽기 timeout은 `1s`/`3s`입니다. 생성은 Content와 AI의 동일한 `INTERNAL_TOKEN`을 사용하며 OpenAI 키·모델은 AI에만 전달합니다. 첨부 설정은 [네이티브 Content 안내](../../infrastructure/README.md#네이티브-content-첨부-설정)를 따릅니다.

루트 `.env` 한 곳에서 관리하고 서비스별 `.env`를 만들거나 전체 파일을 source하지 않습니다. 실제 `.env`는 자동 변경하지 않습니다. 네이티브 Frontend는 같은 origin의 `/api` proxy를 사용해야 두 소유 서비스로 라우팅됩니다(`VITE_DEV_PROXY_TARGET`, `VITE_CONTENT_DEV_PROXY_TARGET`). Compose는 필요한 값만 각 런타임에 전달하며 DB 대상·계정은 기존 Core 설정과 같습니다.

## Core 인증 클라이언트 — 실제 연결

[`CoreAuthClient`](src/main/kotlin/ai/storyfork/content/auth/client/CoreAuthClient.kt)는 Spring HTTP Service proxy Bean입니다. 보호 요청의 Bearer를 Core에 보내고 `VerifiedMemberResponse(memberId: UUID)`만 받아 Principal을 구성합니다.

```text
POST /internal/v1/auth/verify
Authorization: Bearer <사용자 access token>
X-Content-Service-Token: <별도 서비스 자격증명>
→ {"memberId":"<회원 UUID>"}
```

- `CONTENT_CORE_AUTH_TOKEN`은 32자 이상·개행 없는 별도 비밀값이며 루트 예시는 빈 값입니다. 사용자 Bearer·JWT 서명 키와 대체할 수 없습니다. Core는 상수 시간 비교와 기존 JWT 서명/만료 검증을 수행합니다.
- 인증 필수 요청마다 실제 확인하며 캐시·자동 재시도·개발 사용자 fallback은 없습니다. Content는 JWT 서명 키·Auth Entity/Repository를 받지 않습니다.
- 같은 Core 주소·서비스 자격·제한시간으로 `CoreMemberClient`가 작가 닉네임을 조회합니다(`POST /internal/v1/members/nicknames`, 사용자 Bearer 없음). 이 호출의 실패는 위 분류와 달리 모두 503이며 아래 "작품 응답" 문단에서 설명합니다.
- 사용자 무효 401 `UNAUTHORIZED`, 연결 불가/상대 503은 503 `CORE_AUTH_UNAVAILABLE`, timeout은 504 `CORE_AUTH_TIMEOUT`, 기타 상대 오류는 502 `CORE_AUTH_UPSTREAM_ERROR`, 빈/잘못된 응답·redirect는 502 `CORE_AUTH_INVALID_RESPONSE`입니다. 오류 원문·토큰을 노출하지 않습니다.
- 공개 작품 GET만 익명 허용하고 소유권·Fork·공개 회차 검사는 업무 Service가 담당합니다. 모든 공개 변경 요청의 CSRF 쿠키/`X-CSRF-TOKEN`·XOR 계약과 CORS를 유지합니다. 로그인·refresh·CSRF 발급은 Core 책임입니다.
- 기존 access JWT에는 세션 ID가 없어 refresh 세션 폐기 후 access token의 즉시 무효화를 새로 보장하지 않습니다.

## 운영 전용 내부 API

[운영 회원·신고 계약](../../docs/design/operations-member-report-contract.md#content-내부-api-운영-전용)의 작품 제한 API와 [운영 작품 조회 계약](../../docs/design/operations-work-contract.md#content-내부-api-서비스-토큰)의 작품 목록 API입니다. 회원 Bearer·CSRF 없이 `X-Operations-Service-Token`이 환경변수 `OPERATIONS_SERVICE_TOKEN`(32자 이상)과 같을 때만 허용하고, 미설정·짧음·불일치는 403입니다. 공개 proxy에 등록하지 않습니다.

- `GET /internal/v1/works` → `{ items: [{ workId, ownerId, title, authorName, originKind, creationType, rightsConfirmed, visibility, restricted }] }`. 공개·비공개·제한 작품 전체를 `title, id` 오름차순으로 쿼리 한 번에 읽습니다(페이지네이션 없음). `rightsConfirmed`는 권리 진술 행 존재 여부, `visibility`는 최신 발행 이력(없으면 `private`)이며 `restricted`와 독립입니다.
- `GET /internal/v1/works/{workId}` → `{ workId, ownerId, title, restricted }`, 없으면 404
- `PUT`·`DELETE /internal/v1/works/{workId}/restriction` → 같은 본문(`restricted` true/false)

제한 작품은 `/api/v1/public/works` 목록에서 빠지고 공개 상세·문맥·표지·회차 이미지와 새 분기 생성은 404/403입니다. 작가 본인 스튜디오(`/api/v1/works`)는 그대로입니다.

## 같은 DB와 fresh 콘텐츠 migration

물리 DB를 나누거나 데이터를 복사하지 않습니다. Core Auth와 Content는 기존 같은 대상/계정을 사용하되 각자 자기 테이블과 migration만 씁니다. Compose는 Core Health 이후 Content를 시작하여 새 공유 schema의 Auth 초기화가 먼저 끝나게 합니다. 서버 간 HTTP는 단일 DB transaction이 아닙니다.

| 전역 버전 | 명시 leaf | 책임 |
|---|---|---|
| V1 | `db/migration/work` | 자격증명 없는 로컬 member 참조·작품·장르·권리 |
| V2 | `db/migration/episode` | 회차·초안·삭제 revision floor |
| V3 | `db/migration/world` | 세계관·설정·버전·공개/회차 범위·지식·태그 |
| V4 | `db/migration/episode_version` | 불변 원고 버전 |
| V5 | `db/migration/publication` | 작품 공개 이력·발행 사건 |
| V6 | `db/migration/fork` | 체크포인트·Fork 정책/기준·변경 선택/반영 |
| V7 | `db/migration/proposal` | AI 작업·호출·입력·근거·제안·채택/반영 |
| V8 | `db/migration/work` | 의존 이력 이후 `work_current` view |
| V9 | `db/migration/episode` | Fork/발행 이후 `episode_current` view |
| V10 | `db/migration/plan` | 11번 비공개 플롯·장면 계획, 참조, revision·논리 삭제 |
| V11 | `db/migration/plan` | 작품 실제 삭제 시 해당 계획·참조만 종속 정리 |
| V12 | `db/migration/plan` | 인물·장소 순서 목록의 중복 검사를 커밋까지 지연 |
| V13 | `db/migration/work` | 운영 작품 제한 플래그 `work.restricted`(기본 false) |
| V14 | `db/migration/work` | 공개 회차 조회 기록 `work_view`(작품 검색·실시간 랭킹의 조회 수 정본) |
| V15 | `db/migration/work` | 공개 표시 메타데이터·불변 rich wiki 상세 추가 (샘플 자동 insert 없음) |
| V16 | `db/migration/sample` | 개발 샘플 행(CSV 정본에서 생성, 직접 편집 금지) |

[`ContentPersistenceConfig.MIGRATION_LOCATIONS`](src/main/kotlin/ai/storyfork/content/_common/config/ContentPersistenceConfig.kt)는 위 9개 leaf(`work`·`episode`·`world`·`episode_version`·`publication`·`fork`·`proposal`·`plan`·`sample`)만 발견하고 단일 `content_schema_history`에서 전역 순서를 검증합니다. 현재 전역 최댓값은 V16이며 새 SQL은 다음 번호를 씁니다. root 직하 SQL이나 `db/migration/content` 디렉터리는 없습니다. 과거 JSONB `content_work`·V5 importer·legacy runtime 모델/Repository는 새 초기 스키마에서 제거했습니다. 불변 trigger·복합 FK·revision/잠금·원문/순서 계약은 유지합니다.

11번 계획 API는 `/api/v1/works/{workId}/story-plans`의 GET·POST와 `/{id}`의 GET·PUT·DELETE를 제공합니다. 기존 인증·CSRF·작품 소유권 검사를 사용하며 다른 소유자의 작품·계획은 404입니다. 수정·삭제에는 계획의 `revision`을 사용하고 충돌은 409입니다. 인물·장소는 현재 작품의 `WorldService.read().settings`에서 분류와 허용 범위를 확인하고, 회차는 해당 작품에서 확인한 내부 ID로 연결합니다. 회차 삭제 후에는 계획을 유지하고 `episodeMissing`으로 안내하며 재사용된 번호에 자동 연결하지 않습니다. 논리 삭제된 계획은 일반 조회에서 제외하고, 하위 장면이 남은 플롯은 삭제하지 않습니다. 원고·사전·Fork 독립 상태는 변경하지 않습니다. V11은 V10을 포함한 기존 SQL·체크섬을 보존하며 작품이 실제 삭제될 때 그 작품의 계획(논리 삭제 포함)과 계획의 인물·장소 참조만 함께 정리합니다. 작품 삭제의 기존 권한·발행 이력·분기·세계관 설정 보호 조건은 바꾸지 않습니다. 운영·공유 개발 DB 적용은 별도 절차이며 자동 repair/clean하지 않습니다.

V12는 기존 V1~V11을 보존하고 계획의 인물·장소 `(plan_id, setting_id)` unique 제약만 `DEFERRABLE INITIALLY DEFERRED`로 교체합니다. Hibernate가 `[A,B,C] → [B,C]` 또는 `[A,B] → [B,A]`를 저장하는 중간의 일시 중복은 허용하되, 트랜잭션 커밋 시 최종 중복은 거부합니다. API의 중복 입력 검증, 순서 위치 PK, 작품·계획 외래키와 V11 삭제 동작은 유지합니다.

V14는 기존 V1~V13을 보존하고 `work_view`(작품·회차·회원·Asia/Seoul 날짜가 기본키, `viewed_at` 인덱스)만 추가합니다. 작품 삭제 경로는 바꾸지 않습니다. 조회 기록은 공개 작품의 발행 회차에만 생기고 발행 이력이 있는 작품의 삭제는 이미 409이기 때문입니다.

작품 검색·실시간 랭킹·조회 기록 API(`GET /api/v1/public/works?q&f&sort`, `GET /api/v1/public/works/ranking?kind`, `POST /api/v1/works/{id}/episodes/{number}/views`)는 [계약](../../docs/design/work-search-ranking-contract.md)을 따르고, `work_view` 기록과 24시간 집계는 `WorkViewService`가 맡습니다. 계약에 없는 경계는 `kind` 누락 400, `f`·`sort`·`kind`는 소문자 정확 일치 외(빈 문자열 포함) 422, 공백뿐인 `q`는 필터 없음, 해시태그는 검색어·저장값 모두 앞 `#` 무시로 정했고, `f=author`는 소유자의 Core 닉네임을 보고 `f=all`에도 포함합니다(`work.author_name`은 더 이상 읽지 않고 운영 목록 `GET /internal/v1/works`만 씁니다). `WorkResponse.views`는 공개 목록·검색·랭킹 응답에서만 채우며 그 밖은 0입니다. 같은 날 중복 기록은 nativeQuery 없이 처리합니다. 서비스 트랜잭션을 쓰지 않고 저장소 호출마다 독립 트랜잭션으로 선검사한 뒤, unique 위반이 나면 행이 이미 있는지 다시 확인해 중복일 때만 무시합니다. 공개 여부는 운영 제한을 뺀 `WorkAccessResult.publiclyVisible()` 하나로 판단하므로 제한 작품은 작가 검색을 포함한 검색·랭킹에서 빠지고 조회 기록도 404입니다. 검색은 공개 작품을 메모리에서 거르고 정렬하는 시연 규모 구현이고, 랭킹은 최근 48시간 조회 기록이 있는 작품만 읽어 순위 10개만 응답으로 조립하며, 서버 페이지네이션은 없습니다.

작품 응답(`WorkResponse`)의 `authorName`은 소유자의 Core 닉네임입니다. 공개 목록·검색·랭킹·공개 상세와 소유자 목록·상세(·생성·수정·정책·발행·분기 응답)는 응답 하나를 만들 때 소유자 ID를 모아 Core `POST /internal/v1/members/nicknames`를 **한 번** 호출하고(`CoreMemberClient`, 같은 `X-Content-Service-Token`·Core origin·제한시간·redirect 거부), Core에 없는 소유자는 `탈퇴한 회원`으로 표시합니다. UUID가 아닌 소유자는 Core에 묻지 않고 `탈퇴한 회원`이며, 한 응답의 소유자가 200개를 넘으면 200개씩 나눠 부릅니다. Core 실패(연결·시간 초과·상대 오류·빈 응답)는 임의 이름이나 캐시로 대체하지 않고 503입니다. 익명 공개 목록·검색·랭킹·상세도 이 호출에 의존하므로 Core가 내려가 있으면 503입니다. 공개 표지·회차 이미지의 공개 확인은 작가명이 필요 없어 `WorkService.publicEpisodes`로 Core를 부르지 않습니다. DB 테스트 컨텍스트는 `CoreMemberFixture`로 닉네임 조회를 대체합니다.

이 변경은 **사용자가 허용한 개발용 재초기화 전제**이며 과거 Content V1~V9 checksum과 호환되지 않습니다. 기존 적용 이력을 자동 repair/baseline 변경/clean하지 않습니다. 정확한 대상·중단 시간·보존 범위·복구 증거를 운영자가 확인하고 별도 승인하기 전 실제 DB/volume을 지우지 않습니다. 특히 같은 DB의 Auth·WorldStudio·첨부까지 일괄 폐기하는 승인이 아닙니다.

샘플 데이터는 [테이블별 UTF-8 CSV 정본에서 생성한 Flyway `db/migration/sample/V16`](../../infrastructure/sample-data/README.md)으로 서버 시작 시 적용됩니다. V15(샘플 이관 시점의 V10을 develop의 V10~V14 뒤로 옮긴 번호)는 샘플 행 없는 스키마 SQL로 유지하고 기존 Auth·Content V1~V9·첨부·WorldStudio migration 19개 바이트는 보존합니다. CSV 속성은 원문 근거가 있는 공개 시점만 부여하며 불확실한 값은 비공개입니다. rich 대상 편집/following Fork의 rich detach는 409로 보호하되 원작의 새 단순 설정 초안·확정은 기존 rich 상세를 바꾸지 않고 허용합니다. 실제 적용·hosted CI·브라우저 수용은 별도 확인 대기입니다.

Auth SQL은 Core의 `db/migration/auth`/`flyway_schema_history`에 원본 그대로 남습니다. 설정 첨부·이미지는 독립 leaf/history 및 바이트를 유지합니다. WorldStudio V1도 바이트/`worldstudio.world_studio_schema_history`를 유지하고 [명시 migration](src/main/resources/db/migration/worldstudio/README.md) 뒤에만 활성화합니다. 같은 `contentDataSource`를 사용하지만 studio-only EntityManager/TransactionManager이며 서버 시작은 `validate`만 합니다. 별도 WorldStudio DB/pool·Auth 스캔은 없습니다.

## 이미지·전환과 검증

Content Dockerfile·Compose·GHCR 게시 대상·nginx/Vite·CI 소비 선택을 연결했습니다. CD 배포는 develop CI 성공 후 별도 활성화·승인 변수 없이 실행됩니다. 동일 revision 이미지 확인 후 web/구 Core/Content writer를 중단하고 선택 WorldStudio migration → 새 앱 기동 순서이며 실패하면 자동 rollback/repair 없이 ingress를 멈춘 상태로 남깁니다. [인프라 절차](../../infrastructure/README.md#ci--cd-publish--deploy)를 따릅니다.

```bash
# 로컬: 순수 단위만 명시 선택
./gradlew unitTest --tests 'ai.storyfork.content.auth.CoreAuthVerificationServiceTest' --tests 'ai.storyfork.content.episode.ContentBoundaryTest' --no-daemon
# 아래는 hosted CI 호출이며 로컬 자동 실행 목록이 아님
./gradlew integrationTest --no-daemon
```

`unitTest`는 `build.gradle`에 분류한 Spring/실제·대역 HTTP/DB/Flyway를 제외하고 `integrationTest`는 그 경계만 실행합니다. 빈 발견/불일치는 실패합니다. hosted CI에는 격리 PostgreSQL fresh 초기화·validate·재실행 0건·변조 이력 거부, 실제 proxy 인증/timeout, Core 내부 보안, 실제 로그인 → Content 소유권·저장·Core 장애 503 시스템 회귀를 둡니다. CI를 구성한 것과 실행 성공은 구분합니다.

로컬 전체 suite·build/bootJar·Spring/DB/HTTP·컨테이너·시스템·브라우저는 실행하지 않습니다. S3 실물 lifecycle은 별도 격리 fixture가 필요하며 현재 CI의 조건부 skip을 통과로 표현하지 않습니다. 최신 Required CI·PR 병합 전 기능표는 ❌를 유지합니다.
