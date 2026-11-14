# 회차 원고 전처리 계약 (DEC-50)

[결정 목록](decisions.md#결정-목록) DEC-50 · [서비스 경계](service-boundaries.md) · [Content MCP 창구](content-mcp-contract.md)

상태: **결정·실행 계약 기록. Celery·전처리 코드·MCP 전처리 도구는 미구현([#343](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/343)).**

## 목적

작가가 등록한 회차 원고(최소 100화~2,000화 규모)에서 사건·인물·설정을 뽑아 세계관과 회차별 상태로 정리한다.
회차당 LLM 호출이 여러 번이고 전체가 몇 시간 걸리므로 요청 안에서 끝내지 않고 백그라운드 작업으로 실행한다.

## 결정 (2026-11-13 사용자 확정)

| 항목 | 결정 |
|---|---|
| 작업 실행 | AI 서비스에 작업 프레임워크 **Celery**를 추가한다. 브로커는 기존 RabbitMQ를 쓴다. 회차별 추출은 서로 독립인 작업으로 나눠 병렬 실행하고, 정리 단계는 추출이 끝난 뒤 작품당 한 번 순서대로 실행한다 |
| 구현 방식 | Celery task 1개(접수 1건)가 LangGraph `StateGraph`(체크포인터 없음)를 실행한다. 회차별 추출은 `Send`로 병렬, 실패 회차가 있으면 정리 전에 종료한다. 모델 호출은 LangChain `langchain-openai`의 `ChatOpenAI.with_structured_output`(strict, 재시도 0). 2026-11-13 사용자 결정(#344) |
| 결과 적재 | 전처리 결과는 **Content MCP 창구로 적재**한다. AI 서비스가 정본 DB에 직접 쓰지 않는다 |
| 승인 시점 | 작가가 전처리 실행을 **시작할 때 한 번 승인**한다. 이 승인으로 전처리부터 적재까지 자동으로 진행한다 |
| 검토 방식 | 후보를 하나씩 승인한 뒤 반영하지 않는다. 작가는 **적재된 결과를 기존 화면에서 보고 수정**한다 |
| 선택하지 않은 안 | Airflow(사용자 요청으로 시작하는 작업이고 순환·사람 대기가 있어 맞지 않음), Content 안 폴러만으로 실행(병렬·재시도·동시 실행 제한을 직접 구현해야 함) |

## 처리 흐름

1. **회차별 추출 (병렬):** 회차마다 LLM 1회로 사건, 묘사(외모·성격·세계관 규칙처럼 사건이 아닌 서술), 거기 등장한 호칭(인물·장소·물건·조직)을 원문 근거와 함께 뽑는다. 호칭은 그 회차 안에서만 통하는 임시 ID를 받고, 다른 회차의 같은 이름과 연결하지 않는다.
2. **정체 정리:** 호칭을 같은 대상끼리 묶어 정식 ID를 준다. 동명이인은 분리하고 별칭은 병합한다. 같은 이름만으로 병합하지 않는다. 정체가 나중에 밝혀지는 경우는 병합에 "몇 화부터 같은 대상으로 보는지"를 함께 기록해 앞 회차 상태에 미래 정보가 섞이지 않게 한다.
3. **사건 등록:** 사건의 호칭을 정식 ID로 바꿔 회차 순서대로 정리한다.
4. **인물별 정리:** 인물이 나온 사건과 묘사를 모아 프로필·상태·기억을 구성한다.
5. **설정·아이템 정리:** 장소·물건·조직을 4와 같은 방식으로 정리한다.
6. **적재:** 정리 결과를 Content MCP 도구로 세계관과 회차별 상태에 적재한다.

3~6단계는 1·2단계 결과만 읽는다. 작가가 정체 묶음을 고치면 원문을 다시 읽히지 않고 3단계부터 다시 실행할 수 있다.
전체 스토리를 먼저 훑는 참고 단계를 두더라도 그 결과(미래 회차 정보 포함)는 추출 참고용으로만 쓰고 회차별 상태에 넣지 않는다.

## 책임

- **Content:** 실행 승인 접수, 작품·회차 소유권 확인, MCP 도구를 통한 적재 시 검증·저장, 작가 수정.
- **AI 서비스:** Celery 작업 실행, 추출·정리, 진행 상태, 완료 후 MCP 적재 호출.
- **Core:** 기존대로 인증. 크레딧 비용 안내·동의(UC-03 A3)는 기존 크레딧 계약을 따른다.

## 실행 계약 (2026-11-13, [#343](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/343))

화면 진입점은 작품 관리의 **[세계관 만들기]** 버튼이다. 이번 범위는 최초 구축만이고, 새 회차 증분 반영은 후속이다.

| 항목 | 결정 |
|---|---|
| 접수 | 화면 → Content `POST /api/v1/works/{id}/world-preprocessing`(소유자만, 저장 회차 0개 422, 진행 중·완료 작업 409) → AI `POST /internal/v1/preprocessing/jobs`(`X-Internal-Token`, 본문 `{jobId, workId, episodes:[회차 번호]}`, 202). Kotlin은 Celery 메시지를 직접 만들지 않는다. 같은 `jobId` 재접수는 실패 회차만 다시 실행한다 |
| 작업 기록·진행 상태 | Content 작업 테이블(작업 ID·작품·세계관·회원·상태 `queued/running/loading/completed/failed`·완료 수/전체 수·실패 회차·시각). 화면은 `GET /api/v1/works/{id}/world-preprocessing`만 조회한다. Celery 결과 저장소와 AI DB는 쓰지 않는다 |
| 백그라운드 인증 | 전처리 MCP 도구는 사용자 Bearer 대신 `X-Internal-Token` + 도구 인자 `jobId`로 호출한다. Content는 그 작업이 진행 중(`queued/running/loading`)일 때만 받아들이고 작업에 기록된 회원 권한으로 기존 Service를 호출한다. 종료된 작업 ID는 거절한다 |
| 읽을 원문 | 회차별 최신 저장 버전 |
| 적재 위치 | 작품에 연결된 세계관의 **초안**. 연결 세계관이 없으면 접수 때 새 세계관을 만들어 1:1 연결한다(`work.world_studio_id`). 확정 버전은 작가가 수정 후 직접 남긴다 |
| 실패·재실행 | 추출 실패 회차가 하나라도 있으면 정리 단계 전에 `failed`로 멈추고 실패 회차를 기록한다. 적재는 `jobId`로 멱등(같은 작업의 재호출이 카드를 중복 생성하지 않음) |

### 전처리 MCP 도구 (Content, `jobId` 인증)

| 도구 | 인자 | 결과 |
|---|---|---|
| `preprocessing_episode_read` | `jobId`, `number` | `{number, title, body}` 그 회차 최신 저장 버전 |
| `preprocessing_progress` | `jobId`, `stage`(`extracting/resolving/organizing/loading`), `done`, `total`, `failedEpisodes[]`, `failed`(선택, 고정 사유 문구) | 갱신된 작업 상태 |
| `preprocessing_load` | `jobId`, `cards[]`, `relations[]` | 적재 결과(카드 수·관계 수), 작업 `completed` |

`cards[]` 항목: `key`(작업 안 정식 ID), `cardType`(`character/location/organization/object/event`), `title`, `aliases[]`, `body`(마크다운, 인물은 `IDENTITY.md`), `revealFromEpisode`(첫 등장 회차), 인물만 `characterDocs{soul, memory, episodes{"NN": 글}}`(DEC-47, 문서마다 3,000자 이하). 사건 카드 본문은 회차 번호와 참여 인물을 적는다.
`relations[]` 항목: `fromKey`, `toKey`, `label`, `fromEpisode`, `ended`(선택). Content가 DEC-51 회차별 관계로 변환해 `fromEpisode` 시점마다 기록한다. 카드 공개 여부는 기본 비공개(DEC-46) 그대로다.

## 관련

- [#122](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/122) 원고 기반 설정 추출, [#124](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/124) 회차별 세계관 스냅샷.
- 품질 확인(추출·정체 정리 정확도)은 Celery 없이 스크립트로 먼저 한다(메밀꽃 S01~S04, 4회차).
