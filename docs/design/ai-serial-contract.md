# AI 자율 연재 계약 (UC-18, 기능 39, 2026-11-22 사용자 결정)

[유스케이스 UC-18](../usecase.md) · [서비스 경계](service-boundaries.md) · [크레딧 내부 API](credit-internal-api.md) · [기능표 39](../feature-roadmap.md)

12/8 시연을 위한 최소 구현이다. 작품 소유자가 AI 집필을 켜면 회차마다 독자 의견 게시판이 열리고,
마감 때 득표 상위 의견을 종합해 AI가 다음 회차를 쓰고 검수해 자동 발행한다.

## 흐름

1. **켜기**: 작품 소유자(원작·Fork)가 세계관 연결 여부와 상관없이 작품 관리의 **AI 집필** 탭(Fork 탭 옆)에서 켠다.
   요일(1~7개)·시각(KST, 하루 1회)·연재 방향(≤2,000자)을 저장한다. 1화는 소유자가 직접 써서 발행한다.
2. **게시판**: 켜져 있고 발행된 회차가 있으면 "다음 회차는 어떻게 흘러갈까요?" 게시판이 하나 열린다
   (대상 = 마지막 발행 회차 + 1). 작품당 열린 게시판은 하나이고, AI가 회차를 발행하면 다음 게시판이 열린다.
3. **참여**(로그인 회원만, 작품 소유자 포함): 게시판당 **의견 1개**와 **투표 1회**를 할 수 있다. 둘 다 할 수 있다.
   투표는 다른 의견으로 옮기거나 취소할 수 있다. 자기 의견에도 투표할 수 있다. 의견 유형은 독자가 고른다(BR-15).
   - `general`: 다음 전개 의견(≤1,000자).
   - `simulation`: 전제(≤500자)와 장면 비트(≤5개, 각 ≤200자)를 넣으면 AI가 **독자에게 공개된 회차·설정 카드만** 문맥으로
     짧은 장면 미리보기를 만들어 의견에 붙인다. 크레딧은 제출자 부담이다. 실패하면 의견을 저장하지 않고 차감도 없다.
4. **마감·실행**: 정해진 요일·시각이 되거나 소유자가 **지금 마감·실행**을 누르면 게시판이 마감되고 실행된다.
   - 입력: 연재 방향, 득표 상위 3개 의견(동률은 먼저 쓴 것, 숨긴 의견 제외, 시뮬레이션 미리보기 포함), 작품 문맥(최근 발행 회차 본문, 세계관이 연결돼 있으면 그 카드도).
   - AI: 의견 종합 → 회차 기획·원고 → 검수(문맥 기준 설정 충돌·개연성·19세 이용가 판정). 검수 실패면 원고를 1회 다시 쓰고, 그래도 실패면 실패를 돌려준다.
   - Content: 성공하면 다음 회차를 저장·발행하고 게시판을 `published`로 닫은 뒤 다음 게시판을 연다. 종합 문장(`summary`)은 닫힌 게시판에 공개한다.
     실패하면 게시판은 `failed`와 고정 문구 사유로 남고 발행하지 않는다. 자동 재시도는 없고 소유자가 지금 실행으로 다시 시도한다.
5. **기록**: AI 집필 탭에서 게시판별 상태(`open`·`queued`·`running`·`published`·`failed`)·발행 회차·실패 사유를 본다.

## 일정

- Content 안의 `@Scheduled` 주기 점검(1분) 하나가 일정 도래와 지금 실행 요청(`queued`)을 처리한다. 별도 worker·큐는 없다.
- 오늘(KST)이 정한 요일이고 정한 시각부터 1시간 안이며 오늘 아직 실행하지 않았으면 실행한다. 1시간을 넘긴 일정은 건너뛴다.
- 실행 선점은 게시판 행을 `open|queued → running`으로 조건부 갱신해 한 번만 실행한다. ponytail: 서버 재시작으로 `running`에 남은 행은 30분 뒤 `failed`로 바꾼다. 다중 서버 분산 잠금은 하지 않는다.
- 꺼져 있으면 일정도 지금 실행도 하지 않는다. 열린 게시판은 의견·투표만 받는다.

## 크레딧 (사용자 결정: LangChain 미들웨어로 금액 확정 후 차감)

정책 표의 "실행 전 예상 상한 동의 → 실제 토큰 사용량을 상한 이내로 차감, 실패는 차감 없음"을 따른다.

1. Content가 Core `POST /internal/v1/credits/reservations`로 **상한**을 예약한다(`operationKey` = `serial-sim:<의견 요청 UUID>` 또는 `serial-run:<게시판 id>`).
   잔액이 모자라면 409 `INSUFFICIENT_CREDIT`을 그대로 돌려준다(실행 실패 사유 `크레딧이 부족합니다.`).
2. AI 요청에 `creditLimit`(상한)을 싣는다. AI의 `CreditMiddleware`(`app/agent_runtime.py`, LangChain `AgentMiddleware`)가 요청 안의 모든 모델 호출 사용량(입력+출력 토큰)을 더해
   **1 크레딧 = 1,000 토큰**(코드 상수, 소수 4자리 올림)으로 금액을 확정하고, 다음 모델 호출 전에 누적 금액이 상한 이상이면 호출하지 않고 402 고정 문구로 끝낸다.
3. AI 응답의 `credits`(확정 금액)로 Content가 `…/settle`을 부른다. AI 실패·시간 초과면 `…/release`. AI는 Core를 부르지 않는다(과금 확정은 Core, 호출 판단은 Content).
4. 부담: `simulation` 의견은 제출자, 회차 실행은 작품 소유자. 상한은 `.env`의 `SERIAL_SIMULATION_CREDIT_LIMIT`(기본 5)·`SERIAL_EPISODE_CREDIT_LIMIT`(기본 50).
   가입 체험 지급이 기본 0이므로 시연 계정에는 관리자 크레딧 지급으로 미리 넣어 둔다.
5. trace metadata `credit_reservation_id`에 예약 id를 단다(운영 비용 집계).

## API

### Content 공개 API

| 메서드·경로 | 누가 | 설명 |
|---|---|---|
| `GET /api/v1/works/{id}/ai-serial` | 소유자 | 설정 `{enabled, days:["MON",…], time:"HH:mm", direction}` |
| `PUT /api/v1/works/{id}/ai-serial` | 소유자 | 설정 저장(세계관 연결은 필요 없음, 2026-11-22 사용자 결정). 발행 회차 없음은 저장되지만 게시판은 1화 발행 뒤 열림 |
| `POST /api/v1/works/{id}/ai-serial/run` | 소유자 | 열린 게시판을 `queued`로. 꺼짐 409 `SERIAL_DISABLED`, 열린 게시판 없음 409 `SERIAL_NO_BOARD`, 이미 실행 중 409 `SERIAL_RUNNING`. 202 |
| `GET /api/v1/works/{id}/ai-serial/boards` | 소유자 | 게시판 기록 최신순(상태·대상 회차·발행 회차·사유·마감 시각, 최대 50) |
| `GET /api/v1/works/{id}/serial-board` | 누구나(공개 작품) | 열린 게시판(없으면 `null`)과 의견 목록(득표순, 숨긴 의견 제외), 로그인이면 내 의견·내 투표. 마지막 닫힌 게시판의 `summary` |
| `POST /api/v1/works/{id}/serial-board/opinions` | 로그인 | 의견 제출 `{kind, body, simulation?:{premise, beats}}`. 이미 냈으면 409 `OPINION_EXISTS` |
| `PUT /api/v1/works/{id}/serial-board/vote` | 로그인 | `{opinionId}` 투표·옮기기 |
| `DELETE /api/v1/works/{id}/serial-board/vote` | 로그인 | 투표 취소 |
| `POST /api/v1/works/{id}/serial-board/opinions/{opinionId}/hide` | 소유자 | 의견 숨김(악성 의견) |

### AI 내부 API (`X-Internal-Token`, 새 패키지 `app/serial/`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /internal/v1/serial/simulations` | `{workId, episodeNumber, premise, beats, context, creditLimit}`(context = 공개 회차·공개 카드 JSON) | `{scene, credits, usage}` |
| `POST /internal/v1/serial/episodes` | `{workId, episodeNumber, direction, opinions:[{kind, body, votes, scene?}], context, creditLimit}` | `{summary, title, text, review:{passed, issues}, credits, usage}`. 검수 2회 실패는 422 `SERIAL_REVIEW_FAILED` |

- 원고 생성은 기존 `app/writing/`의 기획·원고 지시를 재사용하고, 검수·종합·장면 미리보기만 새 프롬프트(`serial.*`, `tracing.prompt` 규칙)다.
- 사용자 토큰·Content MCP를 쓰지 않는다. 시뮬레이션만 추적 회원용 선택 헤더 `X-User-Authorization`(제출자 Bearer)을 받는다(인가에는 쓰지 않음). 일정 실행에는 사용자 토큰이 없어서 Content가 허용 문맥을 만들어 넘긴다(새 원고 생성과 같은 방식).

## 저장 (Content `db/migration/work/V43__ai_serial.sql`)

- `ai_serial(work_id PK, enabled, days text, run_time time, direction text, last_run_date date, updated_at)`
- `serial_board(id, work_id, episode_number, status, summary, published_episode_number, failure_reason, opened_at, closed_at)`, 작품당 `open|queued|running` 하나(부분 유니크).
- `serial_opinion(id, board_id, author_id, kind, body, simulation jsonb, hidden, created_at)`, `(board_id, author_id)` 유니크.
- `serial_vote(board_id, member_id, opinion_id)`, PK `(board_id, member_id)`.
- 작성자 표시명은 저장하지 않고 `CoreNicknameService`로 채운다.

## 구현에서 정한 세부 (2026-11-22, #659)

- 정산은 회차 저장·발행(시뮬레이션은 의견 저장)이 끝난 뒤 한다. 정산이 실패하면 예약을 풀고 기록만 남긴다.
- 실행이 실패하면(오래 남은 `running` 포함) 같은 대상 회차의 새 게시판을 열고 의견·투표를 옮겨, 지금 실행으로 다시 시도할 수 있다(꺼져 있으면 열지 않음).
- 사람이 1화나 대상 회차를 직접 발행한 경우 1분 점검이 게시판을 열거나 대상 회차를 올린다. 사람이 이미 발행한 회차는 AI 원고로 덮지 않는다.
- 독자 게시판 응답의 `board`는 `open`일 때만 싣는다(`queued`·`running`은 `null`). 의견 제출 201 `{id}`, 투표·취소·숨김 204.
- 발행은 예약 발행과 같은 경로라 권리 확인을 소유자 이름으로 자동 기록한다(자율 연재를 켠 것을 사전 승인으로 본다).
- 실행 문맥은 최근 발행 3개 회차와 연결 세계관 초안의 활성 카드(관계 제외), 시뮬레이션 문맥은 공개 회차와 독자 설정 위키 카드다.
- AI 읽기 한도: 회차 실행 10분, 시뮬레이션은 기존 생성 한도(`AI_GENERATION_READ_TIMEOUT`). 두 요청에 `creditReservationId`를 싣는다.
- 지금 실행도 그날의 실행으로 기록해 같은 날 일정 실행은 건너뛴다. AI 속도 제한(`ai-rate-limit/acquire`)은 부르지 않는다.

## 범위 밖 (MVP 이후)

독자 설정 카드 추가·변경 제안과 소유자 승인(2026-11-22 사용자 결정으로 제외, 의견은 일반·시뮬레이션만), 다중 서버 분산 잠금, 연속 실패 자동 중단·월 한도, 생성 중지, 실행 실패 알림, 시뮬레이션 보상(작가 승인 시 50%), 독자 인물 시뮬레이션(턴별 진행) 개방. 실행 선점 직후 커밋된 의견·투표는 그 실행에 들어가지 않는다(게시판 단위 직렬화 없음). Core 장애로 정산·해제가 실패하면 재조정 상태를 남기지 않는다(Core 예약 정리 작업 기본 꺼짐).
