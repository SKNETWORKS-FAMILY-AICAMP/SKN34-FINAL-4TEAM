# 개인 브랜치 콘텐츠 통합

`fullstack-content`의 `/content` 작업실은 기존 React DI·MVVM에서 Kotlin Core 공개 API를 호출한다. Core가 PostgreSQL 정본과 권한·버전·발행을 관리하고 AI Service에 선택적 생성을 요청한다. 기존 데모 로그인과 다른 목업 화면은 실제 인증·업무 API로 전환하지 않았다.

## 구현 범위

- 작품 생성, 원고 저장·체크포인트, 저장본 선택 발행, 공개 작품 조회.
- 설정 항목별 초안 자동 저장·확정·이전 버전 복원, 공개 여부·회차 범위·인물 지식 필터.
- 원작의 공개 회차에서 Fork 생성, 기준 회차·버전 보존, 설정 최초 수정 전 추적 및 수정 후 독립, 원본 변경 반영·거절.
- 회차별 문맥 미리보기, AI 제안과 원고 반영 분리, 실제 제공사 모델·응답 ID·사용량 기록. 원고나 설정이 바뀐 제안은 적용 시 409로 거절한다.

세계관 자동 추출, 그래프 DB, 이미지 저장, 로그인 구현, 크레딧 차감·결제, 운영 신고·탈퇴 기능은 이 변경에 포함하지 않는다. 첫 JSONB aggregate 저장은 최신 ERD의 현재 기능 관계로 이식했다. [ERD 대응·마이그레이션 안내](content-erd-migration.md)를 참고한다. 팀 전체 143개 기능 테이블을 완성했다는 뜻은 아니다.

## React 적용 경로

`App.tsx`의 `/content` → `EpisodePage`/`WorldPanel` → ViewModel → `EpisodeUseCase` → `EpisodeRepository` → `HttpEpisodeRepository` 순서다. 기존 `appContainer`에 등록하며 HTTP·Zod 검증은 Data 계층에 있다. 도서관에서 서버 집필 작업실 링크로 진입한다. 원고·설정집·공개 조회의 정본은 브라우저 저장소가 아닌 Core 응답이다.

공개 API는 `/api/v1/works` 아래 작품·draft·history·policy·publish·forks·world·settings·context·proposals를 제공한다. 공개 독자 조회는 `/api/v1/public/works` 아래에 있고 초안은 반환하지 않는다. 구체적인 요청 DTO와 HTTP 메서드는 [ContentController](../backend/core-api/src/main/kotlin/ai/storyfork/core/content/controller/ContentController.kt)에 있다.

## 인증과 실행

쓰기 API는 서버가 검증한 servlet `Principal.name`을 작성자로 사용한다. 클라이언트 사용자 ID 헤더나 데모 로그인은 인증 수단이 아니다. 인증 연결 전에는 401이 정상이다. 로컬 수동 확인에만 `CONTENT_DEV_OWNER`를 설정할 수 있고 loopback 요청에만 적용한다. 이때 Vite도 `127.0.0.1`에 바인딩한다. 개발 작성자를 공용 프록시·외부 서버에서 사용하지 않는다.

설정은 루트 `.env.example`을 참고해 루트 `.env`에서 관리한다. 실제 `.env`를 덮어쓰거나 서비스별 파일을 만들지 않는다. 기본 `CONTENT_ENABLED=false`에서는 기존 Health 기반 실행을 유지한다. 활성화 시 PostgreSQL JDBC URL·사용자·비밀번호와 양 서비스의 동일한 `INTERNAL_TOKEN`이 필요하다. `OPENAI_API_KEY`와 `OPENAI_MODEL`은 AI 런타임에만 전달한다. 모델 기본값은 이 개인 브랜치의 사용자 선택이며 팀 전체 모델 선정 결정이 아니다.

```bash
python3 infrastructure/scripts/run-native.py ai-service
python3 infrastructure/scripts/run-native.py core-api
python3 infrastructure/scripts/run-native.py web
```

각 서비스는 별도 터미널에서 실행한다. Core는 JDK 21, Frontend는 저장소 지정 Node/pnpm, AI는 uv 잠금파일을 사용한다.

선택적 Docker 저장소 overlay:

```bash
docker compose --env-file .env -f infrastructure/compose.yaml -f infrastructure/compose.content.yaml up --build
```

이미지 구성은 첫 파일을 `infrastructure/compose.prod.yaml`로 바꾼다. PostgreSQL은 전용 volume에 저장되고 호스트 포트를 열지 않는다. 컨테이너에는 개발 작성자를 주입하지 않으므로 실제 Principal 공급 전 쓰기는 401이다. 인증·TLS 없는 운영 배포 준비 완료를 의미하지 않는다.

## 문맥과 저장 한계

원문은 저장 시 잘라내지 않는다(회차 원고 입력 한도 40,000자). AI 문맥에는 기준 회차까지의 최근 3개 회차에서 질의 관련 단락과 말미를 발췌한다. 각 발췌는 UTF-16 위치와 출처 회차를 유지하고 생략 문자 수를 표시한다. 회차당 최대 10,000자, 전체 보수적 예산 48,000자 및 직렬화 결과 60,000자 검사를 사용한다. 전체 장편을 모델이 읽었다거나 발췌가 의미 요약이라는 뜻은 아니다.

공개·인물 문맥에는 비공개 설정과 미발행 원고를 포함하지 않는다. 작가 문맥은 소유자에게 허용된 설정과 작성 원고를 포함한다. AI 제안은 자동 발행하지 않는다. 제공사 실패는 503으로 드러내며 임의 생성 결과로 대체하지 않는다.

현재 저장 명령은 PostgreSQL advisory transaction lock으로 직렬화한다. 초기 작가 검증 규모의 무결성을 위한 선택이며 동시 다수 작가의 처리량은 검증하지 않았다. 목록 페이지네이션·aggregate 크기·버전 누적량은 운영 전 측정 및 보완 대상이다.

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
