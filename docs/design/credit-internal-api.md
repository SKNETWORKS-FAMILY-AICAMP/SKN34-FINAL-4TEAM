# 크레딧 내부 API 계약 (기능 32 일부, F-CRD-01·03·05)

[서비스 경계](service-boundaries.md) · [크레딧 원장 프론트 계약](credit-ledger-contract.md) · [요구사항 F-CRD](../requirements.md#f-crd-01)

Content가 AI 작업에 크레딧을 쓸 때 부르는 Core 내부 API다. 백엔드 정본은 `InternalCreditController.kt`다.
지금은 이 API를 부르는 기능이 없다. AI 작업당 크레딧 가격·토큰 환산 비율, 화면의 비용 안내·동의 기록은 정해지지 않았다(F-CRD-01 가격 미정, DEC-22).

## 인증

- `X-Content-Service-Token`(또는 운영 서비스 토큰)만 받는다. 사용자 Bearer는 받지 않으며 대신하지도 않는다.
- 아래 정확한 경로만 Content 토큰을 허용한다. 끝 슬래시 같은 변형은 403이다.
- 회원 확인(로그인한 작가 본인인지)과 크레딧 환산은 호출한 쪽이 끝낸 값을 보낸다.

## API

| 메서드·경로 | 본문 | 성공 응답 |
|---|---|---|
| `POST /internal/v1/ai-rate-limit/acquire` | `{ memberId, tokens }` | `{ allowed: boolean, retryAfterMillis: number \| null }` |
| `POST /internal/v1/credits/reservations` | `{ memberId, operationKey, amount }` | `{ id, operationKey, status: "reserved", reservedAmount, settledAmount: null }` |
| `POST /internal/v1/credits/reservations/settle` | `{ memberId, operationKey, actual }` | 같은 형태, `status: "settled"` |
| `POST /internal/v1/credits/reservations/release` | `{ memberId, operationKey }` | 같은 형태, `status: "released"` |

- 호출 순서: 속도 제한 확인 → 예약 → AI 실행 → 성공이면 실제 사용량으로 정산, 실패·시간 초과·취소면 해제.
- 예약·정산·해제는 같은 `operationKey`로 다시 불러도 결과가 같다(아직 열린 예약의 같은 금액 재예약·같은 금액 재정산·재해제). 이미 닫힌 예약의 키로 다시 예약하면 잡아 둔 크레딧이 없으므로 409다. 응답이 불확실하면 같은 요청을 다시 보낸다.
- `acquire`에는 `operationKey`가 없어 부를 때마다 요청 1건과 토큰을 가져간다. 응답이 불확실해도 다시 보내면 한도를 한 번 더 쓴다.
- 금액은 소수 4자리까지다. 정산 금액은 0 이상 예약 상한 이하다.
- 속도 제한에 걸리면 한도를 가져가지 않으므로 예약하지 않고 `retryAfterMillis` 뒤 다시 시도한다. 한도 값은 임시다(F-CRD-05).
- 닫히지 않은 예약은 정리 작업이 차감 없이 해제한다(`app.credit.reservation-cleanup.*`, 기본 꺼짐).

## 실패

ProblemDetail(`application/problem+json`)의 `code`로 구분한다. `detail`은 고정 문구이며 잔액 숫자를 싣지 않는다.

| 상태 | `code` | 뜻 |
|---|---|---|
| 400 | — | 필수 값 누락·형식 오류 |
| 403 | — | 서비스 토큰 없음·틀림 |
| 404 | `RESERVATION_NOT_FOUND` | 없거나 다른 회원의 예약 |
| 409 | `INSUFFICIENT_CREDIT` | 사용 가능 잔액(잔여−예약) 부족. 아무것도 예약하지 않음 |
| 409 | `RESERVATION_CLOSED` | 해제한 예약 정산, 정산한 예약 해제, 이미 닫힌 예약의 키로 다시 예약 |
| 422 | `INVALID_CREDIT_REQUEST` | 금액·operationKey·토큰 수 규칙 위반(같은 키의 다른 금액 예약·다른 금액 재정산 포함) |
