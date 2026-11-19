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
| 배치 | Langfuse를 dev·prod Compose에 포함한다(웹·worker·ClickHouse·Redis·MinIO·Postgres). 웹은 개발자용 별도 포트(로컬 `:3000`)로만 연다 |
| Langfuse 화면 | 관리자는 Langfuse 웹에 들어가지 않는다. 데이터는 운영·AI 서비스가 프로젝트 API 키로만 읽고 쓴다. Langfuse 웹은 개발자가 초기 관리자 계정(`LANGFUSE_INIT_*`)으로만 쓴다(2026-11-19 사용자 결정, OIDC 로그인 안 함) |
| 회원 식별 | trace의 `user_id`에 **회원 UUID**를 남긴다. 이메일·닉네임·키는 계속 남기지 않는다(2026-11-13 팀 결정의 보완) |
| 경고 기준 | 기준값은 문서로 고정하지 않고 **운영 화면에서 관리자가 정한다**. 초기 행은 꺼진 상태로 시드하고 값을 넣어 켠다 |
| 평가 | 회귀 평가는 AI 서비스의 **Ragas**(Q&A RAG)·**DeepEval**(생성·검토·누설 판정)로 채점하고 결과를 Langfuse Dataset Run 점수로 남긴다. 1회 비용 상한은 **추후 결정**(그 전까지 상한 없음, 평가는 관리자가 직접 실행할 때만 돈다) |
| 작업 감시 | 회차 원고 전처리(DEC-50, 100화 이상 작품의 회차를 하나씩 전처리해 세계관 카드를 만드는 Celery 작업)와 운영 정기 작업을 한 화면에서 본다. 실제 실행은 업무 소유 서비스, 감시·재실행 요청은 운영(F-JOB-01) |
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
| `GET /jobs/runs?status&kind&page` | `jobs` | 전처리 작업 + 운영 정기 작업 실행 기록(같은 모양). 앞쪽 1,000건까지만(`(page+1)*size > 1000`이면 400) |
| `POST /jobs/runs/{id}/retry` | `jobs` | 실패 작업 수동 재실행 요청(전처리는 Content 재접수 = 실패 회차만) |
| `GET /jobs/schedules`, `POST /jobs/schedules`, `PUT /jobs/schedules/{id}`, `DELETE /jobs/schedules/{id}` | `jobs` | 정기 작업 일정 등록·조회·변경·취소(취소는 `enabled=false` 소프트). PUT은 `{kind,cron,enabled,params}` 전체 교체이며 종류 변경은 422 |

실행 기록 모양(출처 독립): `{id, kind, source, status(queued|running|succeeded|failed|cancelled), trigger(schedule|manual|user), progress{done,total}, startedAt, finishedAt, error, targetId}`.
`source`는 `operations-scheduler`·`content-preprocessing`이고 Airflow를 붙이면 `airflow`가 더해진다.

### 응답 모양 (JSON, 시각은 ISO-8601 UTC, 비용은 USD 숫자)

```text
Dashboard { members{total,joinedLast7Days,withdrawalPending}?, ai{today:AiSummary, last7Days:AiSummary}?,
            jobs{running,failedLast24h}?, pending{inquiries,reports,authorReviews}?, openAlerts?, unavailable:[string] }
AiSummary { requests, failed, timeouts, failureRate, costUser, costPlatform }
TraceItem { id, timestamp, feature, status, latencyMs, inputTokens, outputTokens, cost, userId?, workId? }
TraceDetail { ...TraceItem, input?, output?, observations:[{id,name,type,startTime?,endTime?,latencyMs,model?,inputTokens?,outputTokens?,level,statusMessage?,promptName?,promptVersion?}] }
Page<T> { items:[T], page, size, total }
MetricRow { key(날짜·기능·모델), requests, failureRate, timeoutRate, p50LatencyMs, p95LatencyMs, inputTokens, outputTokens, costUser, costPlatform }
Metrics { rows:[MetricRow], adoptionRate?, approvalRate?, filterRestoreRate? }   // 비율은 0~1, 데이터 없으면 null
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
- (V9) `scheduled_job(id, kind, cron, enabled, params jsonb, created_at, updated_at)`, `job_run(id, kind, source, status, trigger, done, total, started_at, finished_at, error, target_id, external_ref)`.

## 정기 작업 (운영 스케줄러)

운영 서비스의 `@Scheduled` 1분 tick이 켜진 일정 중 도래한 것을 실행하고 `job_run`에 남긴다(같은 일정의 실행 중 기록이 있으면 건너뜀). 작업 종류마다 `ScheduledJobHandler`(`kind`, `run(params)`) 빈 하나가 실행을 맡고, 일정 등록은 등록된 handler의 `kind`만 받는다.

| kind | 실행 위치 | 내용 |
|---|---|---|
| `llm_alert_check` | 운영 | 경고 규칙을 Langfuse 지표·실패 작업과 비교해 경고 생성. 생성 시 운영자에게 사이트 안 알림 사건 발행 |
| `leak_sample_check` | 운영 → Content·AI | 직전 구간 Fork 작품 요청 trace를 표본 비율로 뽑고 Content가 준 원작 비공개 카드 제목·미발행 회차 제목과 글자 대조 → 걸린 건만 AI `POST /internal/v1/evaluations/leak-check`(DeepEval)로 판정 → 의심이면 `leak_suspected` 경고 |
| `regression_eval` | AI | AI `POST /internal/v1/evaluations`로 위임, AI가 Langfuse Dataset Run을 만들고 끝나면 운영 콜백 없이 운영이 Run 상태를 읽어 기록 갱신 |
| `alert_cleanup` | 운영 | 90일 지난 해결 경고 삭제 |

Content 내부 `GET /internal/v1/works/{id}/leak-references`는 Fork 작품의 원작 기준 비공개 카드 제목·미발행 회차 제목을 준다(서비스 토큰, 공개 진입점 미노출).

## 사이트 안 알림

경고가 생기면 운영 서비스가 기존 교환기 `storyfork.events`에 `operations.alert.raised`(recipient = `llm` 또는 `jobs` 권한을 가진 운영자마다 한 건)를 발행하고 Core가 알림함에 넣는다.
운영 서비스에 AMQP 연결(`spring-boot-starter-amqp`, Core가 이미 쓰는 의존성)이 더해진다.

## 실행 연결

- nginx·Vite: `/api/v1/operations/{dashboard,llmops,alerts,jobs}`와 하위 경로를 Operations로. Langfuse 웹은 공개 진입점에 열지 않는다(개발자용 별도 포트).
- env: 운영 `OPERATIONS_LANGFUSE_BASE_URL`·`LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY`(AI와 같은 프로젝트 키), `OPERATIONS_AI_BASE_URL`·`INTERNAL_TOKEN`(AI 내부 호출), RabbitMQ 접속값. Langfuse 프로젝트·키는 `LANGFUSE_INIT_*` 헤드리스 초기화로 만든다.
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
- 운영 스케줄러는 단일 인스턴스를 가정한다(DB 잠금 없음). 여러 대로 늘리거나 Airflow로 옮길 때 실행 주체를 하나로 바꾼다.
