# STORYFORK 4개 백엔드 서비스 책임·실행 구조

[메인 README](../../README.md) · [문서 목록](../README.md)

> **상태: Core → Content 추출 소스 구현, hosted CI·실제 DB 전환·배포 대기.** DEC-41에 따라 기존 콘텐츠·첨부·WorldStudio 코드/테스트와 인증 연동·공개 라우팅·이미지/CI 설정을 `backend/content-service`로 이전했다. Core에는 Auth·Health가 남고 운영은 골격 그대로다. 물리 DB는 기존 대상을 공유하며 writer/migration만 분리한다. 사용자가 승인한 개발용 Content fresh 이력 재작성과 실제 DB 폐기는 구분한다. [이관·서비스 연동 계약](content-service-migration-contract.md)을 따른다.

## 1. 서비스 구성과 데이터 소유

| 서비스 | 기술·실행 방향 | 담당 기능 | 소유하는 정본 |
|---|---|---|---|
| Core 서비스 | 기존 `backend/core-api`, Kotlin·Spring Boot 재사용 | 회원·인증·세션·크레딧·정산·회원 알림함·수신 설정·전달 처리 | 회원·인증·세션·크레딧 원장·사용자 알림 |
| 콘텐츠 서비스 | 독립 Kotlin·Spring Boot 앱 `backend/content-service` | 작품·세계관·설정·인물·관계·회차·원고·플롯·버전·체크포인트·Fork·발행·독서·검색·랭킹·큐레이션·댓글·작품 피드백·수정 제안·콘텐츠 파일 참조 | 콘텐츠·소유권·이용 조건·발행 상태·버전·독서 기록·댓글·제보·제안 반영 결과·파일 참조 |
| 운영 관리 서비스 | 독립 Kotlin·Spring Boot 골격 `backend/operations-service` | 고객지원·공지·이벤트·권리/유해 신고 사건·증거·소명·운영 결정·운영 권한·감사·작업 감시·LLMOps 관리 | 문의·답변·공지·이벤트·신고 사건·운영 판단·조치 요청/결과·감사·관측 기록 |
| AI 서비스 | 기존 `backend/ai-service`, Python·FastAPI 재사용 | 집필·추출·시뮬레이션·검토·캐릭터 응답·이미지 생성·유해 판정 등 요청된 모델 실행 | 필요한 실행 상태. 콘텐츠·회원·정산·운영 판단 정본을 직접 변경하지 않음 |

표의 담당 기능은 목표 책임이며 전부 구현됐다는 뜻이 아니다. 현재 Core는 Auth·Health, Content는 이전된 콘텐츠·첨부·WorldStudio를 구현하며 운영은 골격뿐이다. Core/Content/운영 기본 포트는 8080/8081/8082이고 독립 Gradle main·패키지를 가진다. Frontend와 향후 Android/iOS 앱은 클라이언트다. 모바일 실제 지원과 미구현 업무는 후속 대상이며 역할마다 AI 서버를 만들거나 검색·파일·랭킹마다 별도 서버를 선제 생성하지 않는다. 작품 검색·실시간 랭킹은 Content 안에서 [검색·랭킹 계약](work-search-ranking-contract.md)을 따른다.

## 2. 책임 경계

- **인증과 콘텐츠 인가:** Core가 회원·인증을 소유한다. Content는 보호 요청마다 별도 서비스 자격과 사용자 Bearer로 Core `POST /internal/v1/auth/verify`를 호출하고 검증된 회원 UUID에 대해 작품 소유권·공개·회차·Fork 범위를 판단한다. 인증 캐시·재시도·fallback·JWT 서명 키 공유는 없다. Core 장애는 사용자 무효 401과 구분한다. 기존 access JWT의 즉시 세션 폐기 전파는 보장하지 않는다. 운영 인증·권한(회원·관리자·신고 MVP)은 [운영 회원·관리자·신고 계약](operations-member-report-contract.md)을 따른다. 공지 관리·독자 공지 조회는 [운영 공지 계약](operations-notice-contract.md)을, 이벤트 관리자 CRUD·독자 조회는 [운영 이벤트 계약](operations-event-contract.md)을 따른다.
- **AI 작업:** 콘텐츠 요청의 대상·기준 버전·허용 문맥·사용자 채택·저장은 콘텐츠 서비스 책임이다. AI는 제안·사용량·실행 결과를 반환한다. 생성과 승인·정본 반영·발행을 구분한다. 운영 목적의 AI 검사·평가는 운영 관리 서비스가 소유하는 작업으로 구분한다.
- **크레딧:** Core만 지급·차감·복구·잔액·정산을 확정한다. 콘텐츠/AI/운영 서비스는 작업 ID·부담 주체·실제 결과·사용량 등 합의된 정보를 전달한다. 이벤트 보상도 운영 서비스가 원장을 직접 수정하지 않고 Core에 요청한다. 과금 미정 정책을 이 분리 결정으로 확정하지 않는다.
- **회원 운영:** 운영 서비스는 회원 조회·이용 제한 요청·사유·감사를 관리한다. 실제 계정·세션 제한 적용은 Core 책임이다. 비밀번호·토큰·인증 비밀을 운영 서비스에 복제하지 않는다.
- **콘텐츠 운영:** 신고·소명·운영 판단은 운영 서비스, 작품·회차·Fork의 실제 제한 적용/해제와 열람·발행 차단은 콘텐츠 서비스 책임이다. 신고 결정 저장과 실제 적용 성공을 구분한다. 다른 활성 제한이 있으면 무조건 복구하지 않는다.
- **피드백 구분:** 작품의 오류·질문·제안·작가 검토는 콘텐츠 서비스다. 플랫폼 고객지원 문의와 권리·유해 신고 사건은 운영 서비스다.
- **알림:** 업무 소유 서비스가 사건·대상 참조를 제공하고 Core가 수신자·설정·알림함·읽음·삭제·전달을 관리한다. 기존 #89의 RabbitMQ/SSE/SNS 방향은 활용하되 새 발행 서비스 간 사건·수신 규칙과 전달 계약은 후속 조율한다. 신규 서버 구현 완료를 뜻하지 않는다.
- **정기 작업:** 실제 실행·중복 방지·트랜잭션·복구는 업무 소유 서비스에 둔다. 예약 발행·자율 연재 일정은 콘텐츠, 크레딧 소멸·탈퇴는 Core, LLM 평가·운영 기록 관리는 운영이다. 운영 서비스는 실행 현황·실패·지연·재실행 요청을 관리한다. 모든 서비스를 묶는 중앙 스케줄러나 별도 worker를 이 결정만으로 추가하지 않는다.
- **LLMOps:** 업무 분류는 운영 영역으로 분리한다. Langfuse는 도입 시 자체 제품을 별도 배포하는 방향이며 Spring Boot로 재구현하지 않는다. Langfuse 자체 UI 사용과 우리 운영 화면의 API 통합 중 어느 방식을 택할지는 미정이다. 평가 실행 위치·AI 런타임의 버전 적용·저장 책임은 연동 계약에서 정한다. 운영 API의 전체 LLMOps 기능 구현을 필수로 확정하지 않으며, 제품 설치·테이블 직접 수정·원고 전문 전송을 승인하지 않는다.

## 3. 호출·진입 구조

```text
Web / 모바일 클라이언트
    ↓ 단일 공개 진입점(기존 nginx 확장 후보)
    ├─ Core 서비스: 회원·인증·크레딧·알림
    ├─ 콘텐츠 서비스: 작품·세계관·회차·Fork·독서
    │      ├─ Core: 공통 사용자 업무·정산·알림 사건
    │      └─ AI 서비스: 허용 문맥 기반 생성·검토
    └─ 운영 관리 서비스: 문의·공지·신고·LLMOps
           ├─ Core: 회원 제한·보상·알림 사건
           ├─ 콘텐츠: 콘텐츠 제한·허용된 운영 조회
           └─ AI 서비스: 필요한 운영 검사·평가
```

그림의 정산·알림·운영 호출은 목표 흐름이다. 현재 nginx/Vite는 `/api/v1/works`·`/api/v1/public/works`·`/api/v1/world-studios`의 exact·하위 경로를 Content로 보내며 나머지 `/api`는 Core로 보낸다. Core 인증 확인과 Content → AI 생성은 동기 HTTP다. 내부 인증 endpoint는 공개 proxy에 등록하지 않는다. Core를 중앙 콘텐츠 프록시로 만들거나 별도 게이트웨이를 추가하지 않는다. 브라우저는 내부 AI·DB·모델 API를 직접 호출하지 않으며 기존 공개 URL·쿠키·CSRF·응답 계약을 유지한다.

## 4. DB·트랜잭션·실패 경계

- 현재 전환은 **기존 같은 PostgreSQL 대상·계정 + 서비스별 writer/migration 소유 분리**다. 새 DB·데이터 복사·별도 WorldStudio pool은 추가하지 않는다. 운영 서비스의 저장 배치는 후속 대상이다.
- 각 서비스는 자기 테이블만 쓰고 자기 Flyway migration·이력을 소유한다. 다른 서비스 DB를 직접 UPDATE하거나 교차 소유 JPA Entity/트랜잭션에 의존하지 않는다. 공유 DB 사용은 분산 호출의 원자성을 보장하지 않는다.
- 사용자가 개발용 Content fresh 이력 재작성을 승인했다. Content는 7개 업무 leaf의 전역 V1~V9/`content_schema_history`를 사용하며 통합 `db/migration/content`와 legacy importer를 제거했다. 과거 Content 이력과 호환되지 않는다. Auth·첨부·독립 WorldStudio SQL 바이트/이력은 유지한다. 정확한 대상·보존 범위·복구·중단 시간을 승인하기 전 실제 DB/volume 삭제나 자동 repair/clean은 하지 않는다.
- 운영 결정 → 제한 적용, AI 결과 → 크레딧 정산, 업무 성공 → 알림 전달은 서비스 간 부분 실패가 가능하다. 안정적인 작업/사건 ID·멱등성·대기/실패 상태·재시도·복구 계약을 정한다. 일반 `@Transactional`이 HTTP 상대 서비스까지 롤백한다고 표현하지 않는다.
- PostgreSQL 원문·기존 인물/설정/원고 버전, 설정 기본 비공개와 Fork 추종/독립 목표는 유지한다. #132 최신 결정의 관계만 MVP 예외로 Neo4j 현재 상태 하나를 정본으로 둔다. PG에는 UUID·CAS/요청 메타데이터만 보관하고 관계 내용·이력을 이중 저장하지 않는다. PG prepare → Neo4j CAS → PG finalization의 미완료/재시도 계약이며 관계 과거 조회·전체 restore는 미지원이다. 기존 SQL·데이터와 관계 없는 버전 기능은 보존하고 실제 이관·운영 복구/백업은 별도 대기다([현재 계약](worldstudio-independent-schema.md#현재-관계-mvp-계약--132)).

## 5. Starter·실행 기반

| 항목 | 방향 |
|---|---|
| Core 앱 | 기존 core-api의 Auth·Health 유지, 콘텐츠 writer·migration·첨부 의존성 제거 |
| 콘텐츠·운영 앱 | 각각 독립 Spring Boot main·설정·Gradle. Content는 실제 업무 이전, 운영은 기존 골격 유지 |
| AI·Frontend | 기존 앱 재사용 |
| 전체 기동 | Compose에 Content 이미지/8081 추가, Core Health 이후 시작. native는 서비스별 기본 명령 사용 |
| 별도 Start 서버 | 만들지 않음. 전체 기동은 실행 도구의 책임 |
| 공통 starter 라이브러리 | 선제 도입하지 않음. 인증·DTO·DB 코드를 복제하거나 범용 프레임워크를 만들지 않음 |
| 환경설정 | 루트 `.env` 한 곳, 루트 `.env.example`만 공유. 각 프로세스에 필요한 값만 전달. 실제 `.env`·키 보존 |
| CI/CD | 서비스별 변경 영향·소비 계약·설정·HTTP 시스템 범위와 이미지/배포 대상을 확장. 실제 실행 전 통과·배포 완료 주장 금지 |

## 6. 적용 순서와 미정 계약

1. 기존 업무·테스트·공개 계약을 Content로 추출하고 중복 패키지·legacy importer를 제거했다. Auth·Health는 Core, 운영은 골격 그대로다.
2. 인증 확인·라우팅·같은 DB의 migration 소유·Content 이미지·CI 선택/통합/HTTP 시스템 검증 소스를 연결했다. fresh Content 초기화와 기존 이력 거부는 hosted CI 대상이다.
3. 로컬은 선택 순수 단위·구문/계약 검사만 수행한다. 최신 head `Required CI` 성공 확인, 실제 대상 DB 준비, writer 전환·배포 검증은 남아 있다.
4. CD는 `DEVELOP_CD_ENABLED`·`CONTENT_FRESH_SCHEMA_APPROVED`가 모두 true일 때 같은 revision 확인 → 공개 ingress/구 writer 중지 → 선택 Studio migration → 새 앱 기동으로 진행한다. 실패 시 자동 rollback/repair하지 않는다. 이 문서는 실제 실행 승인이 아니다. _(과거 기록: 활성화·승인 변수와 별도 Studio migration은 삭제됐고, 지금은 develop CI 성공 시 항상 배포하며 Studio schema는 Content 시작 시 적용한다.)_
5. 기능표 ✅는 병합·최신 Required CI 근거를 따르며 소스 이동·데이터 전환·운영 배포 완료를 서로 구분한다. 브라우저는 별도 승인 대상이다.

미정/대기: 실제 재초기화 대상·보존/복구 범위·중단 시간·운영 DB 권한, 정산/알림/운영 연계의 계약 버전·timeout/재시도/보상·권한 모델, 모바일 지원·운영 리소스 구성. 기존 Draft #86·#91은 자동 채택하지 않는다.

## 참고

- [개발 기능표](../feature-roadmap.md)
- [결정 기록](decisions.md#dec-41-4개-백엔드-서비스-분리)
- [현재 실행 아키텍처](../architecture.md)
- [공통 지침](../../AGENTS.md)
