# 운영 대시보드·LLMOps·작업 감시 계약 (DEC-55)

[결정 목록](decisions.md#결정-목록) DEC-55 · [서비스 경계](service-boundaries.md) · [운영 회원·관리자 계약](operations-member-report-contract.md) ·
[활동 기록 계약](operations-admin-activity-contract.md) · [회차 원고 전처리 계약](manuscript-preprocessing-contract.md) · [알림 사건 계약](../notification-event-contract.md)

기능표 운영 관리 서비스 **85 업무·데이터 현황**, **40-A~E LLMOps**, **35 일정·실행 관리**의 계약이다.
관리자 화면 `data`(대시보드)·`llm`(LLMOps)·`jobs`(작업 감시) 탭을 메모리 데모에서 실제 API로 바꾼다.

## 결정 (2026-11-19 사용자 결정)

| 항목 | 결정 |
|---|---|
| LLMOps 정본 | **Langfuse**(self-host). LangSmith가 주는 추적·세션·프롬프트 버전·데이터셋·실험·점수·비용을 Langfuse로 채우고 Spring으로 재구현하지 않는다. DEC-18의 'MVP 이후'를 이 결정으로 바꾼다 |
| 화면 방식 | **우리 운영 화면이 API로 통합**한다. 운영 서비스가 Langfuse Public API를 중계·집계하고 실행 단계 상세까지 우리 화면에 보인다(Langfuse 화면 링크 없음) |
| 배치 | Langfuse를 로컬·dev·prod Compose에 포함한다(웹·worker·ClickHouse·Redis·MinIO·Postgres; 로컬은 루트 `compose.yaml`의 별도 include로 항상, #606). 웹은 개발자용 별도 포트(로컬 `:3000`)로만 연다 |
| Langfuse 화면 | 관리자는 Langfuse 웹에 들어가지 않는다. 데이터는 운영·AI 서비스가 프로젝트 API 키로만 읽고 쓴다. Langfuse 웹은 개발자가 초기 관리자 계정(`LANGFUSE_INIT_*`)으로만 쓴다(2026-11-19 사용자 결정, OIDC 로그인 안 함) |
| 회원 식별 | trace의 `user_id`에 **회원 UUID**를 남긴다. 이메일·닉네임·키는 계속 남기지 않는다(2026-11-13 팀 결정의 보완) |
| 경고 기준 | 기준값은 문서로 고정하지 않고 **운영 화면에서 관리자가 정한다**. 초기 행은 꺼진 상태로 시드하고 값을 넣어 켠다 |
| 평가 | 회귀 평가는 AI 서비스의 **Ragas**(Q&A RAG)·**DeepEval**(생성·검토·누설 판정)로 채점하고 결과를 Langfuse Dataset Run 점수로 남긴다. 1회 비용 상한은 **추후 결정**(그 전까지 상한 없음, 평가는 관리자가 직접 실행할 때만 돈다) |
| 작업 감시 | 회차 원고 전처리(DEC-50, 100화 이상 작품의 회차를 하나씩 전처리해 세계관 카드를 만드는 Celery 작업)·운영 정기 작업·회귀 평가 실행을 한 화면에서 본다. 실제 실행은 업무 소유 서비스(운영 정기 작업은 AI 작업 워커가 운영의 execute API를 불러 실행, [작업 실행 이관](operations-funnel-credit-contract.md#4-작업-실행을-celery로-이관-리팩터링-2026-11-20-사용자-결정)), 감시·재실행 요청은 운영(F-JOB-01). 평가 실행은 작업 감시에서 재실행하지 않는다 |
| Airflow | 지금은 쓰지 않는다. 운영 스케줄러가 맡는 '정해진 시각에 소유 서비스의 실행 API 호출'과 '실행 기록 조회'를 나중에 Airflow DAG·REST API로 바꿀 수 있게 실행 API와 기록 모양을 출처 독립으로 둔다 |

## 데이터 출처

| 화면 값 | 정본 | 읽는 경로 |
|---|---|---|
| 회원 수(전체·최근 7일 가입·탈퇴 유예) | Core `auth_member` | Core `GET /internal/v1/members/stats`(운영 서비스 토큰 + 관리자 Bearer) |
| AI 요청 수·실패·시간 초과·지연·토큰·비용 | Langfuse trace·observation | 운영 → Langfuse `GET /api/public/metrics`, `GET /api/public/traces` |
| 사용자 부담 비용 | Core 크레딧 예약 확정 + trace metadata `credit_reservation_id` | 확정된 예약이 붙은 trace의 비용 합. 아직 AI 요청이 크레딧을 차감하지 않으므로 지금은 전부 플랫폼 부담으로 나온다 |
| 답변 대기 문의·접수 신고 | 운영 DB | 운영 Repository |
| 작가 검토 대기(확인 전 제보 `unchecked`·대기 수정 제안 `pending`) | Content | Content `GET /internal/v1/operations/stats` |
| 제안 채택률·수정안 승인률 | Content 제안(기간 내 생성 제안 중 채택된 비율)·수정 제안 승인(결정 중 승인) | 같은 Content 통계 API(`from`·`to`) |
| 필터 복원률 | 콘텐츠 필터 기능(미구현) | 필터가 생기기 전까지 `null`, 화면은 '데이터 없음' |
| 전처리 작업 진행 | Content 전처리 작업 테이블(DEC-50 계약) | Content `GET /internal/v1/preprocessing-jobs` |
| 정기 작업 일정·실행 기록 | 운영 DB | 운영 Repository |
| 회귀 평가 실행 기록 | Langfuse Dataset Run | 운영 `EvaluationService`가 평가 화면과 같은 읽기로 최신 50개(권한은 `jobs`로 이미 확인) |
| 경고·조치 기록 | 운영 DB | 운영 Repository |
| 프롬프트·모델 버전, 평가 결과 | Langfuse Prompt·Model·Dataset | 운영 → Langfuse Public API |

## AI 서비스 계측 규칙

- 모든 AI 기능(오케스트레이션·Q&A·Writing·Manuscript Review·Rating·World·Research·Decision Guard·전처리·인물 시뮬레이션·초기 세계관)의
  요청 하나가 trace 하나다. trace에 `user_id`(회원 UUID), `session_id`(대화·작업 ID), `tags=[feature:<기능 키>, status:<success|failed|timeout>]`,
  metadata `request_id`·`work_id`·`fork`(Fork 작품 요청이면 true)·`credit_reservation_id`(있을 때)를 단다.
- 모델 호출 observation은 `generation`으로 남기고 `model`·`usage`(입력·출력 토큰)를 넣는다. 비용은 Langfuse 모델 단가 정의로 계산한다.
- 프롬프트는 Langfuse Prompt Management에서 `production` 라벨 버전을 읽고 generation에 그 prompt를 연결한다(사용 버전 조회의 근거).
  코드의 프롬프트는 최초 등록용 시드다: 처음 읽을 때 Langfuse에 없으면(404) 버전 1(`production`)로 등록한다. 이름은 `<기능>.<용도>`(예 `story_context.answer`, `orchestration.main`).
  Langfuse 키가 없으면(로컬·CI) 추적과 같이 꺼지고 코드 프롬프트를 그대로 쓴다. 키가 있는데 읽기에 실패하면 SDK 캐시(마지막 성공 값)를 쓰고, 캐시도 없으면 503으로 실패한다.
- 시간 초과는 `status:timeout`, 그 밖의 실패는 `status:failed`와 observation `level=ERROR`다. 대기(`waiting`) 턴·취소·연결 끊김은 상태 태그를 달지 않는다.
- 회원 UUID는 Content가 넘기는 작가 Bearer(`X-User-Authorization`)의 `sub`에서 읽고(추적 전용, 인가에 쓰지 않음), `request_id`는 AI가 HTTP 요청마다 발급한다. `fork`는 Content가 오케스트레이션 `target.fork`로 알린다. 요청 루트 trace에는 본문을 남기지 않고 generation observation이 입출력을 갖는다.
- 회귀 평가 결과는 Run 수준 점수다: 지표 평균(NUMERIC, metadata `baseline`·`delta`·`tolerance`)과 `passed`(BOOLEAN). `passed`가 없으면 실행 중이고, 시작 후 2시간이 지나도 없으면 운영 화면은 실패로 본다.

## 운영 공개 API (회원 Bearer, Core `operator=true`)

모든 경로는 `/api/v1/operations` 아래다. 권한 키는 V4 시드에 이미 있는 것을 쓰며 새 키는 없다.

| 메서드·경로 | 권한 | 내용 |
|---|---|---|
| `GET /dashboard` | 운영자 누구나 | 회원 수, 오늘·7일 AI 요청·실패율·비용(사용자/플랫폼), 진행 중 작업 수, 답변 대기 문의·접수 신고·작가 검토 대기, 미확인 경고 수. 출처 하나가 실패하면 그 칸만 `null` + `unavailable:[출처]`(나머지는 보인다, 실패를 0으로 바꾸지 않는다). 요청 0건이면 `failureRate`는 `null` |
| `GET /llmops/traces?from&to&feature&status&userId&requestId&page` | `llm` | trace 목록(시각·기능·상태·지연·토큰·비용), `requestId`는 metadata `request_id` 일치 |
| `GET /llmops/traces/{id}` | `llm` | 단계별 observation(이름·시각·지연·모델·토큰·level), 입력·출력 본문 |
| `GET /llmops/metrics?from&to&groupBy=day|feature|model` | `llm` | 요청·실패율·시간 초과율·p50/p95 지연·토큰·비용(사용자/플랫폼)·채택률·승인률·필터 복원률 |
| `GET /llmops/prompts`, `GET /llmops/prompts/{name}` | `llm` | 프롬프트별 버전·라벨·최신 평가 결과 |
| `POST /llmops/prompts/{name}` | `llm` | 새 버전 등록(라벨 없음) |
| `PUT /llmops/prompts/{name}/production` `{version}` | `llm` | `production` 라벨 이동(승격·이전 버전 복원). 그 버전의 최신 회귀 평가가 통과가 아니면 409 `EVALUATION_REQUIRED`(화면은 code로 한국어 안내) |
| `GET /llmops/models`, `POST /llmops/models` | `llm` | Langfuse 모델 정의(이름·매칭 패턴·입력/출력 단가) 조회·등록 |
| `GET /llmops/evaluations`, `GET /llmops/evaluations/{runId}` | `llm` | Dataset Run 목록·상세(지표별 점수, 기준 버전 대비 차이, 통과 여부) |
| `POST /llmops/evaluations` `{dataset, prompt, version}` | `llm` | 회귀 평가 실행 요청(AI에 위임, 202 + 실행 기록 ID) |
| `GET /llmops/leak-checks` | `llm` | 정보 누설 표본 검사 결과·의심 건 |
| `GET /alerts?status=open|acknowledged|resolved` | `llm` 또는 `jobs` | 경고 목록(최신 100개) |
| `PUT /alerts/{id}` `{status, note}` | `llm` 또는 `jobs` | 확인·조치 완료 기록 |
| `GET /alerts/rules`, `PUT /alerts/rules/{key}` `{threshold, windowMinutes, enabled}` | `llm` | 경고 기준값 설정 |
| `GET /llmops/settings`, `PUT /llmops/settings` `{leakSampleRate}` | `llm` | 누설 검사 표본 비율(0~1, 기본 0.1) |
| `GET /jobs/runs?status&kind&page` | `jobs` | 전처리 작업 + 운영 정기 작업 + 회귀 평가 실행 기록(같은 모양). 앞쪽 1,000건까지만(`(page+1)*size > 1000`이면 400). 출처 하나를 읽지 못하면(Content·Langfuse) 나머지는 보이고 `unavailable`에 그 출처 이름(`content-preprocessing`·`ai-evaluation`)을 적는다 |
| `POST /jobs/runs/{id}/retry` | `jobs` | 실패 작업 수동 재실행 요청(전처리는 Content 재접수 = 실패 회차만, 운영 정기 작업은 새 `queued`·`manual` 기록을 AI 작업 워커에 접수시킨다). 평가 실행은 대상이 아니다 |
| `GET /jobs/schedules`, `POST /jobs/schedules`, `PUT /jobs/schedules/{id}`, `DELETE /jobs/schedules/{id}` | `jobs` | 정기 작업 일정 등록·조회·변경·취소(취소는 `enabled=false` 소프트). PUT은 `{kind,cron,enabled,params}` 전체 교체이며 종류 변경은 422 |

실행 기록 모양(출처 독립): `{id, kind, source, status(queued|running|succeeded|failed|cancelled), trigger(schedule|manual|user), progress{done,total}, startedAt, finishedAt, error, targetId}`.
`source`는 `operations-scheduler`·`content-preprocessing`·`ai-evaluation`이고 Airflow를 붙이면 `airflow`가 더해진다.
회귀 평가 실행(Langfuse Run)은 `kind=evaluation`, `id`·`targetId`=Run 이름, `startedAt`=Run 생성 시각, `trigger=manual`(Run은 요청 주체를 모르고 일정으로 시작한 평가는 `regression_eval` 기록이 따로 있다), 끝난 시각·진행률은 없고,
`status`는 평가의 `running|completed|failed`를 `running|succeeded|failed`로 옮기며(통과 여부와 무관, 실패는 고정 `error`: 시작 후 2시간이 지나도 결과 점수가 없는 Run) 최신 Run 50개까지다.

작업 감시 오류 규칙: 일정 등록·변경에서 등록되지 않은 `kind`, 바뀐 `kind`, 읽을 수 없거나 100자를 넘거나 다시 도래하지 않는 `cron`은 모두 422다(형식이 틀린 본문은 400, 없는 일정은 404). 재실행은 운영 정기 작업의 실패한 기록만 새 `queued`·`manual` 기록 하나로 접수해 AI 작업 워커에 접수시킨다(202, queued 기록이 커밋된 뒤에 접수시킨다. AI가 받지 않으면 그 기록은 failed+고정 사유로 남고 502). 실패가 아닌 기록, 그 일정에 진행 중(`queued`·`running`) 기록이 있을 때, **이미 재실행된 기록은 재실행 결과(성공·실패)와 무관하게 409**다. 재실행으로 생긴 새 기록이 실패하면 그 기록은 다시 재실행할 수 있다.

### 응답 모양 (JSON, 시각은 ISO-8601 UTC, 비용은 USD 숫자)

```text
Dashboard { members{total,joinedLast7Days,withdrawalPending}?, ai{today:AiSummary, last7Days:AiSummary}?,
            jobs{running,failedLast24h}?, pending{inquiries,reports,authorReviews}?, openAlerts?, unavailable:[string] }
AiSummary { requests, failed, timeouts, failureRate?, costUser, costPlatform }
TraceItem { id, timestamp, feature, status, latencyMs, inputTokens, outputTokens, cost, userId?, workId? }
TraceDetail { ...TraceItem, input?, output?, observations:[{id,name,type,startTime?,endTime?,latencyMs,model?,inputTokens?,outputTokens?,level,statusMessage?,promptName?,promptVersion?}] }
Page<T> { items:[T], page, size, total }
MetricRow { key(날짜·기능·모델), requests, failureRate?, timeoutRate?, p50LatencyMs?, p95LatencyMs?, inputTokens, outputTokens, costUser, costPlatform }
Metrics { rows:[MetricRow], adoptionRate?, approvalRate?, filterRestoreRate? }   // 비율은 0~1, 데이터 없으면 null. 끝난 요청이 없으면 AiSummary·MetricRow의 실패율·시간 초과율·지연도 null(0이 아님), 요청·토큰·비용이 모두 없는 행은 내려주지 않는다
Prompt { name, versions:[{version, labels:[string], createdAt?, evaluation?:{runId, passed, createdAt}}] }
Model { id, modelName, matchPattern, inputPrice, outputPrice, unit }        // 가격은 토큰당 USD
Evaluation { runId, dataset, prompt, version, status(running|completed|failed), passed?, createdAt,
             metrics:[{name, score, baseline?, delta?}] }
LeakCheck { id, traceId, workId, checkedAt, matched:[string], suspected, reason? }
Alert { id, ruleKey, status, message, value?, targetRef?, createdAt, actedBy?, actedAt?, note? }
AlertRule { key, metric, threshold?, windowMinutes, enabled, updatedAt }
JobRun { id, kind, source, status, trigger, progress?{done,total}, startedAt?, finishedAt?, error?, targetId? }
Schedule { id, kind, cron, enabled, params, createdAt, updatedAt, lastRun?:JobRun }
```

목록 경로는 끝 슬래시 없이 부른다(Spring 6 기본). 오류는 기존 운영 공통 `{code,message}`이며 Langfuse·AI·Core·Content 실패는 502 `UPSTREAM_FAILED`(대시보드만 칸별 `unavailable`).

관리자 변경 조치(프롬프트 등록·승격, 모델 등록, 평가 실행, 경고 처리·기준 변경, 표본 비율 변경, 일정 CRUD, 재실행)는 성공 뒤
`AdminActivityService.record`로 기록하고 [활동 기록 계약](operations-admin-activity-contract.md) action 표와 프런트 라벨에 더한다.

## 저장 (operations Flyway V8)

- `alert_rule(key PK, metric, threshold numeric NULL, window_minutes int, enabled bool DEFAULT false, updated_at)`
  시드 키: `ai_failure_rate`, `ai_timeout_rate`, `ai_daily_cost_usd`, `ai_p95_latency_ms`, `job_failed`, `leak_suspected`(값 없음·꺼짐).
- `operation_alert(id, rule_key, status open|acknowledged|resolved, message, value, target_ref, created_at, acted_by, acted_at, note)`
  같은 규칙의 열린 경고는 하나(부분 UNIQUE). 90일 지난 해결 경고는 정리 작업이 지운다(F-ALT-02 보관 90일).
- `llmops_setting(key PK, value)` — `leak_sample_rate=0.1`.
- `leak_check_result(id, trace_id, work_id, matched jsonb, suspected bool, reason, checked_at)`.
- 위 넷은 LLMOps 조각의 V8, 아래 작업 테이블은 작업 감시 조각의 V9다(V8을 먼저 병합한다).
- (V9) `scheduled_job(id, kind, cron, enabled, params jsonb, created_at, updated_at)`, `job_run(id, kind, source, status, trigger, done, total, started_at, finished_at, error, target_id, external_ref, retry_of)`.
- `job_run.retry_of`(NULL 허용, `job_run` 자기 참조): 수동 재실행 기록이 다시 실행한 실패 기록의 id다. 이 값이 가리키는 기록은 재실행 결과와 무관하게 다시 재실행할 수 없다(409).

## 정기 작업 (운영 스케줄러)

운영 서비스의 `@Scheduled` 1분 tick이 켜진 일정 중 도래한 것마다 `queued` `job_run`을 만들고 AI 내부 `POST /internal/v1/jobs` `{runId, kind}`(`X-Internal-Token`)로 접수시킨다(같은 일정의 queued·running 기록이 있으면 건너뜀, AI가 받지 않으면 그 기록을 failed+고정 사유로 남김). 실행은 AI 작업 워커(Celery 큐 `jobs`)가 운영 내부 `POST /internal/v1/jobs/runs/{runId}/execute`를 불러 맡긴다: 작업 종류마다 `ScheduledJobHandler`(`kind`, `run(params)`) 빈 하나가 있고, 운영이 `queued`→`running`을 조건부 UPDATE 한 번으로 선점한 뒤(병렬 워커·재배달에도 handler는 한 번) 그 handler를 동기 실행해 상태·진행률·대상을 기록한다. 일정 등록은 등록된 handler의 `kind`만 받는다.

| 내부 API (AI 작업 워커 → 운영, `X-Internal-Token`=공유 `INTERNAL_TOKEN`, `/internal/v1/jobs/**` 전용 보안 체인) | 동작 |
|---|---|
| `POST /internal/v1/jobs/runs/{runId}/execute` (본문 없음) | 선점하면 handler를 끝까지 실행하고 200 + 끝난 `JobRun`(handler 실패도 failed 기록의 200). 선점하지 못하면(이미 실행 중·끝남·재배달) 실행도 변경도 없이 409, 없는 `runId`는 404, 토큰이 없거나 틀리면 401 |

tick은 일정을 보기 전에 `queued`가 10분, `running`이 30분을 넘은 기록(워커가 죽었거나 execute 호출이 실패해 남은 것)을 failed+고정 사유(작업 워커 응답 없음)로 닫아 그 일정이 영원히 막히지 않게 한다. 재시작 때는 `running`을 failed로 닫는다(핸들러가 운영 프로세스 안에서 돌기 때문).

| kind | 실행 위치 | 내용 |
|---|---|---|
| `llm_alert_check` | 운영 | 경고 규칙을 Langfuse 지표·실패 작업과 비교해 경고 생성. 생성 시 운영자에게 사이트 안 알림 사건 발행 |
| `leak_sample_check` | 운영 → Content·AI | 직전 구간 Fork 작품 요청 trace를 표본 비율로 뽑고 Content가 준 원작 비공개 카드 제목·미발행 회차 제목을 답변 글자와 대조한다 → 하나라도 걸린 건만 AI `POST /internal/v1/evaluations/leak-check` `{response, references, question?}`(`references`는 걸린 제목 그대로, `question`은 사용자 질문 원문(요청 루트 관측 input의 `request`)이고 없으면 null, DeepEval)로 판정한다. 제목이 질문에 이미 있어도 걸리면 넘기고, 답변이 사용자의 말을 되풀이했을 뿐인지 비공개 내용까지 드러냈는지는 AI가 질문을 보고 판단한다 → 의심이면 `leak_suspected` 경고. 걸린 제목이 없으면 AI를 부르지 않고 `suspected=false` 결과만 남긴다 |
| `regression_eval` | AI | 운영 handler가 AI `POST /internal/v1/evaluations`로 평가를 요청만 한다(기록의 성공 = AI가 접수, `targetId`=Run 이름). AI가 Langfuse Dataset Run을 만들고, Run의 진행·결과는 작업 감시가 Langfuse에서 `kind=evaluation` 기록으로 따로 보인다 |
| `alert_cleanup` | 운영 | 90일 지난 해결 경고 삭제 |

Content 내부 `GET /internal/v1/works/{id}/leak-references`는 Fork 작품의 원작 기준 비공개 카드 제목·미발행 회차 제목을 준다(서비스 토큰, 공개 진입점 미노출).

- 대시보드 `jobs`: `running`은 대기·실행 중인 `job_run` 수 + Content 전처리 `queued`·`running`·`loading` 수 + 실행 중인 회귀 평가 수, `failedLast24h`는 최근 24시간 안에 끝난 `FAILED` `job_run` 수 + 같은 24시간 안에 끝난 Content 전처리 `failed` 수 + 시작이 24시간 안인 실패한 회귀 평가 수다(Content 쪽은 최신 100건, 평가는 끝난 시각이 없고 최신 50개만 읽는다). Content나 Langfuse를 읽지 못하면 일부만 센 값을 보이지 않고 이 칸을 `null`로 하며 `unavailable`에 그 출처(`content`·`langfuse`)를 한 번만 적는다(평가는 Content 집계가 끝난 뒤에만 읽고, Langfuse가 이미 실패했으면 다시 읽지 않는다).
- `llm_alert_check`의 `job_failed`(metric `failed_jobs`) 판정: 규칙 `windowMinutes` 안에 끝난 `FAILED` `job_run` 수 + Content 전처리 `failed` 수(위 `failedLast24h`에서 회귀 평가 실행을 뺀 집계: Langfuse가 내려가도 판정이 계속돼야 하고 경고 검사의 실패가 `job_failed`에 잡혀야 하므로 평가는 세지 않는다)가 `threshold` 이상이면 값=건수로 경고를 만든다. 실패가 0건이면 `threshold`가 0이어도 만들지 않고, 같은 규칙의 미해결 경고가 있으면 다시 만들지 않는다. Langfuse(AI 규칙)와 Content(`job_failed`)는 따로 읽어 한쪽이 내려가도 다른 쪽을 평가하고, 읽지 못한 쪽이 있으면 둘 다 시도한 뒤 실행이 실패한다.

## 사이트 안 알림

경고가 생기면 운영 서비스가 기존 교환기 `storyfork.events`에 `operations.alert.raised`(recipient = `llm` 또는 `jobs` 권한을 가진 운영자마다 한 건)를 발행하고 Core가 알림함에 넣는다.
운영 서비스에 AMQP 연결(`spring-boot-starter-amqp`, Core가 이미 쓰는 의존성)이 더해진다.

## 실행 연결

- nginx·Vite: `/api/v1/operations/{dashboard,llmops,alerts,jobs}`와 하위 경로를 Operations로. Langfuse 웹은 공개 진입점에 열지 않는다(개발자용 별도 포트).
- env: 운영 `OPERATIONS_LANGFUSE_BASE_URL`·`LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY`(AI와 같은 프로젝트 키), `OPERATIONS_AI_BASE_URL`·`INTERNAL_TOKEN`(AI 내부 호출, 그리고 AI 작업 워커가 운영 `/internal/v1/jobs/**`를 부를 때 받는 쪽 인증. AI 워커는 `OPERATIONS_SERVICE_BASE_URL`로 운영을 부르고 `/internal/**`은 공개 진입점(nginx·Vite)에 열지 않는다), RabbitMQ 접속값. Langfuse 프로젝트·키는 `LANGFUSE_INIT_*` 헤드리스 초기화로 만든다.
- AI 평가 의존성 `ragas`·`deepeval`은 `[project.optional-dependencies] eval`에 두고 평가를 실행하는 이미지(worker)만 설치한다.

## 단계

1. Core 통계 · 운영 대시보드·추적·지표 중계 · AI 계측 보강 · Langfuse Compose · 프런트 `data`·`llm` 추적/지표 화면 (병렬)
2. 프롬프트 이관·모델 정의 → 회귀 평가 → 경고 규칙·알림 → 누설 표본 검사
3. 작업 감시: 운영 스케줄러·일정 CRUD는 1단계와 병렬, 전처리 작업 목록은 #343(전처리) 병합 후 연결

## ponytail 한계

- 운영 화면의 지표는 Langfuse 집계를 요청마다 읽는다(캐시 없음). 느려지면 정기 작업 스냅샷 테이블로 바꾼다.
- 사용자 부담 비용은 AI 요청이 Core 크레딧 예약을 쓰기 시작해야 0이 아니게 된다.
- 필터 복원률은 콘텐츠 필터 기능이 생기기 전까지 비어 있다.
- 평가 비용 상한이 없다(추후 결정). 평가는 관리자 실행·켠 일정으로만 돈다.
- 운영 스케줄러는 단일 인스턴스를 가정한다(DB 잠금 없음). 여러 대로 늘리거나 Airflow로 옮길 때 실행 주체를 하나로 바꾼다. (handler 실행은 AI 작업 워커 여러 개가 병렬로 부르지만 `queued`→`running` 선점이 조건부 UPDATE라 한 기록은 한 번만 돈다.)
- 멈춘 기록 정리의 한도(queued 10분·running 30분)는 고정 상수다. 30분을 넘겨 도는 handler는 실패로 기록된 뒤 끝나면 자기 결과로 덮어쓰고, 그동안 같은 일정이 다음 기록을 만들 수 있다. 한도가 모자라는 작업이 생기면 설정으로 바꾼다.
- 작업 워커 큐 `jobs`는 평가와 정기 작업이 같이 쓰므로 긴 평가가 워커를 모두 차지하면 정기 작업 기록이 `queued`로 기다리고, 10분을 넘기면 위 정리가 실패로 닫는다(워커 수는 `AI_JOBS_CONCURRENCY`).
