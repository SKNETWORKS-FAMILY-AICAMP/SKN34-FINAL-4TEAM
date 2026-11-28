# AI 자율 연재 계약 (UC-18, 기능 39, 2026-11-22 사용자 결정)

[유스케이스 UC-18](../usecase.md) · [서비스 경계](service-boundaries.md) · [크레딧 내부 API](credit-internal-api.md) · [기능표 39](../feature-roadmap.md)

12/8 시연을 위한 최소 구현이다. 작품 소유자가 AI 자율 집필을 켜면 회차마다 "다음 회차" 게시판이 열린다.
AI가 다음 전개 4지선다를 만들어 독자 투표를 받고, 독자는 제안 게시판에 글을 쓴다. 마감 때 1위 선택지와 추천 많은 제안 글로
AI가 다음 회차를 쓰고 검수해 자동 발행한다(투표·제안 개편: 2026-11-22 사용자 결정).

## 흐름

1. **켜기**: 작품 소유자(원작·Fork)가 세계관 연결 여부와 상관없이 작품 관리 > 운영 설정의 **집필 방식**을 `AI 자율 집필`로 저장해 켠다.
   요일(1~7개)·시각(KST, 하루 1회)·연재 방향(≤2,000자)은 **AI 집필** 탭에서 저장한다. 1화는 소유자가 직접 써서 발행한다.
2. **게시판**: 켜져 있고 발행된 회차가 있으면 "다음 회차는 어떻게 흘러갈까요?" 게시판이 하나 열린다
   (대상 = 마지막 발행 회차 + 1). 작품당 열린 게시판은 하나이고, AI가 회차를 발행하면 다음 게시판이 열린다.
3. **4지선다 투표**: 게시판이 열리면 1분 점검이 AI에 다음 전개 선택지 4개(각 ≤300자)를 만들게 해 게시판에 붙인다(소유자 크레딧, 상한 `SERIAL_CHOICE_CREDIT_LIMIT` 기본 5).
   실패하면 10분 뒤 다시 시도하고, 그동안 화면은 "선택지를 준비하고 있어요"다. 로그인 회원(소유자 포함)은 게시판당 **선택지 하나에 1표**이고 옮기거나 취소할 수 있다.
4. **제안 게시판**: 로그인 회원은 제목(≤100자)·본문(≤2,000자)으로 제안 글을 **개수 제한 없이** 쓴다. 글마다 회원당 **추천 1회**(취소 가능)다. 소유자는 글을 숨길 수 있다.
   글 유형은 `general`·`simulation`이다. `simulation`은 전제(≤500자)와 장면 비트(≤5개, 각 ≤200자)로 AI가 **독자에게 공개된 회차·설정 카드만** 문맥으로
   짧은 장면 미리보기를 만들어 글에 붙인다. 크레딧은 작성자 부담이고, 실패하면 글을 저장하지 않고 차감도 없다.
5. **마감·실행**: 정해진 요일·시각이 되거나 소유자가 **지금 마감·실행**을 누르면 게시판이 마감되고 실행된다.
   - 입력: 연재 방향, **1위 선택지**(동률은 앞 번호, 표가 없으면 1번, 선택지가 없으면 생략), **추천 상위 3개 제안 글**(동률은 먼저 쓴 글, 숨긴 글 제외, 미리보기 포함), 작품 문맥(최근 발행 회차 본문, 세계관이 연결돼 있으면 그 카드도).
   - AI: 1위 선택지를 이번 회차의 중심 전개로 삼고 제안 글을 참고해 회차 기획 → **인물 시뮬레이션**(장면 1개, 아래 '회차 집필은 반드시 인물 시뮬레이션으로') → 그 장면을 뼈대로 원고(직전 회차들과 비슷한 분량, 최소 5,000자, 모자라면 분량만 맞추는 재작성 1회) → 검수(설정 충돌·개연성·19세 이용가·**1위 선택지 반영**·**시뮬레이션 장면 반영**). 검수 실패면 원고를 1회 다시 쓰고(장면은 다시 돌리지 않는다. 분량 재작성은 이 횟수에 세지 않는다), 그래도 실패면 실패를 돌려준다.
   - Content: 성공하면 다음 회차를 저장·발행하고 게시판을 `published`로 닫은 뒤 다음 게시판을 연다. 종합 문장(`summary`)은 닫힌 게시판에 공개한다.
     실패하면 게시판은 `failed`와 고정 문구 사유로 남고 발행하지 않는다. 자동 재시도는 없고 소유자가 지금 실행으로 다시 시도한다(선택지·투표·제안·추천은 새 게시판으로 옮긴다).
6. **기록**: AI 집필 탭에서 게시판별 상태(`open`·`queued`·`running`·`published`·`failed`)·발행 회차·실패 사유를 본다.

## 일정

- Content 안의 `@Scheduled` 주기 점검(1분) 하나가 일정 도래와 지금 실행 요청(`queued`)을 처리한다. 별도 worker·큐는 없다.
- 오늘(KST)이 정한 요일이고 정한 시각부터 1시간 안이며 오늘 아직 실행하지 않았으면 실행한다. 1시간을 넘긴 일정은 건너뛴다.
- 실행 선점은 게시판 행을 `open|queued → running`으로 조건부 갱신해 한 번만 실행한다. ponytail: 서버 재시작으로 `running`에 남은 행은 정체 기준(`STALE_RUNNING_MINUTES`, 회차 실행의 AI 읽기 한도 35분보다 길어야 해서 45분) 뒤 `failed`로 바꾼다. 다중 서버 분산 잠금은 하지 않는다.
- 꺼져 있으면(집필 방식이 `autonomous`가 아니면) 일정도 지금 실행도 하지 않는다. 열린 게시판은 의견·투표만 받는다.

## 크레딧 (사용자 결정: LangChain 미들웨어로 금액 확정 후 차감)

정책 표의 "실행 전 예상 상한 동의 → 실제 토큰 사용량을 상한 이내로 차감, 실패는 차감 없음"을 따른다.

1. Content가 Core `POST /internal/v1/credits/reservations`로 **상한**을 예약한다(`operationKey` = `serial-sim:<글 요청 UUID>`·`serial-choice:<게시판 id>:<시도 시각>`·`serial-run:<게시판 id>`).
   잔액이 모자라면 409 `INSUFFICIENT_CREDIT`을 그대로 돌려준다(실행 실패 사유 `크레딧이 부족합니다.`).
2. AI 요청에 `creditLimit`(상한)을 싣는다. AI의 `CreditMiddleware`(`app/agent_runtime.py`, LangChain `AgentMiddleware`)가 요청 안의 모든 모델 호출 사용량(입력+출력 토큰)을 더해
   **1 크레딧 = 1,000 토큰**(코드 상수, 소수 4자리 올림)으로 금액을 확정하고, 다음 모델 호출 전에 누적 금액이 상한 이상이면 호출하지 않고 402 고정 문구로 끝낸다.
3. AI 응답의 `credits`(확정 금액)로 Content가 `…/settle`을 부른다. AI 실패·시간 초과면 `…/release`. AI는 Core를 부르지 않는다(과금 확정은 Core, 호출 판단은 Content).
4. 부담: `simulation` 제안 글은 작성자, 선택지 생성·회차 실행은 작품 소유자. 상한은 `.env`의 `SERIAL_SIMULATION_CREDIT_LIMIT`(기본 5)·`SERIAL_CHOICE_CREDIT_LIMIT`(기본 5)·`SERIAL_EPISODE_CREDIT_LIMIT`(기본 1,000: 인물 시뮬레이션 장면까지 같은 예약으로 센 추정치, 미실측. 아래 '회차 집필은 반드시 인물 시뮬레이션으로').
   AI가 상한 초과 402 `CREDIT_LIMIT_EXCEEDED`를 돌려주면 실행 실패 사유는 `크레딧 상한을 넘었습니다.`다(일반 실패 문구와 구분).
   가입 체험 지급이 기본 0이므로 시연 계정에는 관리자 크레딧 지급으로 미리 넣어 둔다.
5. trace metadata `credit_reservation_id`에 예약 id를 단다(운영 비용 집계).

## API

### Content 공개 API

| 메서드·경로 | 누가 | 설명 |
|---|---|---|
| `GET /api/v1/works/{id}/ai-serial` | 소유자 | 설정 `{enabled, days:["MON",…], time:"HH:mm", direction}` |
| `PUT /api/v1/works/{id}/ai-serial` | 소유자 | 요일·시각·방향 저장(`enabled`는 무시, 켜기·끄기는 집필 방식). 세계관 연결은 필요 없음. 게시판은 1화 발행 뒤 열림 |
| `POST /api/v1/works/{id}/ai-serial/run` | 소유자 | 열린 게시판을 `queued`로. 꺼짐 409 `SERIAL_DISABLED`, 열린 게시판 없음 409 `SERIAL_NO_BOARD`, 이미 실행 중 409 `SERIAL_RUNNING`. 202 |
| `GET /api/v1/works/{id}/ai-serial/boards` | 소유자 | 게시판 기록 최신순(상태·대상 회차·발행 회차·사유·마감 시각, 최대 50) |
| `GET /api/v1/works/{id}/serial-board` | 누구나(공개 작품) | `{enabled, board:{id, episodeNumber}\|null, choices:[{id, position, text, votes}], myChoiceId, proposals:[{id, authorName, kind, title, body, simulation, likes, likedByMe, mine, createdAt}], summary}`. 제안은 최신순 최대 200, 숨긴 글 제외. `enabled`는 AI 자율 집필 여부(화면의 '다음 회차' 탭 표시) |
| `PUT /api/v1/works/{id}/serial-board/vote` | 로그인 | `{choiceId}` 투표·옮기기. 열린 게시판 없음 409 `SERIAL_NO_BOARD` |
| `DELETE /api/v1/works/{id}/serial-board/vote` | 로그인 | 투표 취소 |
| `POST /api/v1/works/{id}/serial-board/proposals` | 로그인 | 제안 글 `{kind, title, body, simulation?:{premise, beats}}` → 201 `{id}` |
| `PUT·DELETE /api/v1/works/{id}/serial-board/proposals/{proposalId}/like` | 로그인 | 추천·취소 204 |
| `POST /api/v1/works/{id}/serial-board/proposals/{proposalId}/hide` | 소유자 | 글 숨김 204 |

### AI 내부 API (`X-Internal-Token`, 새 패키지 `app/serial/`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /internal/v1/serial/choices` | `{workId, episodeNumber, direction, context, creditLimit, creditReservationId}` | `{choices:[4개 문자열], credits, usage}` |
| `POST /internal/v1/serial/summaries` | `{workId, episodeNumber, title, body, creditLimit, creditReservationId}` | `{summary(≤400자), credits, usage}` |
| `POST /internal/v1/serial/simulations` | `{workId, episodeNumber, premise, beats, context, creditLimit}`(context = 공개 회차·공개 카드 JSON) | `{scene, credits, usage}` |
| `POST /internal/v1/serial/episodes` | `{workId, episodeNumber, direction, choice:{text, votes}\|null, proposals:[{title, body, likes, scene?}], world, context, creditLimit}` | `{summary, title, text, review:{passed, issues}, credits, usage}`. 분량 재작성 뒤에도 5,000자 미만이거나 검수 재작성 뒤 다시 검수에 실패하면(재작성 원고가 짧은 경우 포함) 422 `SERIAL_REVIEW_FAILED`. `world`는 연결(또는 이어받는) 세계관의 MCP `world_studio_read` 응답 모양에 `identity`를 더한 JSON 객체(필수, 아래 '회차 집필은 반드시 인물 시뮬레이션으로') |

- 회차 원고가 5,000자 미만이면 모델 검수 없이 분량만 맞추는 재작성을 1회 한다. 이 재작성은 검수 재작성 횟수에 세지 않는다(2026-11-28 사용자 결정 A안, #995: 처음엔 분량 재작성이 검수 재작성 1회를 써 버려 그 뒤 모델 검수가 불합격이면 고칠 기회 없이 422였다). 분량 재작성 뒤에도 5,000자 미만이면 모델 검수 없이 422이고, 5,000자 이상이면 모델로 검수해 불합격일 때 지적을 넣어 1회 다시 쓴 뒤(짧으면 모델 없이 불합격) 다시 검수한다. 집필은 최대 3회, 모델 검수는 최대 2회다. 회차 집필은 출력 12,000토큰·195초다(Writing 기본 4,000토큰·120초): 5,000자 이상은 약 3,500~4,500토큰이고 추론 토큰도 출력 한도에 들기 때문이다. 호출별 timeout은 종합 30·기획 50·시뮬레이션 계획 40·장면(전체 시간 상한) 1,005·집필 195·분량 재작성 195·검수 50·검수 재작성 195·재검수 50초로 최악 합계 1,810초이며 Content 읽기 한도 35분(2,100초)에서 290초(프롬프트 읽기·전송·세계관 변환)를 남긴다. 내용이 바뀐 프롬프트는 Langfuse 등록본에 가리지 않게 새 이름을 쓴다: `serial.vote_summary`·`serial.episode_review_v3`·`serial.episode_draft`(새로 만든 집필)·`serial.choices_v2`·`serial.simulation_v2`·`serial.episode_summary`.
- 회차 기획은 기존 `app/writing/`의 기획 지시(`writing_editing.plan`)를 재사용한다. 집필은 시뮬레이션 장면(최대 수천 자)을 입력으로 받아야 해서 Writing 집필 요청(계획 ≤4,000자)에 담지 못해 새 프롬프트 `serial.episode_draft`를 쓰고, 검수·종합·장면 미리보기도 `serial.*`(`tracing.prompt` 규칙)다.
- 사용자 토큰·Content MCP를 쓰지 않는다. 시뮬레이션만 추적 회원용 선택 헤더 `X-User-Authorization`(제출자 Bearer)을 받는다(인가에는 쓰지 않음). 일정 실행에는 사용자 토큰이 없어서 Content가 허용 문맥을 만들어 넘긴다(새 원고 생성과 같은 방식).

## 저장 (Content `db/migration/work/V44__ai_serial.sql`)

- `ai_serial(work_id PK, enabled, days text, run_time time, direction text, last_run_date date, updated_at)`
- `serial_board(id, work_id, episode_number, status, summary, published_episode_number, failure_reason, opened_at, closed_at)`, 작품당 `open|queued|running` 하나(부분 유니크).
- `serial_board`에 `choices_tried_at timestamptz`(선택지 생성 마지막 시도).
- `serial_choice(id, board_id, position 1~4, text)`, `(board_id, position)` 유니크.
- `serial_proposal(id, board_id, author_id, kind, title, body, simulation jsonb, hidden, created_at)`(작성자당 개수 제한 없음).
- `serial_proposal_like(proposal_id, member_id)` PK 둘.
- `serial_vote(board_id, member_id, choice_id)`, PK `(board_id, member_id)`.
- V44는 아직 develop에 없어 같은 파일을 고친다(병합 전 변경). develop의 `preprocessing/V43`과 겹쳐 리베이스 때 V43→V44, 집필 방식 CHECK는 V44→V45로 옮겼다.
- 작성자 표시명은 저장하지 않고 `CoreNicknameService`로 채운다.

## 구현에서 정한 세부 (2026-11-22, #659)

- 정산은 회차 저장·발행(시뮬레이션은 의견 저장)이 끝난 뒤 한다. 정산이 실패하면 예약을 풀고 기록만 남긴다.
- 실행이 실패하면(오래 남은 `running` 포함) 같은 대상 회차의 새 게시판을 열고 의견·투표를 옮겨, 지금 실행으로 다시 시도할 수 있다(꺼져 있으면 열지 않음).
- 사람이 1화나 대상 회차를 직접 발행한 경우 1분 점검이 게시판을 열거나 대상 회차를 올린다. 사람이 이미 발행한 회차는 AI 원고로 덮지 않는다.
- 독자 게시판 응답의 `board`는 `open`일 때만 싣는다(`queued`·`running`은 `null`). 의견 제출 201 `{id}`, 투표·취소·숨김 204.
- 발행은 예약 발행과 같은 경로라 권리 확인을 소유자 이름으로 자동 기록한다(자율 연재를 켠 것을 사전 승인으로 본다).
- 실행 문맥은 최근 발행 3개 회차와 연결 세계관 초안의 활성 카드(관계 제외), 시뮬레이션 문맥은 공개 회차와 독자 설정 위키 카드다.
- AI 읽기 한도: 회차 실행 35분(인물 시뮬레이션 포함 최악 1,810초, `running` 정체 정리는 45분), 시뮬레이션은 기존 생성 한도(`AI_GENERATION_READ_TIMEOUT`). 두 요청에 `creditReservationId`를 싣는다.
- 선택지 문맥은 독자 열람과 같은 공개 회차·독자 설정 위키 카드뿐이고 공개 작품만 만든다(선택지가 회차보다 먼저 독자에게 보이므로). AI 선택지가 4개·300자 규칙에 어긋나면 잘라 쓰지 않고 실패(해제 후 10분 뒤 재시도). 1분 점검은 실행 → 선택지 순서이고 `choices_tried_at`도 실패 이월한다. 추천·취소는 열린 게시판의 숨기지 않은 글만(닫힘 409, 숨김 404), 동시 추천 충돌은 409 `LIKE_CONFLICT`.
- 지금 실행도 그날의 실행으로 기록해 같은 날 일정 실행은 건너뛴다. AI 속도 제한(`ai-rate-limit/acquire`)은 부르지 않는다.
- 운영 회차 제한(2026-11-23, [계약](content-operator-management-contract.md)): 게시판의 대상 회차나 그 앞의 마지막 발행 회차가 운영 제한이면 독자에게는 게시판이 없는 것과 같다. `serial-board`는 `board`·선택지·제안 글이 비고(종합 문장은 그 게시판이 발행한 회차가 제한일 때만 숨김) 투표·제안·추천(취소 포함)은 404다. 일정 점검도 그 게시판의 회차 실행을 건너뛴다: `SerialService.claim`이 작품 잠금 안에서 거절하고 게시판 상태·마감 시각·오늘 실행 기록은 그대로라 제한이 풀린 다음 점검이 재개한다(일정 창 1시간을 넘기면 그날은 건너뜀, 지금 실행으로 `queued`가 된 게시판은 그대로 대기하므로 그동안 집필 방식 끄기는 409 `SERIAL_RUNNING`). 게시판 데이터 삭제·작가 알림은 없다.

## AI 자율 집필 = 집필 방식 (2026-11-22 사용자 결정, 앞 '원고 잠금' 결정을 고침)

- **켜기·끄기는 운영 설정의 집필 방식 하나로 한다.** 집필 방식은 `direct`(직접 집필)·`assisted`(AI 협업 집필)·`autonomous`(AI 자율 집필) 셋이다. `PUT /api/v1/works/{id}/operating-settings`에 `writingMode:"autonomous"`를 저장하면 AI 집필이 켜지고, `direct`·`assisted`로 바꾸면 꺼진다. `WorkSettingsService`가 같은 트랜잭션·작품 잠금 안에서 `work_automation_version` 새 행과 `ai_serial.enabled`를 함께 바꾼다(V44가 `writing_mode` CHECK에 `autonomous`를 더한다). 원고 잠금·실행 판정은 지금처럼 `ai_serial.enabled`를 읽는다.
- 실행 중(`queued`·`running`)에 `autonomous`에서 다른 방식으로 바꾸면 409 `SERIAL_RUNNING`.
- `PUT …/ai-serial`은 요일·시각·방향만 바꾼다. 요청의 `enabled`는 받지 않고(있어도 무시) 응답·`GET`의 `enabled`는 계속 준다. AI 집필 탭의 켜기 토글은 없앤다(탭: 요일·시각·방향·지금 실행·기록).
- **AI 자율 집필 중 작가는 1화만 쓴다.** 1화(sequence 1)의 초안 저장·버전 저장·되돌리기·발행·공개 범위·예약 등록/수정·삭제는 언제나 된다. 새 회차 만들기는 활성 회차가 하나도 없을 때(=1화 만들기)만 된다. 2화부터의 회차 쓰기, 대상이 2화 이후인 작품 단위 저장·발행(`PUT /works/{id}/draft`·`POST /works/{id}/publish`는 대상 회차=마지막 발행+1이 1화면 통과), 원고 가져오기(요청 단위)와 2화 이후 수정 제안 반영은 409 `SERIAL_LOCKED`(`AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요.`). 자율 연재 실행 자신의 저장·발행은 예외다.
- AI는 1화를 쓰지 않는다. 발행된 회차가 없으면 게시판을 열지 않고 '지금 실행'도 409 `SERIAL_NO_BOARD`다(1화 발행 뒤 2화 게시판이 열린다).
- 작품 정보·표지·분기 정책, 세계관·설정집, 댓글·제보 처리, 게시판 의견 숨기기는 막지 않는다. 예약 발행은 2화부터 등록·변경만 막고 취소는 막지 않으며, 켜기 전에 등록된 예약의 실행도 막지 않는다.
- 화면: 집필실은 1화가 아니면 "AI 자율 집필 중" 안내와 읽기 전용, 새 회차 버튼은 1화가 있으면 잠근다. 작품 관리의 회차 목록은 각 회차에서 집필실 그 회차로 바로 가고(1화 외는 잠금·이유), 판정은 서버다. 화면은 켜짐 여부를 열 때와 집필 방식을 저장한 뒤 읽고, 읽는 중·읽기 실패면 잠그지 않는다.
- 켜기 전에 써 둔 2화 이후 초안은 위 '작성 중인 원고' 검사가 계속 지킨다.

## 문맥: 이전 회차 요약 + 관련 장면 검색 (2026-11-22 사용자 결정, C안)

- **원고 색인은 항상 켠다.** `MANUSCRIPT_INDEX_ENABLED` 플래그를 없애고 Content는 늘 Elasticsearch 원고 색인(`ManuscriptIndexConfig`)을 쓴다. local Compose도 Elasticsearch를 항상 띄운다(dev는 이미 켜져 있음). CI·테스트 Compose도 같이 맞춘다.
- **회차 요약**: AI 자율 집필 작품의 공개 회차마다 300자 안팎(≤400자) 요약을 하나씩 둔다. 1분 점검이 요약 없는(또는 발행 버전이 바뀐) 공개 회차를 오래된 회차부터 점검당 최대 3개 AI `POST /internal/v1/serial/summaries`로 만들어 Content `serial_episode_summary(episode_id, version_id, summary, created_at)`에 저장한다(소유자 크레딧, 상한 `SERIAL_SUMMARY_CREDIT_LIMIT` 기본 5(회차 본문 하나가 약 3크레딧), 실패는 다음 점검에 다시).
- **문맥 JSON**(선택지·회차 실행·시뮬레이션 공통 `serialContext`): 작품 제목·소개, **최근 3화 원문**, **그 이전 회차의 요약 전부**(`summaries:[{number, title, summary}]`, 요약이 아직 없는 회차는 빠짐), 설정 카드. 6만 자 한도 안에서 요약이 넘치면 오래된 요약부터 뺀다.
- **관련 장면 검색**(회차 실행만): 1위 선택지 글과 추천 상위 제안 글 제목을 질의로 기존 원고 검색(`ManuscriptQaService`의 벡터 검색 → 발행 원문 재대조, 독자 범위)을 한 번 불러, 최근 3화 이전 회차에서 찾은 인용 최대 6개(각 ≤256자)를 문맥 `related:[{episode, quote}]`로 붙인다. 검색이 실패하면 임의로 빼고 진행하지 않고 실행을 실패(사유 `관련 장면 검색에 실패했습니다.`, 예약 해제)로 끝낸다. 검색 결과가 0개인 것은 실패가 아니다(`related` 빈 목록).
- AI 프롬프트는 `summaries`로 전체 흐름을, `related`로 이어 쓸 옛 장면을 참고하라고 쓴다. AI는 검색·색인을 부르지 않는다(Content가 문맥을 만든다).

## AI 자율 집필 선택 경고 (2026-11-22 사용자 결정)

- 운영 설정에서 집필 방식을 `AI 자율 집필`로 **저장할 때** 확인 대화 상자로 경고한다: 연결된 세계관의 인물 카드로 인물 시뮬레이션을 돌려 회차를 쓰므로 세계관을 연결하고 **인물 카드(성격·말투·목표·관계처럼 인물 페르소나로 쓸 내용)**를 반드시 작성해 달라는 안내(없으면 회차 실행이 실패한다)와 `세계관·설정집으로` 이동, `계속 저장`·`취소`. 취소하면 저장하지 않는다.
- 경고일 뿐 저장을 막지 않는다(서버 검사 없음, 대신 회차 실행이 세계관·인물 카드가 없으면 실패한다). 이미 autonomous인 작품을 다시 저장할 때는 띄우지 않는다.

## 회차 집필은 반드시 인물 시뮬레이션으로 (2026-11-22 사용자 결정)

- 자율 연재 회차 실행은 기존 인물 시뮬레이션 엔진(`app/simulation` + NovelBrain, [계약](character-simulation-contract.md))을 **반드시** 거친다. 순서: 종합 → 기획(1위 선택지 중심, 제안 글 참고) → **인물 시뮬레이션(장면 1개, 대화 없이 끝까지 한 번에 실행 `pausing=False`, 승인 질문 없음)** → 시뮬레이션 장면을 뼈대로 회차 원고 집필(최소 5,000자, 모자라면 분량 재작성 1회) → 검수(+1회 재작성) → 자동 발행. 시뮬레이션을 건너뛰는 대체 경로는 없다.
- 시뮬레이션 계획은 엔진의 `plan`과 같은 계획 모델(`SimulationPlan`)을 쓰되 요청 문장은 1위 선택지와 추천 상위 제안 글로 만든다(제안 글은 제목과 본문 앞 300자, 본문이 없는 `simulation` 글은 장면 앞 300자. 독자 입력이 하나도 없으면 기획의 제목·비트를 요청 문장으로 쓴다). 참여 인물은 연결 세계관의 활성 인물 카드에서 고른다.
- **세계관 입력**: 일정 실행에는 사용자 토큰이 없으므로 AI가 Content MCP를 부르지 않는다. Content가 `/internal/v1/serial/episodes` 요청에 `world`(MCP `world_studio_read(id, episode)`와 같은 모양, 기준 회차 = 직전 발행 회차, 「동일 인물」 관계는 최신 시점으로 `identity`에)를 실어 보내고, AI는 이 값으로 `World`를 만들어 엔진에 넣는다(`read_world` 대신). 연결 세계관이 없으면 Fork가 이어받는 원작 세계관(Content의 기존 이어받기 읽기)을 싣는다.
- **실패**(대체 없이 실행 실패, 예약 해제): 연결·이어받은 세계관이 없음 → `연결된 세계관이 없어 시뮬레이션으로 집필할 수 없습니다.`(Content가 AI 호출 전에 판정), 인물 카드 없음·인물 문서 빈칸·세계관에 없는 인물 등 AI가 409·422와 고정 문장으로 답한 시뮬레이션 실패 → 그 문장 그대로(Content가 공백 정리·300자 상한), 시뮬레이션 장면이 끝나지 않음(502)·시간 초과(504) → 모델 출력이 섞일 수 있어 일반 문구 `AI 생성에 실패했습니다.`.
- 시간·크레딧(구현 결정): 시뮬레이션 단계의 모델 호출(계획·연출·인물 턴·나레이션·검사)도 같은 `creditReservationId`의 `CreditMiddleware`로 센다. `create_agent` 밖에서 도는 엔진은 호출마다 사용량 이벤트(`MODEL_EVENT`)를 알리고 `agent_runtime.CreditLedger`가 그 이벤트를 더하며, 상한 이상이 되면 그 실행을 바로 끝내(402 `CREDIT_LIMIT_EXCEEDED`) 다음 호출과 집필은 없다. 장면 턴 수는 엔진의 기존 상한(인물 대사 12턴·전체 40턴, 턴마다 재생성 최대 2회)을 따르되 호출 하나의 timeout만으로는 최악 시간이 정해지지 않아 장면 전체에 시간 상한 `SIMULATION_TIMEOUT` 1,005초를 둔다(처음 1,200초였고 분량 재작성(#995)이 늘린 195초만큼 줄여 최악 합계를 지킨다)(넘으면 504 `인물 시뮬레이션이 제한 시간 안에 끝나지 않았습니다.`). 최악 합계 = 종합 30 + 기획 50 + 시뮬레이션 계획 40 + 장면 1,005 + 집필 195 + 분량 재작성 195 + 검수 50 + 검수 재작성 195 + 재검수 50 = 1,810초(약 30분)이므로 회차 실행의 Content 읽기 한도를 현재 10분에서 **35분**(2,100초, 여유 290초)으로, 같은 이유로 `running` 정체 정리 기준(`STALE_RUNNING_MINUTES`, 현재 30분)을 **45분**으로 올린다. 크레딧 상한 `SERIAL_EPISODE_CREDIT_LIMIT`은 현재 250에서 **1,000**으로 올린다(추정이며 실측 전이다: 종합·기획·집필·검수·재작성은 문맥이 클 때 최대 약 250, 장면은 턴마다 연출 1회 + 집필·검사 3~7회 호출이고 엔진 평가의 가정 입력 크기(집필 약 8,000·검사 약 20,000토큰)로 보통 300~500크레딧이다. 상한을 넘기는 극단적인 장면은 402로 실패하니 첫 실행 뒤 실제 사용량으로 다시 맞춘다).
- 제안 글의 `simulation` 미리보기는 이번 결정 범위 밖이라 그대로 둔다(한 번 호출 장면 미리보기).
- 운영 설정의 AI 자율 집필 선택 경고 문구는 "세계관 연결 + 인물 카드"가 필요하다는 내용을 담는다.

## 화면 (2026-11-22 사용자 결정)

- 소설 상세(`/work/:id`): `enabled`이면 탭 "회차 | 정보 | 소식" 옆에 **"다음 회차"** 탭을 둔다(페이지 아래에 붙어 있던 의견 영역은 없앤다). 탭 안은 하위 탭 **"투표 | 제안 게시판"**이다.
  - 투표: 대상 회차와 선택지 4개(번호·글·득표)를 보이고 하나를 고른다. 선택지가 없으면 "선택지를 준비하고 있어요", 게시판이 없으면(실행 중) "다음 회차를 쓰고 있어요"와 마지막 종합 문장.
  - 제안 게시판: 게시판 목록(제목·작성자·추천 수·작성 시각, 최신순/추천순)과 글쓰기 버튼. 글을 누르면 본문·미리보기·추천 버튼이 펼쳐진다. 소유자에게는 숨기기 버튼.
  - 비로그인은 읽기만 하고 투표·글쓰기·추천 자리에 로그인 안내.
- 작품 관리 AI 집필 탭: 하위 탭 **"연재 설정"**(요일·시각·방향) | **"게시판 기록"**(지금 마감·실행·기록 새로 고침·기록 표).
  - 꺼져 있으면(집필 방식이 `autonomous`가 아니면) 연재 설정 폼 전체를 `fieldset disabled`로 잠가 흐리게 보이고(입력·저장이 안 된다는 것이 보이게) 안내 상자의 `운영 설정 열기` 버튼이 작품 관리 운영 설정 탭으로 옮긴다. 화면 잠금은 보조이고 서버는 꺼져 있어도 `PUT …/ai-serial`을 받는다(2026-11-23 UI 정리 #754 critique 권장안).
- 작품 관리 개요 히어로(칩 줄, `분기 작품` 칩 옆)·개요 밖 탭 위의 작품 요약(칩 줄, 유형 칩 다음)과 서재 '집필 중인 작품' 카드(공개 범위 칩 뒤): 집필 방식 `AI 자율 집필`이 켜진 작품이면 칩 `AI 자율 연재`를 보인다(2026-11-24 사용자 요청). 켜짐은 소유자 `GET /works/{id}/ai-serial`의 `enabled`이고 원고 잠금과 같은 값(`useSerialLock`)이라 새 API는 없다. 읽는 중·읽기 실패는 칩이 없다(모르는 값을 켜짐으로 꾸미지 않는다). 개요 히어로와 작품 요약은 작품 관리가 이미 읽는 같은 값을 쓰고, 서재는 카드마다 한 번 읽는다(목록 응답에 `enabled`가 실리면 이 요청을 없앤다).

## 범위 밖 (MVP 이후)

독자 설정 카드 추가·변경 제안과 소유자 승인(2026-11-22 사용자 결정으로 제외, 의견은 일반·시뮬레이션만), 다중 서버 분산 잠금, 연속 실패 자동 중단·월 한도, 생성 중지, 실행 실패 알림, 시뮬레이션 보상(작가 승인 시 50%), 독자 인물 시뮬레이션(턴별 진행) 개방. 실행 선점 직후 커밋된 의견·투표는 그 실행에 들어가지 않는다(게시판 단위 직렬화 없음). Core 장애로 정산·해제가 실패하면 재조정 상태를 남기지 않는다(Core 예약 정리 작업 기본 꺼짐).
