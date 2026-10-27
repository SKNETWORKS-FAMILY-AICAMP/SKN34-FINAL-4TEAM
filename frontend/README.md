# STORYFORK Web

React·TypeScript·Vite·Tailwind CSS로 만든 최소 시작 화면입니다.
제품 소개와 '개발 기반 / 기능 준비 중' 상태, 실제 Core·AI 연결 상태만 제공합니다.
작품·로그인·생성·Fork 화면과 가짜 결과는 없습니다. 알 수 없는 UI 경로는 `/`로 이동합니다.

## 실행

Node **24.x**, pnpm **11.22.x** (`packageManager: pnpm@11.22.0`)가 필요합니다.

```bash
pnpm install --frozen-lockfile
# 저장소 루트 .env를 선택적으로 로드합니다 (uv 필요).
python3 ../infrastructure/scripts/run-native.py web
```

네이티브 기본 주소는 `http://localhost:5173`, Core는 `http://localhost:8080`입니다.
설정은 루트 `.env`의 공개 `VITE_CORE_API_BASE_URL`을 변경합니다. 서비스별 `.env`는 만들지 않습니다.
`VITE_*`는 브라우저에 노출되므로 비밀값을 넣지 않습니다. 백엔드는 별도로 실행합니다.

루트의 [개발 Compose](../infrastructure/README.md)는 `http://127.0.0.1:5173`에서 실행하며
브라우저의 `/api` 요청을 Vite가 `core-api:8080`으로 프록시합니다.
배포 이미지는 nginx로 정적 파일과 같은 `/api` 경계를 제공합니다.

## 실제 호출 흐름

`App → CoreApiConnectionStatus → useCoreApiHealth → DI 외부 함수 → Fetch·Zod → 공개 Core API`.

- Core: `GET /api/v1/health`, `storyfork-core-api`와 `up` 검증.
- AI: `GET /api/v1/health/ai-service`, `storyfork-ai-service`와 `up` 검증.
- AI 내부 주소나 OpenAI를 브라우저에서 직접 호출하지 않습니다.
- Health는 OpenAI 키·모델 접근 검증이 아닙니다.

화면별 요청 상태는 Hook에만 둡니다. 기존 Awilix `app/di`는 두 외부 함수를 연결합니다.
업무 기능이 없어 Repository·UseCase·Redux Store·Provider는 없습니다.
기존 설치 의존성·lock 버전은 유지하되 실제 사용하지 않는 업무 배선은 제거했습니다.

로딩·성공·실패를 독립적으로 표시하고 요청 중 재시도를 비활성화합니다.
재시도와 unmount에서 AbortController로 취소하고 요청 ID로 늦은 응답을 무시합니다.
Fetch는 20초 제한을 두며 내부 예외를 화면에 노출하지 않습니다.
상태 알림은 live region, 버튼은 키보드 포커스를 지원하고 애니메이션은 reduced-motion을 따릅니다.
기존 색상·타이포그래피·상태 스타일을 재사용합니다.

## 검증

```bash
pnpm test
pnpm lint
pnpm build
```

실제 브라우저·통합 스택 확인은 [인프라 안내](../infrastructure/README.md)를 따릅니다.
