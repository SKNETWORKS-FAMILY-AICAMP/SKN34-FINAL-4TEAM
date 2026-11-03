# STORYFORK Web

React·TypeScript·Vite·Tailwind CSS 기반의 개발 화면입니다.
작품·Fork·서재 등은 데모 데이터이며, 아래 인증·프로필·기기 관리 기능은 같은 출처의 실제 Core API를 호출합니다.
이메일 확인 전 자동 로그인하지 않으며 운영 약관은 미정입니다. 알 수 없는 UI 경로는 `/`로 이동합니다.

## 실행

Node **24.x**, pnpm **11.22.x** (`packageManager: pnpm@11.22.0`)가 필요합니다.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

네이티브 기본 주소는 `http://localhost:5173`, Core는 `http://localhost:8080`입니다.
직접 실행할 때는 공개 `VITE_CORE_API_BASE_URL` 등 필요한 변수만 터미널에 설정합니다. 루트 `.env`는 자동으로 읽지 않습니다.
루트 설정 자동 전달은 Compose를 사용하며 서비스별 `.env`는 만들지 않습니다.
`VITE_*`는 브라우저에 노출되므로 비밀값을 넣지 않습니다. 백엔드는 별도로 실행합니다.

루트의 [Compose 안내](../infrastructure/README.md)는 공통 `docker-compose.yaml`에 prod 또는 dev를 병합합니다.
prod는 소스에서 정적 배포 이미지를 빌드해 기본 `http://127.0.0.1:8088`로 검증하고, dev는 현재 개발 배포 서버에서 CI의 `:develop` 이미지를 pull·실행합니다.
두 조합 모두 web 이미지의 Nginx가 정적 화면과 `/api` → `core-api:8080` 프록시를 제공합니다. 소스/HMR Compose는 제거했으며 hot reload는 위 `pnpm dev`를 사용합니다.
loopback 검증용이며 인터넷 운영 준비를 뜻하지 않습니다.

## 실제 호출 흐름

`App → CoreApiConnectionStatus → useCoreApiHealth → DI 외부 함수 → Fetch·Zod → 공개 Core API`.

- Core: `GET /api/v1/health`, `storyfork-core-api`와 `up` 검증.
- AI: `GET /api/v1/health/ai-service`, `storyfork-ai-service`와 `up` 검증.
- AI 내부 주소나 OpenAI를 브라우저에서 직접 호출하지 않습니다.
- Health는 OpenAI 키·모델 접근 검증이 아닙니다.

인증·계정 기능은 View → ViewModel → UseCase → Repository → Core API 흐름으로 요청합니다.

| UI 경로·진입점 | 화면·동작 | Core endpoint |
|---|---|---|
| `/me/signup` | 가입 요청 → 이메일 확인 대기 (자동 로그인 없음) | `POST /api/v1/auth/signup` |
| `/auth/resend-verification`, 로그인·가입·인증 실패 화면의 안내 | 이메일 1항목으로 확인 메일 재발송 (계정 존재 여부를 구분하지 않는 안내) | `POST /api/v1/auth/resend-verification` |
| `/auth/verify-email#token=…` | 메일 링크의 이메일 확인 → 로그인 | `POST /api/v1/auth/verify-email` |
| `/login` | 이메일·비밀번호 로그인, Core가 반환한 사용자·권한 반영 | `POST /api/v1/auth/login` |
| 앱 시작 | HttpOnly refresh 쿠키를 통한 세션 복원 | `POST /api/v1/auth/refresh` |
| 상단 계정 메뉴 | 현재 기기 로그아웃 | `POST /api/v1/auth/logout` |
| `/me/profile` | 서버 프로필 조회·오류 재시도, 닉네임 저장 | `GET /api/v1/me`, `PATCH /api/v1/me` |
| `/me/profile`의 이메일 저장 | 새 주소로 확인 메일 요청, 확인 전 기존 이메일 유지 | `POST /api/v1/me/email-change` |
| `/auth/verify-email-change#token=…` | 이메일 변경 확인 → 프로필로 돌아가 새로 조회 또는 로그인 | `POST /api/v1/auth/verify-email-change` |
| `/auth/forgot-password`, 프로필의 계정 보안 | 비밀번호 재설정 메일 요청 (계정 존재 일반화) | `POST /api/v1/auth/forgot-password` |
| `/auth/reset-password#token=…` | 새 비밀번호 검증·저장 → 로그인, 만료 시 새 링크 요청 | `POST /api/v1/auth/reset-password` |
| `/me/profile`의 로그인 기기 | 기기 조회·오류 재시도·개별 연결 종료 | `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/{id}` |
| `/me/profile`의 모든 기기 로그아웃 | 서버 성공 후 현재 세션 해제 | `POST /api/v1/auth/logout-all` |

- 변경 요청 전에 `GET /api/v1/auth/csrf`로 CSRF 토큰을 받습니다. 인증 링크의 fragment는 읽은 즉시 주소에서 제거하며, 토큰을 로그나 브라우저 저장소에 남기지 않습니다.
- access token은 메모리에만 두고 refresh 쿠키는 Core가 HttpOnly로 관리합니다. 인증 변경은 기존 Web Locks와 계정 소유자 검증을 사용하고, 보호된 요청의 401은 세션 갱신 후 한 번만 재시도합니다.
- 가입·비밀번호 재설정은 공백뿐인 비밀번호를 거부하고 8자 이상·UTF-8 72바이트 이하를 확인합니다. 재설정 입력 오류는 해당 필드에 안내하며 입력을 보존하고, 완료되거나 만료된 토큰은 다시 제출하지 않습니다.
- 프로필·기기 조회는 화면 이탈·재시도 시 AbortController로 취소합니다. 로그인·가입의 늦은 응답은 화면 이탈 후 상태나 자동 이동을 덮어쓰지 않도록 무시합니다. 이미 서버에 전달한 요청을 되돌린다는 뜻은 아닙니다.
- 로딩·실패·완료·빈 목록을 구분하고 중복 요청을 막습니다. Health 조회는 별도로 20초 제한과 취소를 사용합니다. 내부 예외는 화면에 노출하지 않습니다.
- 로그인·가입·재발송·복구·이메일 확인은 같은 인증 화면을 사용합니다. 데스크톱의 기존 STORYFORK 브랜드는 보존하고 모바일은 작은 로고와 현재 입력부터 표시합니다. 테마 전환은 일반 문서 흐름에 두며 페이지 이동은 링크를 사용합니다.
- 가입 오류는 해당 필드에 연결하고 첫 오류로 초점을 이동합니다. 복구·재발송 접수 후 입력한 주소와 스팸함 안내, 주소 수정·재요청 경로를 표시합니다. 이 주소 문맥은 화면 상태에만 두고 브라우저 저장소에 보관하지 않습니다.
- 상태 알림은 live region, 버튼은 키보드 포커스를 지원하고 애니메이션은 reduced-motion을 따릅니다. 기존 색상·타이포그래피·상태 스타일을 재사용합니다.

실제 약관 동의·계정탈퇴·소셜 로그인·운영 메일 서비스·비용 정책은 이 연결 범위에 포함하지 않습니다. 계정탈퇴 UI는 기존 데모이며 실제 계정을 삭제하지 않습니다.

## 검증

로컬 개발은 변경·직접 영향 범위의 **단위 테스트 파일만** 지정합니다. 전체 suite·빌드·React 조립·브라우저/E2E는 로컬 개발 검증으로 실행하지 않습니다.

```bash
pnpm exec vitest run src/domain/__tests__/LibraryUseCase.test.ts
# Data 단위 테스트도 실제 서버 대신 fetch 대역을 사용합니다.
pnpm exec vitest run src/data/api/auth.test.ts
```

CI는 [공통 검증 정책](../README.md#검증)에 따라 web 서비스의 단위(Domain/Data/HTML)와 나머지 React/Hook/App 통합을 분리 실행하고 lint/build도 수행합니다.
워크플로가 이 디렉터리에서 `pnpm exec vitest run src/domain src/data src/index-html.test.js`와 해당 파일들을 `--exclude`한 통합 명령을 직접 호출합니다. 별도 테스트 runner나 shell wrapper는 없습니다.
Core API 변경 시 web 소비자 회귀도 선택합니다. 실제 HTTP 시스템 시나리오는 CI Compose에서 실행하며 브라우저 UI 검증이 아닙니다.
Aside는 별도 요청·승인 시에만 사용합니다. hosted `Required CI` 결과 확인 전에는 검증 대기로 보고합니다.

서버 작품은 `/studio/{UUID}`에서 회차별 실제 저장 API를 사용합니다. 데모 세션 대신 Core의 인증 결과를 따르며, 기존 이름 기반 데모 집필실과 구분합니다. 자동저장·버전 저장·복원과 검증 범위는 [이슈 #50 대응](../docs/issue-50-alignment.md)을 참고하세요.
