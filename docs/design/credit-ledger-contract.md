# 크레딧 원장 프론트 연결 계약 (기능 32 일부)

[서비스 경계](service-boundaries.md) · [기능표](../feature-roadmap.md) · [크레딧 ERD](erd/core/credit.md) · 구현 이슈 #264, 백엔드 #258

계정 > 결제 내역(`/me/pay`, U33)이 Core 크레딧 원장 API를 읽는 범위와 응답 형태를 정한다. 백엔드 정본은 `CreditResponses.kt`다.

## 범위

| 구분 | 내용 |
|---|---|
| 포함 | 보유 크레딧 합계, 지급분별 남은 양과 소멸 예정 시각, 지급·사용·소멸 내역 표시. 로딩·실패(다시 불러오기)·빈 내역 구분 |
| 제외 | 스튜디오의 데모 AI 차감(`CreditUseCase`·`DemoCredits`)과 정책 안내 시트의 데모 잔액, 결제·충전·구독, AI 실행 연동, 소멸 예정 알림 |
| `--mode mockup` | 서버를 부르지 않는다. 데모 크레딧 잔액만 보여 주고 지급·사용·소멸 내역은 만들지 않는다 |

## API (Core, 로그인 필요, 기존 nginx·Vite의 `/api` 나머지 규칙 안)

| 메서드·경로 | 응답 |
|---|---|
| `GET /api/v1/me/credits` | `{ total: number, items: [{ kind, remaining: number, expiresAt }] }` — items는 소멸이 빠른 순 |
| `GET /api/v1/me/credits/history` | `{ items: [{ type: 'grant' \| 'spend' \| 'expire', kind, amount: number, occurredAt }] }` — 최신순 |

- `kind`는 `signup-trial`·`reward`·`event`이며, 화면은 각각 가입 체험·보상·이벤트 크레딧으로 부른다. 모르는 코드는 그대로 보인다.
- 시각은 오프셋이 있는 ISO 8601이고 화면은 KST로 표시한다. 응답 형식이 다르면 Zod 검증에서 거부하고 실패 화면으로 처리한다.
- 보유 크레딧과 내역은 함께 읽혀야 성공이다. 한쪽만 읽히면 어긋나 보이므로 일부만 보여 주지 않는다.

## 구조

`PayView`(View) → `useAccountViewModel`(ViewModel, `credit`) → `CreditLedgerUseCase.overview()` → `CreditLedgerRepository` → `HttpCreditLedgerRepository`(Zod 검증).
