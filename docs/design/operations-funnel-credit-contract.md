# 운영 개요 퍼널 지표·크레딧 운영·이벤트 이동 계약 (DEC-57)

관리자 화면 세 곳을 실제 API로 바꾼다. 정본은 그대로 각 소유 서비스에 두고 운영 서비스는 중계·권한·활동 기록만 맡는다(DEC-41).

## 결정 (2026-11-20 사용자 결정)

- 개요(`data`) 첫 화면에 [#650](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/650) 1번 사용자 여정 퍼널 지표를 붙인다. 집계 기간은 **전체 기간 고정**이다.
- 크레딧 탭: 운영자는 회원의 잔액·내역 **조회와 수동 지급·회수**를 한다. 사유는 필수이고 활동 기록에 남긴다.
- 이벤트 안내에서 관련 기능으로 이동한다(기능표 70).
- 캐릭터챗 탭은 이번 범위가 아니다(데모 유지).

## 1. 퍼널 지표 (Content 집계 → 운영 대시보드)

Content `GET /internal/v1/operations/funnel`(운영 서비스 토큰 체인, 파라미터 없음, 전체 기간)이 수만 세어 돌려준다.
운영 `GET /api/v1/operations/dashboard` 응답에 `funnel`로 그대로 싣고, Content가 실패하면 `funnel: null` + `unavailable`에 `content`(기존 규칙).
비율·오차는 화면이 계산한다(분모 0이면 `—`). 오차는 95% 최악 기준 `±1/√n`(%p)이며 모든 비율 옆에 `n`과 함께 적는다.

| 칸 | 정의 (회원 수는 서로 다른 회원 ID) |
|---|---|
| `readers.viewed` | 작품 상세를 조회한 회원 수(조회 기록에 회원이 있는 것만) |
| `readers.readAny` | 회차를 하나 이상 읽은 회원 수 |
| `readers.readNext` | 같은 작품에서 회차를 둘 이상 읽은 회원 수 |
| `reactions.publishedEpisodes` | 현재 발행된 회차 수(삭제 작품 제외, Fork가 물려받은 원작 회차는 빼고 각 작품이 직접 발행한 회차만) |
| `reactions.likes`·`interests`·`comments` | 좋아요·관심·회차 댓글 수(삭제·숨김 제외) |
| `forks.readers` | `readers.readAny`와 같은 집단 |
| `forks.readerForked` | 그중 Fork 작품을 하나 이상 만든 회원 수 |
| `forks.baseEpisodes` | Fork 기준 회차 분포: `1`·`2`·`3`·`4-5`·`6-10`·`11+` 구간별 Fork 수 |
| `writers.forks` | Fork 작품 수(삭제 제외) |
| `writers.saved` | 그중 Fork 작가가 직접 저장한 원고 버전이 하나 이상 있는 수 |
| `writers.published` | 그중 Fork 작가가 직접 발행한 회차가 하나 이상 있는 수 |
| `writers.medianHoursToPublish` | Fork 생성 → 첫 직접 발행까지 시간의 중앙값(소수 1자리, 발행 0건이면 `null`) |
| `proposals.adopted`·`total` | AI 제안 채택 수 / 생성 수(기존 stats와 같은 정의, 전체 기간) |
| `feedback.approved`·`decided` | 수정 제안 승인 / 승인+거절(기존 stats와 같은 정의, 전체 기간) |

세는 곳(Content `OperationsFunnelService`, 값마다 JPQL 쿼리 하나, 삭제된 작품은 `work.deleted_at`(DEC-42)로 거른다):

| 칸 | 세는 곳·조건 |
|---|---|
| `readers.viewed` | `work_view`(공개 회차를 열 때 회원·회차·날짜별로 남기는 조회 기록, 작품 상세만 연 조회를 따로 남기는 표는 없다)의 서로 다른 `member_id`. 비회원 조회는 기록되지 않아 빠지며 작품 삭제는 거르지 않는다. |
| `readers.readAny` | `reading_episode`(회원이 연 회차)의 서로 다른 `member_id`. 삭제된 작품을 읽은 회원도 센다. |
| `readers.readNext` | `reading_episode`에서 같은 `work_id`의 다른 `episode_number` 행이 더 있는 서로 다른 `member_id`(같은 회차를 다시 열어도 한 행). |
| `reactions.publishedEpisodes` | `episode_current` 중 발행 버전이 있고 물려받은 회차가 아닌(`inherited = false`) 행(삭제한 회차는 뷰가 뺀다)이며 삭제되지 않은 작품의 것. Fork가 물려받은 원작 회차는 같은 회차가 Fork 수만큼 되풀이해 세어지므로 빼고 각 작품이 직접 발행한 회차만 센다. |
| `reactions.likes`·`interests` | `work_like`·`work_interest` 행 수, 삭제되지 않은 작품의 것. |
| `reactions.comments` | `episode_comment` 중 `deleted_at`이 없고 `hidden = false`이며 삭제되지 않은 작품의 것. |
| `forks.readers` | `readers.readAny`와 같은 쿼리 결과. |
| `forks.readerForked` | 삭제되지 않은 Fork(`fork`·`work`)의 `owner_id` 중 `reading_episode`에 기록이 있는 서로 다른 회원. |
| `forks.baseEpisodes` | 삭제되지 않은 Fork를 `fork.source_checkpoint_id`→`checkpoint.episode_id`→`episode.sequence`(Fork를 만들 때 고정한 원작 회차 번호)별로 센 뒤 여섯 구간으로 합친다. 배열 `[{bucket, count}]`이며 구간 순서는 `1`·`2`·`3`·`4-5`·`6-10`·`11+` 고정이고 Fork가 없는 구간도 `count: 0`으로 싣는다. |
| `writers.forks` | 삭제되지 않은 Fork 작품 수(`fork`·`work`). |
| `writers.saved` | 그중 Fork 자기 회차(`episode.work_id`)에 `episode_version.is_saved = true`가 있는 수. 물려받은 회차의 복사본은 `is_saved = false`라 빠진다. |
| `writers.published` | 그중 Fork 자기 회차 버전에 `publication_event`(`outcome = 'applied'`, `action`이 `publish`·`republish`·`replace`)가 있는 수. 물려받은 회차는 발행 기록이 없어 빠진다. |
| `writers.medianHoursToPublish` | 위 Fork마다 `fork.created_at`→첫 발행 기록의 `occurred_at`(시간 단위)을 서비스에서 정렬해 중앙값(짝수 개는 가운데 둘의 평균)을 소수 1자리로 맞춘다. 발행한 Fork가 없으면 `null`. 발행한 Fork 수만큼 행을 읽는 시연 규모 구현이다. |
| `proposals.adopted`·`total` | 운영 통계(`OperationsStatsService.proposalDecisions`)를 `1970-01-01`~요청 시각으로 호출: `ai_proposal.created_at`이 그 안인 제안 수(`total`)와 그중 `proposal_decision.decision = 'accept'`가 있는 수(`adopted`). |
| `feedback.approved`·`decided` | 운영 통계(`OperationsStatsService.editSuggestions`)를 같은 기간으로 호출: `edit_suggestion.decided_at`이 그 안인 `approved` 수와 `approved`+`rejected` 수(보류는 결정이 아님). |

응답 모양: `{ readers: {viewed, readAny, readNext}, reactions: {publishedEpisodes, likes, interests, comments}, forks: {readers, readerForked, baseEpisodes: [{bucket, count}]}, writers: {forks, saved, published, medianHoursToPublish}, proposals: {adopted, total}, feedback: {approved, decided} }`(`medianHoursToPublish`는 값이 없어도 키가 있고 `null`이다).

수익(크레딧 사용·원작자 몫)과 사용성(SUS·과제 성공률)은 DB 퍼널이 아니라 이 화면에 두지 않는다(#650 2번·설문으로 다룬다).

화면: 개요는 위에서부터 요약 카드 띠(회원·AI 요청·작업·미처리 업무·경고) → "서비스 지표(전체 기간)" 구역 → 최근 7일 AI 사용 차트 순이다. 서비스 지표 구역은 단계 막대 4묶음(독자 조회→1화 이상→이어 읽기, 독자→Fork, Fork→저장→발행, AI 채택·피드백 반영)과
회차당 반응(좋아요·관심·댓글 ÷ 발행 회차), Fork 기준 회차 분포 막대. 기존 `recharts`만 쓴다. 시연 데이터임을 작은 글씨로 적는다.

## 2. 크레딧 운영 (Core 정본 → 운영 중계)

권한: 운영자(`operator`) + 운영 권한 `credits`. 회원 찾기는 기존 사용자 탭 회원 검색 API를 그대로 쓴다.

| 운영 공개 API (`/api/v1/operations/credits`) | 동작 |
|---|---|
| `GET /members/{memberId}` | 잔액(종류별 포함)과 내역(Core `history`와 같은 모양) |
| `POST /members/{memberId}/grants` `{amount, reason}` | 수동 지급 → 201, 갱신된 잔액 |
| `POST /members/{memberId}/revocations` `{amount, reason}` | 수동 회수 → 201, 갱신된 잔액 |

- `amount`: 정수 1~100,000. `reason`: 앞뒤 공백 제거 후 1~200자. 위반은 422.
- 지급은 새 지급 종류 `operator`(Core `CreditKind.OPERATOR`)로 남기고 만료는 `reward`와 같다.
- 회수는 쓸 수 있는 잔액 안에서만 된다(넘으면 409 `CREDIT_INSUFFICIENT`, 아무것도 바꾸지 않음). 만료가 가까운 지급부터 차감하고
  원장 종류는 `revoke`(사용 `spend`와 구분), `operation_key`는 `operator-revoke:<새 UUID>`다.
- 없는 회원은 404. Core 실패는 502 `UPSTREAM_FAILED`(기존 운영 공통).
- Core 내부 API(운영 서비스만, 인증은 `/internal/v1/members/**`와 같은 `X-Operations-Service-Token` + 운영자 Bearer 전달, Core가 `operator` 재확인):
  `GET /internal/v1/credits/members/{memberId}` → `{"balance":{"total","items":[{"kind","remaining","expiresAt"}]},"history":{"items":[{"type":"grant|spend|expire|revoke","kind","amount","occurredAt"}]}}`,
  `POST …/{memberId}/grants`·`…/revocations` `{"amount","reason"}` → 201 갱신 잔액 `{"total","items"}`. 오류는 problem+json `code` `CREDIT_INSUFFICIENT`(409)·`INVALID_CREDIT_REQUEST`(422), 404는 본문 없음. 운영은 응답을 그대로 중계한다.
- 회원 본인 내역(`/me/credits/history`)에도 `revoke`(회수, −)와 지급 종류 `operator`(운영자 지급 크레딧)가 나온다.
- 활동 기록: `CREDIT_GRANT`·`CREDIT_REVOKE`(대상 회원 ID, 금액, 사유). 지급·회수가 성공한 뒤에만 남긴다.
- 화면: 크레딧 탭 데모를 지우고 회원 검색 → 잔액·내역 표 → 지급·회수 폼(금액·사유, 확인 대화). 처리 중 버튼을 잠근다.
- ponytail: 요청 중복 방지 키가 없다. 버튼 잠금으로만 막으며, 네트워크 재시도로 두 번 들어갈 수 있다. 필요하면 요청 ID를 받는다.

## 3. 이벤트 이동 (기능표 70)

- 운영 이벤트에 선택 칸 `linkPath`(operations Flyway V10 `event.link_path`, null 허용)를 더한다.
  `/`로 시작하는 사이트 안 경로만 받는다(`//`·`://`·백슬래시·공백 불가, 200자 이하, 위반 422). 외부 URL은 받지 않는다.
- 관리자 이벤트 등록·수정 폼에 "이동 경로(선택)" 입력. 회원에게 보이는 이벤트 안내는 `linkPath`가 있으면 "바로 가기" 버튼으로 그 경로로 이동한다.

## 실행 연결

- nginx·Vite: `/api/v1/operations/credits`와 하위 경로를 Operations로.
- 운영 `MemberSecurityConfig` 경로 목록에 `credits` 추가.
