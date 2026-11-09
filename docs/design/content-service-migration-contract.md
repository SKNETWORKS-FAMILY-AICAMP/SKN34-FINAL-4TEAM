# 콘텐츠 서비스 이관·서비스 연동 계약

[메인 README](../../README.md) · [문서 목록](../README.md)

> **상태: Core → Content 추출 소스 구현, hosted CI·실제 DB 전환·배포 확인 대기.** DEC-41의 기존 업무·테스트·공개 라우팅·Core 인증 연결을 `content-service`로 옮겼다. 운영은 골격 그대로다. 사용자가 개발용 Content 이력 재작성을 승인했으나 정확한 DB/서버는 지정하지 않았으므로 실제 DB 삭제·개인 `.env` 수정·배포는 수행하지 않는다.

## 1. 이관 범위와 소유권

기존 `core-api`의 소설 관련 콘텐츠 업무는 `backend/content-service`로 이관한다. 구현된 동작부터 이전하고, 목표 기능이 문서에 있다는 이유로 미구현 업무를 새로 만들지 않는다.

| 콘텐츠 서비스로 이관 | 현재 코드 확인 출발점 |
|---|---|
| 작품 생성·수정·정책·콘텐츠 접근 권한 | `work` |
| 에피소드·회차 순서·원고·초안·동시 편집 | `episode` |
| 불변 버전·복원·체크포인트 | `episode_version` |
| 발행·공개 독서 범위 | `publication` |
| 세계관·설정·인물·관계·독립 WorldStudio | `world` 및 `world/studio` |
| Fork 기준점·원작 추적·독립·원본 변경 선택 반영 | `fork` |
| AI 작업 접수·허용 문맥·제안 채택·정본 반영 | `proposal`, `context` |
| 작품 표지·원고 이미지·설정 첨부·파일 참조·접근 권한 | `attachment` |
| 콘텐츠 설정·공유 실패/식별자 계약·관련 테스트 | `_common` 및 각 업무. 중복 `content.content`·legacy importer는 제거 |

검색·랭킹·큐레이션·댓글·작품 피드백·독서 기록·플롯도 콘텐츠의 목표 책임이다. 기존 구현이 있으면 포함하고, 없으면 후속 기능으로 남긴다. 패키지 이름만 보고 통째로 복사하지 말고 실제 호출과 공유 의존성을 확인한다. 특히 `work`의 회원 참조는 콘텐츠용 식별/표시 정보인지 Core 회원 정본인지 구분하며 비밀번호·세션 저장을 이전하지 않는다.

Core는 회원·인증·세션·크레딧·정산·회원 알림을 유지한다. 운영은 문의·신고 사건·소명·운영 결정·감사를 소유하고, AI는 요청된 모델 실행만 담당한다. 콘텐츠의 인가·채택·저장·발행 최종 판단은 콘텐츠에 남긴다.

## 2. 호출과 구현 규칙

```text
클라이언트 → 기존 공개 진입점 → 소유 서비스
콘텐츠 인증 경계 → CoreAuthClient → Core 인증 확인 → 검증된 회원 UUID
콘텐츠 Controller → Service → Repository → 콘텐츠 소유 DB
콘텐츠 Service → 필요한 Core / AI / 운영 연계 Client → 상대 서비스 API
```

- Core를 모든 콘텐츠 요청을 중계하는 프록시로 만들지 않는다. 공개 진입점에서 소유 서비스로 라우팅하되 기존 URL·JSON·UUID·쿠키·Bearer·CSRF·CORS 계약을 보존한다.
- HTTP 호출은 기능별 `client`, 전송 DTO는 `client/dto`, 설정은 `client/config`에 둔다. 필요한 경우에만 `client/mapper`·`client/exception`을 둔다. 단순 호출을 감싸는 Facade·공통 starter·만능 Client를 추가하지 않는다.
- 공개 Controller/Service DTO는 해당 기능의 `service/dto`를 재사용한다. Entity를 서비스 간 전송하거나 다른 앱의 Entity·Repository를 import하지 않는다.
- Client는 base URL·연결/읽기 timeout을 설정으로 받고 redirect로 자격증명을 다른 호스트에 전달하지 않는다. 원격 응답을 검증하고 원본 오류·토큰·비공개 원고를 공개 응답이나 로그에 노출하지 않는다.
- 필요한 설정은 루트 `.env`·`.env.example`에서 관리하고 필요한 프로세스에만 전달한다. 새 라이브러리·큐·별도 게이트웨이를 연동만을 위해 선제 도입하지 않는다.

## 3. 콘텐츠 → Core 인증

기존 [CoreAuthClient](../../backend/content-service/src/main/kotlin/ai/storyfork/content/auth/client/CoreAuthClient.kt)의 Spring HTTP Service Client(`@HttpExchange`)를 실제 HTTP proxy Bean으로 연결한다. Feign이나 별도 인증 구현으로 교체하지 않는다.

| 항목 | 계약 |
|---|---|
| 구현 endpoint | `POST /internal/v1/auth/verify` — Core 내부 전용, 공개 proxy 미등록 |
| 사용자 인증 입력 | 원 요청의 `Authorization: Bearer …`. 본문 사용자 ID는 인증 근거로 사용하지 않음 |
| 최소 성공 응답 | `VerifiedMemberResponse(memberId: UUID)` |
| Core 책임 | 기존 인증·세션 정책으로 유효한 인증 주체를 판단. 세션 폐기 반영 범위도 기존 정책과 맞춤 |
| 콘텐츠 책임 | 보호 요청의 인증 경계에서 확인 후 Principal 구성. 업무 Service에서 작품·세계관·회차·Fork 권한 검사 |
| 호출 서비스 인증 | 별도 `X-Content-Service-Token`; `CONTENT_CORE_AUTH_TOKEN`은 32자 이상·개행 없음, Core 상수 시간 비교. 루트 예시는 빈 값, Core/Content만 주입 |
| 공개 범위 | 내부 검증 endpoint는 공개 nginx 경로에 노출하지 않음. 내부 접근도 서비스 인증을 생략하지 않음 |
| 인증 실패 | Core가 사용자 인증 무효를 확인한 경우 `401`. 콘텐츠 권한 거부·리소스 비공개 응답은 기존 정책 유지 |
| 연동 장애 | 연결/상대 503 → 503 `CORE_AUTH_UNAVAILABLE`, timeout → 504 `CORE_AUTH_TIMEOUT`, 기타 상대 오류 → 502 `CORE_AUTH_UPSTREAM_ERROR`, 빈/잘못된 응답·redirect → 502 `CORE_AUTH_INVALID_RESPONSE`. 사용자 무효만 401 `UNAUTHORIZED` |
| 제한시간/세션 | 기본 Core origin `http://127.0.0.1:8080`, connect/read `1s`/`3s`. 기존 access JWT의 세션 폐기 즉시 전파는 보장하지 않음 |

작가 닉네임 일괄 조회(`POST /internal/v1/members/nicknames`, [독서 관리 계약](reading-management-contract.md))는 같은 서비스 자격·Core origin·제한시간을 쓰지만 사용자 Bearer 없이 `X-Content-Service-Token`만 보내며, 실패는 위 분류와 달리 모두 503이다(재시도·캐시·임의 이름 대체 없음).

인증 필수 요청마다 확인하며 인증 캐시·자동 재시도는 없다. 공개 조회는 GET만 익명 허용한다. 장애를 임의 회원·개발 사용자·성공 응답으로 대체하지 않는다. Core 회원 DB·비밀번호·세션·JWT 서명 비밀을 콘텐츠에 복제하지 않는다. 실제 보안·HTTP proxy·장애 검증 소스는 hosted CI에 두고 실제 성공 확인 전에는 검증 대기로 보고한다.

로그인·refresh·로그아웃은 Core가 계속 담당한다. 콘텐츠 라우팅으로 옮겨도 기존 변경 요청의 CSRF 보호를 유지한다. Core 보안 설정을 통째로 복사하지 않고 콘텐츠가 받아야 하는 인증·CSRF 경계를 명시한다.

## 4. 기타 서비스 계약

| 연결 | 책임과 보존 조건 |
|---|---|
| 콘텐츠 → Core 회원 조회 | 안정적인 회원 UUID로 필요한 공개 표시 정보만 조회. 목록은 가능한 경우 일괄 조회하여 항목별 호출을 피함. 조회용 사본은 회원 정본이 아님 |
| 콘텐츠 → AI | 기존 생성 계약과 Client를 우선 재사용. 대상·기준 버전·허용 문맥만 전달하고 AI 실패를 임의 생성으로 숨기지 않음. 채택·충돌 검사·저장·발행은 콘텐츠 책임 |
| 콘텐츠 → Core 크레딧 | 실제 정산 연계 시 작업 ID·부담 주체·사용량·결과와 중복 방지·실패/환원 계약을 확정. 원장을 직접 수정하지 않음 |
| 콘텐츠 → Core 알림 | 콘텐츠 사건·대상 참조를 전달하고 Core가 수신자·수신 설정·알림함·전달을 관리. 실제 연계 전에 사건 종류·수신 규칙·중복 처리를 확정 |
| 운영 → 콘텐츠 | 허용된 조회·제한 적용/해제 요청만 수신. 콘텐츠가 실제 접근·발행 제한 적용과 결과를 소유. 다른 활성 제한을 무시해 복구하지 않음 |

아직 없는 업무 endpoint·DTO·큐를 이 문서만으로 선제 구현하지 않는다. 각 기능 이전 시 실제 호출 방향·경로·메서드·입출력·인증·실패·멱등성을 짧게 확정하고 양쪽 계약 테스트를 함께 갱신한다.

## 5. DB·Flyway·이전 순서

1. 기존 같은 물리 DB 대상·계정을 재사용한다. 새 DB·데이터 복사·별도 WorldStudio pool은 만들지 않는다. Core는 Auth, Content는 콘텐츠/첨부/WorldStudio migration과 writer를 소유하며 다른 서비스 Entity·Repository를 스캔하지 않는다.
2. Content 초기 스키마는 사용자가 승인한 개발용 fresh 기준이다. `db/migration/work` V1 → `episode` V2 → `world` V3 → `episode_version` V4 → `publication` V5 → `fork` V6 → `proposal` V7 → `work` V8 view → `episode` V9 view 순서다. 명시 7개 leaf와 단일 `content_schema_history`에서 전역 버전·FK 순서를 보장한다. root 직하 SQL 및 `db/migration/content` 폴더는 없으며 JSONB `content_work`·V5 importer·전용 legacy runtime 모델/Repository도 제거했다.
3. 과거 Content checksum/이력은 새 소스와 호환되지 않으며 자동 repair/clean하지 않는다. 실제 재초기화 대상은 아직 지정되지 않았다. 담당자는 정확한 개발 DB·보존 범위·백업/복구·중단 시간·동일 revision 이미지를 별도로 승인해야 한다. 같은 DB라는 이유로 Auth·WorldStudio·첨부 데이터/이력을 일괄 삭제하지 않는다. Auth 3개 SQL과 첨부/독립 WorldStudio SQL은 원본 바이트·이력을 유지한다.
4. Content는 명시 기능 Entity/Repository와 `contentTransactionManager`를 사용한다. WorldStudio는 같은 `contentDataSource`와 studio-only EntityManager/TransactionManager로 서버 시작 `validate`만 하며 V1은 명시 명령으로 실행한다. credential-free member 참조는 인증 정본이 아니다.
5. nginx/Vite는 기존 두 works 경로만 Content로 라우팅하고 나머지 API는 Core로 보낸다. Core 코드/테스트·Flyway·첨부 의존성을 제거하고 Content Dockerfile·Compose·게시 이미지·CI 소비자/통합 분류를 연결했다. Compose는 Core Health 이후 Content를 시작한다.
6. CD 배포는 `DEVELOP_CD_ENABLED`와 `CONTENT_FRESH_SCHEMA_APPROVED`가 모두 true여야 한다. 이 변수는 실제 DB 준비를 대신하지 않는다. 같은 revision 이미지 확인 → web/구 Core/Content writer 중지 → 선택 WorldStudio migration → 새 앱 기동 순서다. 실패하면 ingress를 멈춘 채 자동 rollback/repair하지 않으며 호환되는 스냅샷·바이너리 복구는 담당자가 결정한다. 이 작업은 실제 게시·배포·DB 변경을 실행하지 않는다. _(과거 기록: 활성화·승인 변수와 별도 Studio migration은 삭제됐고, 지금은 develop CI 성공 시 항상 배포하며 Studio schema는 Content 시작 시 적용한다.)_

서비스 간 HTTP 호출은 단일 DB 트랜잭션으로 묶이지 않는다. 변경 요청의 응답 유실은 미처리를 뜻하지 않으므로 작업 ID·멱등성·처리 상태 조회·필요한 보상으로 복구한다. 원격 호출 동안 DB 잠금을 유지하지 않도록 기존 원자성과 기준 버전 검증을 함께 설계한다.

## 6. 검증·완료 기준

- 동작 변경은 기존 테스트 환경에서 선택 단위 회귀를 먼저 실패시킨 뒤 최소 구현한다. 권한·인증 장애·중복 처리·기준 버전·데이터 보존을 생략하지 않는다.
- 로컬은 직접 영향받는 순수 단위 테스트와 설정/계약 검사만 수행한다. DB·HTTP 통합·시스템·전체 빌드·컨테이너 실행은 hosted CI, 브라우저·배포는 별도 승인 범위다.
- 기존 API와 이전 후 API의 계약·인가·Flyway/데이터·동시 편집 보존을 CI에서 검증한다. HTTP 시스템 성공을 브라우저 E2E 성공으로 표현하지 않는다.
- 기능표는 동작별 이전 범위와 근거 PR을 기록한다. 병합과 최신 head Required CI 성공을 실제 확인하기 전 완료 체크를 올리지 않는다. 코드 이동·데이터 이전·배포 완료를 각각 구분한다.

참고: [서비스 책임](service-boundaries.md), [콘텐츠 실행·클라이언트 현황](../../backend/content-service/README.md), [Core 구현 지침](../../backend/core-api/AGENTS.md).
