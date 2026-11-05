# STORYFORK Web

React·TypeScript·Vite·Tailwind CSS 기반의 개발 화면입니다.
이름 기반 작품·Fork·서재는 데모 데이터입니다. `/content`·`/studio/{UUID}`는 같은 출처의 Content API, 인증·프로필·기기 관리는 Core API를 호출합니다.
이메일 확인 전 자동 로그인하지 않으며 운영 약관은 미정입니다. 알 수 없는 UI 경로는 `/`로 이동합니다.

## 목표 서비스 경계 (DEC-41)

[4개 백엔드 서비스 구조](../docs/design/service-boundaries.md)에 따라 Core는 회원·인증·크레딧·회원 알림, 별도 Kotlin/Spring Boot 콘텐츠 앱은 창작·독서·콘텐츠 정본과 인가, 별도 Kotlin/Spring Boot 운영 앱은 문의·공지·신고 사건·운영 결정·감사·작업 감시를 담당합니다. Python AI 앱은 허용 문맥에서 생성·검토를 실행하며 정본·권한·발행·정산을 확정하지 않습니다. LLMOps는 운영 영역이며 Langfuse 도입 시 별도 제품으로 배포합니다. 자체 UI와 운영 화면 API 통합 중 방식은 미정입니다.

nginx/Vite는 기존 `/api/v1/works`·`/api/v1/public/works`와 하위 경로를 Content:8081, 나머지 `/api`를 Core:8080으로 분기합니다. 브라우저는 상대 URL·기존 Bearer/쿠키/CSRF를 유지하며 내부 인증 endpoint·AI·DB·모델을 직접 호출하지 않습니다. 소스 연결과 hosted CI·실제 DB 전환·배포는 구분하며 운영·알림 데모를 서버 완료로 간주하지 않습니다.

## 실행

Node **24.x**, pnpm **11.22.x** (`packageManager: pnpm@11.22.0`)가 필요합니다.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

네이티브 web/Core/Content는 `http://localhost:5173`/8080/8081입니다. 콘텐츠는 같은 origin의 상대 `/api`로 호출하며 `VITE_DEV_PROXY_TARGET`과 `VITE_CONTENT_DEV_PROXY_TARGET`이 각각 Core/Content를 지정합니다.
직접 실행할 때는 공개 `VITE_CORE_API_BASE_URL` 등 필요한 변수만 터미널에 설정합니다. 루트 `.env`는 자동으로 읽지 않습니다.
루트 설정 자동 전달은 Compose를 사용하며 서비스별 `.env`는 만들지 않습니다.
`VITE_*`는 브라우저에 노출되므로 비밀값을 넣지 않습니다. 백엔드는 별도로 실행합니다.

루트의 [Compose 안내](../infrastructure/README.md)는 공통 `docker-compose.yaml`에 prod 또는 dev를 병합합니다.
prod는 소스에서 정적 배포 이미지를 빌드해 기본 `http://127.0.0.1:8088`로 검증하고, dev는 현재 개발 배포 서버에서 CI의 `:develop` 이미지를 pull·실행합니다.
두 조합 모두 Nginx가 정적 화면과 works 경로 → `content-service:8081`, 나머지 `/api` → `core-api:8080` 프록시를 제공합니다. 소스/HMR Compose는 제거했으며 hot reload는 위 `pnpm dev`를 사용합니다.
loopback 검증용이며 인터넷 운영 준비를 뜻하지 않습니다.

## 프론트엔드 구조와 상태 소유

- `app/di`에서 Repository·UseCase와 Health·알림 SSE 외부 함수를 조립합니다. Presentation은 Data 함수를 직접 import하지 않으며, 공유 Health·SSE 계약은 Domain에 둡니다. HTTP 응답의 Zod 검증은 Data에 남깁니다.
- Redux `session`은 인증·로그인 안내와 기존 조회 무효화 신호를, `ui`는 테마·화면 ID·읽기 설정·홈 표시 상태를 소유합니다. UI 상태는 로그인·로그아웃 때 유지하며 브라우저 저장소에 영속화하지 않습니다. `dataVersion`은 여전히 데모 전역 재조회 신호이며 기능별 캐시로 바꾸지 않았습니다.
- 관계 패널의 draft 상태·적용 handler는 `useRelationPairViewModel`, 순수 초기화·방향 변환은 Domain의 `relationDraft`가 담당합니다. 최초 baseline을 유지하고 기존 `applyRelationChanges`로 검증하며, 저장 전 편집과 실제 저장을 구분합니다.
- 집필실·서재가 함께 쓰는 `PublishSettingsSheet`는 `presentation/shared`에, Wiki 편집 화면은 `StudioWikiView`에 둡니다. 데모 피드백함과 실제 알림함의 ViewModel은 별도 파일입니다.
- 순수 함수라도 Presentation 소유의 테스트는 해당 feature 옆에 둡니다. 현재 CI는 경로 기준으로 분류하므로 이 테스트는 Domain/Data 단위 명령이 아니라 기존 통합 선택에서 발견됩니다.

## 실제 호출 흐름

`/status`의 연결 확인은 `App → CoreApiConnectionStatus → useCoreApiHealth → DI 외부 함수 → Fetch·Zod → 공개 Core API`입니다. 해당 화면의 Health 전용 안내가 앱 전체의 구현 상태를 뜻하지는 않습니다.

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

## 서버 이미지·파일 (#92)

`MediaPanel / useMediaViewModel → MediaUseCase → MediaRepository → HttpMediaRepository`를 Awilix에서 조립합니다. 실제 작품·설정 UUID만 허용하고 데모 ID·실패 시 메모리 성공 fallback을 보내지 않습니다.

- `/content`: 작품 생성 시 PNG/JPEG 표지 선택, 생성된 작품의 표지 조회·교체·삭제·새로고침. 작품만 생성되고 표지 업로드가 실패하면 생성된 작품을 유지하며 표지만 재시도합니다.
- `/content` 설정집: 서버에 설정 초안을 먼저 저장한 뒤 이미지·TXT/MD/CSV/PDF 목록/업로드/다운로드/교체/삭제. following 설정은 로컬 독립 전 첨부하지 않습니다. 공개 설정도 첨부 자체는 소유자 전용입니다.
- `/studio/{UUID}`: 실제 회차 본문의 커서/선택 영역에 불변 이미지 `[[image:<UUID>]]` 참조 삽입, 초안·버전 저장/재진입/복원/발행 및 읽기 미리보기. 업로드 후 초안이나 버전을 저장해야 참조가 보존됩니다. 과거 버전을 위해 원본을 지우지 않으므로 회차당 업로드 총 10개는 marker 삭제로 반환되지 않습니다.
- 같은 출처의 Bearer/CSRF multipart 요청을 사용하며 JSON Content-Type을 강제하지 않습니다. 비공개 이미지 bytes를 인증 fetch 후 Blob URL로 표시하고 교체·이탈 때 revoke합니다. 토큰·스토리지 URL·base64를 서버 원고에 저장하지 않습니다.
- 중복 요청을 막고 취소·이탈 뒤 늦은 결과를 적용하지 않습니다. 취소/네트워크 응답 유실은 서버 rollback을 의미하지 않으므로 목록 새로고침으로 실제 상태를 확인합니다. 실패하면 기존 파일/원고를 유지합니다.
- PNG/JPEG 표지·본문 및 설정 파일은 파일당 10 MiB 이하입니다. 서버가 바이트·픽셀·권한·한도를 최종 검증합니다. TXT 내보내기는 이미지·참조 marker를 제외한 텍스트 전용이며 EPUB은 제공하지 않습니다.

`/new`, 이름 기반 `/studio/starlight` 등 개요·Wiki 이미지 선택은 브라우저 메모리 데모입니다. 인접 안내·toast에서 서버 미저장을 알리고 `/content`로 연결합니다. 무관한 데모 데이터 전체의 서버 이관은 포함하지 않습니다. 표지 논리 삭제·미참조 원본 보존과 API/권한/운영 한계는 [Core 계약](../backend/core-api/README.md#작품-표지원고-이미지-92)을 참고하세요.

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
