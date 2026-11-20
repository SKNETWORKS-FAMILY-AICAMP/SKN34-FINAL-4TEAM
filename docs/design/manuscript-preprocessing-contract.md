# 회차 원고 전처리 계약 (DEC-50)

[결정 목록](decisions.md#결정-목록) DEC-50 · [서비스 경계](service-boundaries.md) · [Content MCP 창구](content-mcp-contract.md)

아래 초기 설계의 Celery·MCP는 제안 당시의 실행 방식이다. #552 통합 후보의 실제 실행 경로와 복구 조건은 [최초 구축 저장 계약](initial-build-storage-contract.md)과 이 문서의 마지막 절을 따른다.

> 2026-11-17 사용자 정정: #344·#351·#428과 Celery/LangGraph는 참고 구현이며 필수 의존성이 아니다. 최신 develop의 저장 경계를 우선한다. 최초 구축의 영속 기록은 [초기 구축 저장 계약](initial-build-storage-contract.md)에 따라 보완 중이며 자동 실행 완료를 의미하지 않는다.

## 목적

작가가 등록한 회차 원고(최소 100화~2,000화 규모)에서 사건·인물·설정을 뽑아 세계관과 회차별 상태로 정리한다.
회차당 LLM 호출이 여러 번이고 전체가 몇 시간 걸리므로 요청 안에서 끝내지 않고 백그라운드 작업으로 실행한다.

## 결정 (2026-11-13 사용자 확정)

| 항목 | 결정 |
|---|---|
| 작업 실행 | AI 서비스에 작업 프레임워크 **Celery**를 추가한다. 브로커는 기존 RabbitMQ를 쓴다. 회차별 추출은 서로 독립인 작업으로 나눠 병렬 실행하고, 정리 단계는 추출이 끝난 뒤 작품당 한 번 순서대로 실행한다 |
| 결과 적재 | 전처리 결과는 **Content MCP 창구로 적재**한다. AI 서비스가 정본 DB에 직접 쓰지 않는다 |
| 승인 시점 | 작가가 전처리 실행을 **시작할 때 한 번 승인**한다. 이 승인으로 전처리부터 적재까지 자동으로 진행한다 |
| 검토 방식 | 후보를 하나씩 승인한 뒤 반영하지 않는다. 작가는 **적재된 결과를 기존 화면에서 보고 수정**한다 |
| 선택하지 않은 안 | Airflow(사용자 요청으로 시작하는 작업이고 순환·사람 대기가 있어 맞지 않음), Content 안 폴러만으로 실행(병렬·재시도·동시 실행 제한을 직접 구현해야 함) |

## 처리 흐름

1. **회차별 추출 (병렬):** 회차마다 LLM 1회로 사건, 묘사(외모·성격·세계관 규칙처럼 사건이 아닌 서술), 거기 등장한 호칭(인물·장소·물건·조직)을 원문 근거와 함께 뽑는다. 호칭은 그 회차 안에서만 통하는 임시 ID를 받고, 다른 회차의 같은 이름과 연결하지 않는다.
2. **정체 정리:** 호칭을 같은 대상끼리 묶어 정식 ID를 준다. 동명이인은 분리한다. 같은 이름만으로 병합하지 않는다. 같은 인물로 보이는 서로 다른 이름(별칭·가면·나중에 밝혀지는 정체)은 한 카드로 병합하지 않고 카드를 따로 둔 채 「동일 인물」 후보로 낸다(DEC-53): 다른 이름 카드 → 본체 카드와 "몇 화부터 같은 인물로 보이는지"를 함께 기록해 앞 회차 상태에 미래 정보가 섞이지 않게 한다. 후보는 관계가 아니며 작가가 승인해야 `identity` 관계가 된다.
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
| 읽을 원문 | 최초 접수 때 고정한 회차별 저장 버전과 해시 |
| 적재 위치 | 작품에 연결된 세계관의 **초안**. 연결 세계관이 없으면 접수 때 새 세계관을 만들어 1:1 연결한다(`work.world_studio_id`). 확정 버전은 작가가 수정 후 직접 남긴다 |
| 실패·재실행 | 추출 실패 회차가 하나라도 있으면 정리 단계 전에 `failed`로 멈추고 실패 회차를 기록한다. 적재는 `jobId`로 멱등(같은 작업의 재호출이 카드를 중복 생성하지 않음) |

### 전처리 MCP 도구 (Content, `jobId` 인증)

| 도구 | 인자 | 결과 |
|---|---|---|
| `preprocessing_episode_read` | `jobId`, `number` | `{number, title, body}` 그 회차 최신 저장 버전 |
| `preprocessing_progress` | `jobId`, `stage`(`extracting/resolving/organizing/loading`), `done`, `total`, `failedEpisodes[]`, `failed`(선택, 고정 사유 문구) | 갱신된 작업 상태 |
| `preprocessing_load` | `jobId`, `cards[]`, `relations[]`, `identityCandidates[]` | 적재 결과(카드 수·관계 수), 작업 `completed` |

`cards[]` 항목: `key`(작업 안 정식 ID), `cardType`(`character/location/organization/object/event`), `title`, `aliases[]`, `body`(마크다운, 인물은 `IDENTITY.md`), `firstEpisode`(첫 등장 회차, 제안값이며 공개 설정이 아니다), 인물만 `characterDocs{soul, goal, episodes{"NN": 글}}`(`memory` 키는 쓰지 않음, 이야기 시작 전 기억은 `episodes{"00"}`)(DEC-47, 문서마다 3,000자 이하). 사건 카드 본문은 회차 번호와 참여 인물을 적는다. 카드는 공개 설정 없이 적재한다: 작가 전용으로 시작하고 `revealFromEpisode`·`visibility`를 쓰지 않는다(DEC-53). `firstEpisode`는 작가가 'N화부터 공개'를 정할 때 보는 제안값으로 카드의 `semanticMetadata.preprocessing`에 두며 독자에게 나가지 않는다.
`relations[]` 항목: `fromKey`, `toKey`, `label`, `fromEpisode`, `ended`(선택). Content가 DEC-51 회차별 관계로 변환해 `fromEpisode` 시점마다 기록한다. 카드 공개는 작가 전용(DEC-53)으로 시작하고 `relations[]`에는 `identity`를 싣지 않는다. 「동일 인물」 후보는 `identityCandidates[]` 항목(`fromKey`: 다른 이름 카드, `toKey`: 본체 카드, `episode`: 같은 인물로 보이는 회차, 근거)으로 따로 싣고 Content가 카드의 `semanticMetadata.preprocessing`에 후보로 남긴다. 후보를 관계로 올리는 것은 작가 승인이다.

원고 정체 추출의 `left`는 본체, `right`는 다른 이름 카드다. 명시적인 근거가 있는 서로 다른 인물 이름은 별도 카드로 유지한다. 다른 이름 카드의 `semanticMetadata.preprocessing.identityCandidates[]`에 두 카드 UUID, 발견 회차, 원문 인용을 보존한다. 승인 전에는 Neo4j 관계를 생성하지 않는다.

## 관련

- [#122](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/122) 원고 기반 설정 추출, [#124](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/124) 회차별 세계관 스냅샷.
- 품질 확인(추출·정체 정리 정확도)은 Celery 없이 스크립트로 먼저 한다(메밀꽃 S01~S04, 4회차).

## 자동 적재 공개 정책 (2026-11-17 확인)

최초 일괄 세계관 구축만 대상으로 한다. 첫 등장 회차는 `semanticMetadata.preprocessing.firstEpisode`에 보존하며, 자동 생성 카드는 `visibility=private`로 저장하고 `semanticMetadata.revealFromEpisode`는 설정하지 않는다. 독자 공개 회차는 작가가 직접 지정한다. 기존 작가 데이터는 변경하지 않는다. 초안 적재·작가의 확정 버전 생성·독자 공개·작품 발행은 별도다. 이전 LoadPayload의 `revealFromEpisode=첫 등장` 의미를 그대로 공개 필드에 연결하지 않는다. 기존 원고 DTO의 `firstAppearanceEpisode`는 Content가 이전 입력을 읽을 때만 허용한다. 이전 카드의 저장값은 소급 변경하지 않는다.

통합 스키마는 develop V1~V12 위에 원고 구축 V13를 적용한다. 원고 구축 SQL이 V9로 기록된 기존 QA DB는 원본을 보존하며, 직접 업그레이드와 데이터 이관은 별도 검증 대상으로 둔다.

## 최초 구축 작업의 상태와 복구

작품 소유자의 접수와 조회에는 기존 V41의 작업 ID와 공개 상태를 사용한다. 운영 감시는 같은 행을 조회한다. WorldStudio V13의 세 테이블은 이 작업에 종속된다.

- `manuscript_build_job`은 동일 ID에 접수 당시 회차, 저장 버전, 해시, 작가와 세계관을 고정한다. 실행권으로 중복 실행을 막는다.
- `manuscript_build_result`는 작업별 회차 추출 근거와 정체 통합 결과를 보존한다. 재실행은 보존된 성공 결과를 재사용한다.
- `manuscript_build_load_step`은 단계별 생성 ID와 요청 payload를 예약하고 적용 receipt를 보존한다. 적재 결과가 불확실하면 감시 상태는 loading이며 소유자 상세에는 unknown을 표시한다. 모든 회차 결과와 단계별 receipt가 확인돼야 completed가 된다.

V13 스냅샷이 없는 구 V41 실패 기록의 동일 ID 재실행은 409 PREPROCESSING_SNAPSHOT_MISSING이다. 읽기나 재개는 새 접수를 발생시키지 않는다. 적재 전 실패라는 근거가 있는 경우에만 작가가 새로 접수할 수 있고 새 ID에 현재 원고를 고정한다. 기존 실패의 진행 이력은 보존한다. 부분 적재 또는 결과 미확인이면 새 접수도 409 PREPROCESSING_LOAD_REVIEW_REQUIRED로 차단한다. 신규 회차 자동 반영과 구 작업 데이터 이관은 별도 범위다.

V41 접수 커밋 직후 중단되어 V13 입력이 비어 있으면 소유자 GET은 기존 queued 기록과 manual_review를 반환한다. 동일 작업 retry와 새 접수는 409 PREPROCESSING_SNAPSHOT_MISSING으로 차단한다. 정상 입력 준비 중에도 일시적으로 같은 상태를 볼 수 있으므로 먼저 GET으로 다시 확인한다. 상태가 계속되면 작업 ID로 원래 입력과 적재 여부를 조사한다. 경과 시간이나 스냅샷 부재만으로 실패 전환·재접수를 허용하지 않는다.
