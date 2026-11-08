# 개인 브랜치 콘텐츠 통합

[메인 README](../README.md) · [문서 목록](README.md)

> **현재 상태:** 콘텐츠·첨부·WorldStudio 실행 코드/테스트는 Content로 추출했고 기존 works URL·Bearer/CSRF는 유지한다. Core 내부 검증은 별도 서비스 자격과 JWT로 UUID만 반환한다. Content fresh SQL 재작성은 기존 이력과 비호환이며 실제 DB 폐기/전환은 실행하지 않았다. 현재 실행 지침은 [Content 안내](../backend/content-service/README.md)와 [이관 계약](design/content-service-migration-contract.md)이다. **아래 Core 소유·이전 경로·설정·검증 기록은 분리 전 역사적 설명이며 현재 실행 명령이나 이번 CI 통과 근거가 아니다.**

`/content` 작업실은 기존 React DI·MVVM에서 Kotlin Core 공개 API를 호출한다. Core가 PostgreSQL 정본과 권한·버전·발행을 관리하고 AI Service에 선택적 생성을 요청한다. Auth 통합 후 비공개 콘텐츠 요청은 기존 메모리 Bearer와 변경 요청의 CSRF를 재사용한다. 다른 목업 업무 화면은 실제 저장 API로 전환하지 않았다.

## 구현 범위

- 작품 생성, 원고 저장·체크포인트, 저장본 선택 발행, 공개 작품 조회.
- 설정 항목별 초안 자동 저장·확정·이전 버전 복원, 공개 여부·회차 범위·인물 지식 필터.
- 원작의 공개 회차에서 Fork 생성, 기준 회차·버전 보존, 설정 최초 수정 전 추적 및 수정 후 독립, 원본 변경 반영·거절.
- 회차별 문맥 미리보기, AI 제안과 원고 반영 분리, 실제 제공사 모델·응답 ID·사용량 기록. 원고나 설정이 바뀐 제안은 적용 시 409로 거절한다.

세계관 자동 추출, 그래프 DB, 이미지 저장, 로그인 구현, 크레딧 차감·결제, 운영 신고·탈퇴 기능은 이 변경에 포함하지 않는다. 첫 JSONB aggregate 저장은 최신 ERD의 현재 기능 관계로 이식했다. [ERD 대응·마이그레이션 안내](content-erd-migration.md)를 참고한다. 팀 전체 143개 기능 테이블을 완성했다는 뜻은 아니다.

## React 적용 경로

`App.tsx`의 `/content` → `EpisodePage`/`WorldPanel` → ViewModel → `EpisodeUseCase` → `EpisodeRepository` → `HttpEpisodeRepository` 순서다. 기존 `appContainer`에 등록하며 HTTP·Zod 검증은 Data 계층에 있다. 도서관에서 서버 집필 작업실 링크로 진입한다. 원고·설정집·공개 조회의 정본은 브라우저 저장소가 아닌 Core 응답이다.

공개 API는 `/api/v1/works` 아래 작품·draft·history·policy·publish·forks·world·settings·context·proposals를 제공한다. 공개 독자 조회는 `/api/v1/public/works` 아래에 있고 초안은 반환하지 않는다. 구체적인 요청 DTO와 HTTP 메서드는 [이전된 작품 Controller](../backend/content-service/src/main/kotlin/ai/storyfork/content/work/controller/WorkController.kt)와 [이전된 회차 Controller](../backend/content-service/src/main/kotlin/ai/storyfork/content/episode/controller/EpisodeController.kt)에 있다.

## 인증과 실행

비공개 `/api/v1/works` API는 Auth가 검증한 JWT의 servlet `Principal.name`(회원 UUID)을 작성자로 사용한다. 클라이언트 사용자 ID 헤더·데모 역할·`CONTENT_DEV_OWNER`로 SecurityFilterChain을 우회할 수 없다. 모든 변경 요청에는 CSRF가 필요하고 공개 `/api/v1/public/works` 조회는 GET만 익명으로 허용한다.

설정은 루트 `.env.example`을 참고해 루트 `.env`에서 관리한다. 실제 `.env`를 덮어쓰거나 서비스별 파일을 만들지 않는다. 기본 `CONTENT_ENABLED=false`에서도 기존 Health·Auth 실행을 유지한다. 활성화 시 PostgreSQL JDBC URL·사용자·비밀번호와 양 서비스의 동일한 `INTERNAL_TOKEN`이 필요하다. `OPENAI_API_KEY`와 `OPENAI_MODEL`은 AI 런타임에만 전달한다. 공용 실행 설정에는 모델 기본값이 없다. 생성을 사용하려면 사용 가능한 `OPENAI_MODEL`과 키를 명시해야 하며, 누락하면 생성 API는 503으로 실패한다. 팀 CD의 별도 모델 설정은 팀 전체 모델 선정 결정이나 실제 런타임 검증을 뜻하지 않는다.

다음 실행 안내는 현재 Content 분리 구성이다. 별도 콘텐츠 overlay 없이 공통 base에서 `CONTENT_ENABLED`를 전달한다. 루트 `.env`에 필수 DB·JWT 자격과 `CONTENT_ENABLED=true`, Core↔Content의 `CONTENT_CORE_AUTH_TOKEN`, Content↔AI의 `INTERNAL_TOKEN`을 준비한 뒤 저장소 루트에서 실행한다:

```bash
docker compose up -d --build
```

루트 `compose.yaml`이 base + `infrastructure/docker-compose.local.yaml`을 선택하고 루트 `.env`를 자동으로 읽는다. web·Core·Content·AI 네 앱을 runtime Dockerfile로 빌드하며 HMR은 아니다. local의 새 프로젝트·DB volume은 기존 `storyfork-dev`나 배포 데이터를 재사용하지 않는다. Core·Content는 같은 내부 PostgreSQL과 `DATABASE_USER`/`DATABASE_PASSWORD`를 사용하고 SMTP는 내부 Mailpit으로 연결한다. 별도 `CONTENT_DATABASE_*` 예시는 네이티브 실행용이다. Auth·Content migration 이력은 분리한다. web 5173·Core 8080·Content 8081·DB 5432·Mailpit 1025/8025는 기본 loopback 바인딩이고 AI는 내부 전용이다.

개발 서버의 base + `infrastructure/docker-compose.dev.yaml`은 게시된 네 `:develop` 앱 이미지와 내부 PostgreSQL·Mailpit을 사용한다. local과 같은 DB·메일 구조지만 별도 프로젝트·volume이며 기존 `CD_WEB_PORT` loopback 바인딩만 호스트에 노출한다. 앱 소스 build·hot reload는 아니다. 기존 외부·공유 DB 전환과 데이터 이관은 실행하지 않았고 개발 CD에는 별도 내부 DB 전환 승인이 필요하다.

운영 준비용 base + `infrastructure/docker-compose.prod.yaml`만 `:main` 앱 이미지·외부 PostgreSQL/SMTP·local과 같은 이름의 필수 입력·항상 Secure인 쿠키를 사용한다. 현재 게시 workflow는 develop 전용이므로 main 가용성·게시·배포는 확인되지 않았다. TLS/ingress 제공이나 운영 준비 완료가 아니며, 기본 Auth V4의 공개 비밀번호 샘플 회원은 운영 전 별도 보안 판단 대상이다. 이번 설정 변경은 기존 migration을 수정하지 않는다. 세부 환경·포트·승인 경계는 [인프라 안내](../infrastructure/README.md)를 따른다.

세 조합 모두 콘텐츠는 기본 비활성이고, 개발 작성자를 주입하지 않으며 실제 로그인 JWT가 필요하다. 빈 내부 토큰은 인증 성공으로 대체하지 않는다. Compose 구문 검사 자체는 실제 토큰 유효성을 검증하지 않으며, 토큰 누락 시 생성 요청은 기존 구현대로 실패한다.

## 문맥과 저장 한계

원문은 저장 시 잘라내지 않는다(회차 원고 입력 한도 40,000자). AI 문맥에는 기준 회차까지의 최근 3개 회차에서 질의 관련 단락과 말미를 발췌한다. 각 발췌는 UTF-16 위치와 출처 회차를 유지하고 생략 문자 수를 표시한다. 회차당 최대 10,000자, 전체 보수적 예산 48,000자 및 직렬화 결과 60,000자 검사를 사용한다. 전체 장편을 모델이 읽었다거나 발췌가 의미 요약이라는 뜻은 아니다.

공개·인물 문맥에는 비공개 설정과 미발행 원고를 포함하지 않는다. 작가 문맥은 소유자에게 허용된 설정과 작성 원고를 포함한다. AI 제안은 자동 발행하지 않는다. 제공사 실패는 503으로 드러내며 임의 생성 결과로 대체하지 않는다.

현재 콘텐츠 저장은 JPA를 사용하며 관련 작품·원작 행의 `PESSIMISTIC_WRITE`를 정렬된 순서로 획득한 뒤 revision을 검사한다. Auth는 기존 JDBC를 유지한다. 다중 작가의 운영 처리량은 검증하지 않았다. 목록 페이지네이션·aggregate 크기·버전 누적량은 운영 전 측정 및 보완 대상이다.

## 검증 기록 — 2026-11-02

- Core 전체 61개 통과: 별도 PostgreSQL 테스트 DB에서 권한, 충돌, 공개 초안 제외, Fork 승계·독립·변경 선택, AI 제안 적용 검증 포함.
- AI 4개 통과: 내부 인증, 문맥 한도, 모델 응답 메타데이터, 설정 실패. 유료 호출 없이 SDK 대역 사용.
- 변경 Frontend 테스트 14개 및 타입 검사 통과. 전체 실행은 245개 중 기존 두 파일의 5개 실패가 있었고 해당 두 파일 단독 실행은 45개 통과했다. 전체 실행 성공으로 기록하지 않는다.
- 환경 allowlist 테스트 1개와 개발·이미지 Compose overlay 구문/비밀값 분리 검사 통과. Docker engine 전체 기동은 미검증.
- 최종 Frontend production build·변경 경로 oxlint·`git diff HEAD --check` 통과. 714 KB JS chunk 경고는 남아 있다. Graphify AST 갱신은 2,712 nodes·6,547 edges이며 SQL extractor 의존성 누락과 문서 의미 분석 한계가 있다.
- 로컬 `/content`에서 생성→원고 저장→설정 확정→문맥→테스트 AI 제안→명시적 적용→공개→Fork를 일반 브라우저로 확인했다. 이는 Aside 검증을 대체하지 않는다. 테스트 응답 모델은 `test-stub-not-openai`이며 이번 이식에서 유료 Terra 호출은 하지 않았다.
- 1~3화 78,386자를 별도 테스트 DB에 저장한 후 문맥 JSON 15,824자와 생략 문자 수를 확인했다. 원고 파일과 개인 증거는 Git에 포함하지 않는다.
- 분기 설정 초안은 화면 재접속 후 유지됐으며 확정 후 설정 버전 2개를 확인했다. 로컬 증거는 시제품 `evidence/team-fork-settings.jpg`와 `evidence/branch-context-result.json`에 있다. 테스트 AI 대역은 확인 후 종료했다.
- `ponytail-review`: 인증 오류 표시, 공개 조회 DTO, Domain repository 위치, 개발 프록시 외부 노출을 점검·수정했다. JSONB 저장·초기 직렬 잠금은 한계를 명시하고 유지했다. 다중 사용자 부하와 실제 인증 공급자는 미검증이다.
- Aside CLI 공식 서명 확인 및 `aside guide`·`aside guide repl` 읽기 완료. Windows installer의 current junction 실행 실패로 검증한 버전 실행 경로를 사용자 PATH에 등록했다. 브라우저 본체가 없어 E2E 연결 불가이며 승인된 공식 브라우저 다운로드·실행 명령도 자동 승인 검토에서 정책상 차단됐다. **사용자 요청대로 Aside E2E 전 검증 완료 처리 금지.**
- 최신 커밋의 Required CI는 아직 실행·확인하지 않았다. 로컬 결과로 CI 성공을 대신하지 않는다.

## 남은 수용 확인

2026-11-02 사용자 요청으로 디스크 용량 문제에 따른 Aside 설치·실행을 다음 단계로 보류하고 나머지 작업을 진행한다. Aside 검증 면제나 통과로 기록하지 않으며 추가 설치·다운로드는 중단한다.

보류 후 확인: C 드라이브 여유 약 0.45 GB, Core·AI Health 정상 응답. 기존 설치된 Vitest로 전체 순차 실행을 시도했으나 `scrollTo` 경고 반복 및 진행 정체로 중단했다. 이전 실패 파일 `index-html.test.js`·`App.reading.test.tsx`만 다시 실행한 결과 45개 모두 통과했다(20.59초). 전체 성공이나 CI 성공으로 해석하지 않는다. 기존 사용자 파일·캐시·DB는 용량 확보 목적으로 삭제하지 않았다.

Aside를 사용할 수 있을 때 정상 흐름, 실패 경로, 재접속 저장 유지, 모바일·키보드 조작을 확인한다. 실제 Principal 제공자 연결과 Docker 기동을 별도로 확인하고, 유료 생성 추가 검증은 별도 승인 범위에서만 수행한다. 변경 전달 시 최신 커밋의 Required CI 결과를 확인한다.

후속 집필 작업의 기준은 [이슈 #50 대응](issue-50-alignment.md)입니다. `/content`에서 작품을 선택하고 회차별 집필실로 이동할 수 있습니다. 모든 발행 요청은 저장 버전 ID를 명시해야 합니다.


#84의 파일·책임·DTO·영속성 대응과 이번 검증 한계는 [콘텐츠 책임 분리](issue-84-content-boundaries.md)를 따른다. 아래 과거 날짜의 기록은 당시 결과이며 이번 JPA 전환의 통과 근거로 대신하지 않는다.
