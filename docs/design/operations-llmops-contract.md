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
| 평가 | 회귀 평가는 AI 서비스의 **Ragas**(Q&A RAG)·**DeepEval**(생성·검토·누설 판정)로 채점하고, **시뮬레이션 평가 세트**(`simulation.act`·`simulation.narrate`)는 서비스 호출로 만든 응답을 원문 평가 루브릭으로 채점하며(점수는 0~1로 기록), 결과를 Langfuse Dataset Run 점수로 남긴다. 채점 모델은 `EVALUATION_JUDGE_MODEL`(비면 `OPENAI_MODEL`)이다. 1회 비용 상한은 **추후 결정**(그 전까지 상한 없음, 평가는 관리자가 직접 실행할 때만 돈다) |
| LLM Ops 화면 구성(#857, 2026-11-24 사용자 결정) | 프런트만 바꾸고 **새 API는 없다**(기존 응답·차트를 옮겨 쓴다. 평가 데이터셋과 프롬프트의 실제 모델은 뒤따른 #868의 API다). 사이드바 'LLM Ops' 묶음은 세 메뉴다: **에이전트 지표**(기본, `/admin?tab=llm`)·**프롬프트·평가**(`view=prompts`)·**경고·누설 감시**(`view=alerts`). 옛 '추적·지표'는 에이전트 지표(보기 `추적`)로, 옛 '평가·누설 검사'는 없애 평가는 프롬프트·평가로·누설 검사 기록·표본 비율은 경고·누설 감시로 옮겼다(옛 `view=traces`는 에이전트 지표로, `view=quality`와 이슈가 적은 `view=eval`은 프롬프트·평가로 이어지고, 경고 알림·미확인 경고 카드는 `view=alerts`로 간다). **에이전트 지표**는 보기 전환 `지표 | 추적`(`&sub=traces`)이고 지표 보기는 AI 요청(오늘·최근 7일)·진행 중 작업·미확인 경고 요약 카드 → 최근 7일 AI 사용 차트 둘(둘 다 관리자 대시보드에서 옮겨 옴) → 에이전트(기능)별 카드와 같은 값의 표 순이다. 카드 하나는 지표 API(`GET /llmops/metrics?groupBy=feature`)의 기능 행 하나이고 요청 수·실패율·시간 초과율·p95 지연·비용 숫자와 작은 막대(처리 결과 성공·실패·시간 초과, p50·p95 지연)를 보인다 — 지표 API에 기능별 날짜 추이가 없어 막대는 고른 기간의 집계로 그리고, 비어 온 값은 0이 아니라 '데이터 없음'이다. 묶음을 날짜·모델별로 바꾸면 카드 대신 차트가 보이고, 추적 검색·상세는 지우지 않고 `추적` 보기에 둔다. 권한 없음(403)·실패·빈 상태 규칙은 그대로다. **프롬프트·평가**는 보기 전환 `전체(AI 파이프라인, DEC-58) | 에이전트별 평가 | 프롬프트 | 모델`이다. **전체(AI 파이프라인)가 가장 왼쪽이자 기본 보기**(주소는 `view=prompts`, sub 없음)이고 에이전트별 평가는 `&sub=evals`다(2026-11-24 사용자 결정). 파이프라인 노드는 프롬프트가 연결돼 있으면(`promptNames`) **노드 버튼 목록과 노드를 골랐을 때 열리는 기록 패널 머리**에 `프롬프트 보기`가 있어 그 프롬프트의 상세(개선 루프)로 바로 간다(하나면 버튼·여럿이면 목록 메뉴·없으면 버튼 없음, 대상은 기록 줄 메뉴의 `프롬프트 보기`와 같은 규칙. 캔버스 노드 위에는 두지 않는다). 사이드바 `프롬프트·평가` 아래 하위 탭(전체·인물 시뮬레이션·원고 전처리·원고 검수·고증 조사·기획·집필·수정, 주소 `&flow=`, 2026-11-25 정정: 캔버스 위 선택 상자는 없다)으로 전체와 내부 흐름을 고르며, 숫자는 서버 노드가 있는 단계에만 보이고 없는 단계는 구조용 노드(점선, 단계별 서버 노드는 예정)다([AI 파이프라인 계약](operations-ai-pipeline-contract.md#워크플로우내부-흐름-보기-857-3차-2026-11-24-사용자-결정)). 에이전트별 평가 표에서 프롬프트가 정해진 행(feature가 프롬프트 이름인 행)의 이름과 `Run 상세`도 그 프롬프트의 상세로 간다. 프롬프트 상세 위에는 개선 루프 단계 표시 `① 프롬프트 ─ ② 평가 세트 ─ ③ 평가 ─ ④ 자동 개선 ─ ⑤ 게이트 ─ ⑥ 서비스 반영`이 있고 단계를 고르면 아래 패널이 바뀐다(단계는 화면 상태, 기존 패널 이동): ① 버전 목록·본문·새 조합, ② 짝 세트 이름·문항 수와 평가 데이터셋 목록·JSONL 업로드(아래 '평가 데이터셋 API(#868)': 기본 세트는 저장소 `backend/ai-service/app/evaluation/datasets/` 파일을 `ai-eval-seed`가 `python -m app.evaluation.seed`로 Langfuse에 등록하고, 업로드는 **이미 있는 세트에 문항을 더할 뿐 새 세트를 만들지 않으며** 저작권 원문이 아니라는 확인을 받는다), ③ 그 프롬프트의 짝 세트(위 후보 등록 게이트의 짝) Run과 그 프롬프트를 범용 세트로 돌린 Run의 목록·실행·상세·문항별 결과, ④ 자동 개선 폼(`isOptimizable`만), ⑤ 버전별 짝 세트 최근 평가 통과 여부와 후보 등록(게이트), ⑥ 후보의 production 반영·복원(409 안내 그대로). **대시보드**(`data` 탭, 예전 '개요')는 서비스 지표 카드(회원·답변 대기 문의·접수 신고·작가 검토 대기)와 서비스 지표(전체 기간)만 보인다 |
| 에이전트별 평가 표(#837, 2026-11-24 사용자 결정) | LLMOps 화면 '프롬프트·평가' 쪽의 보기 `에이전트별 평가`(`&sub=evals`, #857 전에는 첫 보기)에 **에이전트 × 평가 모드 × 평가 세트 × 지표 × 최근 결과** 표를 보인다(메인 에이전트·Decision Guard·업무 Agent 6(Q&A·Manuscript Review·World·Writing·Research·Rating)·인물 시뮬레이션 act·narrate·전처리 설정 추출). 에이전트마다 쓰는 세트·지표가 다르다. 모드는 둘이다: **새 답변 생성**(고정 근거로 프롬프트 버전이 새 답변을 만들게 해 채점 = 위 회귀 평가, 화면에서 실행)과 **원문 검색**(모델 없이 고정 원문의 검색 순위만 채점 = CI 고정 평가 #830, 실행 버튼 없이 '버튼 없음 · CI에서 확인'으로 표시. 웹 검색은 제외, Content 원고 벡터 검색은 후속). 저장한 답변을 다시 채점하는 모드는 만들지 않는다. 세트가 없는 에이전트는 숨기지 않고 '평가 세트 없음(후속)'으로 보인다. 행 이름은 한국어로 자세히 보인다(#857): 프롬프트가 정해진 행은 그 프롬프트의 한국어 이름('인물 시뮬레이션 · 인물 대사(act)'·'인물 시뮬레이션 · 나레이션·독백(narrate)')과 작은 코드, 그 밖의 행은 '에이전트 · 기능'이다. **운영 API·응답 필드는 바뀌지 않는다**: 행 목록은 프런트 상수(`frontend/src/domain/entities/llmOpsEvalTable.ts`)이고 기준표는 [검색 품질 평가 §1.1](../evaluation/retrieval.md#11-llmops-화면의-에이전트별-평가-표)이며(둘이 같은지 프런트 단위 테스트가 문서 표와 AI 세트 파일의 이름·항목 수를 대조한다), '최근 결과'는 기존 `GET /llmops/evaluations`(최근 50건)에서 세트 이름으로 찾은 그 세트의 가장 최근 Run(통과·미통과·실행 중·실패와 Run 상세)이다 |
| 프롬프트 표시 이름(#857, 2026-11-24 사용자 결정) | 프롬프트 이름이 영어 코드(`character_simulation.act`)만 보여 무슨 프롬프트인지 알 수 없던 문제를 **프런트만 바꿔** 푼다(API·Langfuse의 이름은 그대로). 모든 화면(프롬프트 표·상세 제목·에이전트별 평가 표·③ 평가·파이프라인 노드 머리글과 기록 표·추적 상세)이 **한국어 표시 이름을 주로, 코드를 작은 보조 글씨로** 보인다. 이름은 프런트 도메인 상수 하나(`frontend/src/domain/entities/promptNames.ts`의 `PROMPT_NAMES`, 코드 → '영역 · 무슨 호출인지(코드 끝 마디)', 영역은 에이전트별 평가 표의 에이전트 이름과 같다)이고 표에 없는 코드(옛 이름·데모)는 코드 그대로다. 키는 AI 서비스가 기동 때 등록하는 프롬프트(`app/prompts.py` SEEDS 33개)와 같고 프런트 단위 테스트가 대조하므로, 프롬프트를 더하면 상수에도 이름을 더한다 |
| 기본 모델 표시(#857, 2026-11-24 사용자 결정) | 모델을 고르지 않은 버전은 AI 서비스의 환경 변수 기본 모델로 돌아 프런트가 이름을 알 수 없어 '기본 모델(환경 설정)'이었다(#808). **기존 응답에 실제 쓰인 모델이 있으면 근거와 함께 '기본 모델 · 최근 사용 gpt-…'로 보인다**: 파이프라인 노드 기록(`GET /llmops/pipeline/{nodeId}/records`)의 `model`·`promptName`·`promptVersion`에서, 그 프롬프트의 **모델을 고르지 않은 버전**이 남긴 가장 최근(시작 시각) 기록의 모델을 쓴다(모델을 고른 버전의 기록·버전을 모르는 기록·프롬프트 응답에 없는 버전의 기록은 근거가 아니다). 읽는 범위는 프롬프트가 연결된 노드의 최근 7일·노드마다 첫 쪽 20건이고, 마우스를 올리면 근거(몇 번 버전의 기록·시각)가 보인다(상세 요약에는 글자로). 근거가 없으면(기록이 없거나 읽지 못함) '기본 모델(환경 설정)' 그대로이며 **프런트는 모델 이름을 하드코딩하지 않는다**. **서버 응답(#868)**: `GET /llmops/prompts`·`GET /llmops/prompts/{name}`의 **버전마다 `effectiveModel`**(그 버전이 실제로 도는 모델)과 `modelSource`(`version` = 버전이 고른 `config.model`, `default` = AI 서비스가 그 프롬프트에 실제로 쓰는 기본 모델)를 싣는다. 환경 변수는 AI 서비스만 알므로 운영 서비스가 AI 내부 `GET /internal/v1/prompts/default-models`로 '프롬프트 → 기본 모델'을 받아 채우고 못 받으면 `null`이다(아래 '프롬프트 실제 모델(#868)') |
| 작업 감시 | 회차 원고 전처리(DEC-50, 작업당 미저장 회차를 최대 4개씩 동시에 추출해 세계관 카드를 만드는 Celery 작업, ai-worker 동시 작업 수 `AI_PREPROCESSING_CONCURRENCY` 기본 3)·운영 정기 작업·회귀 평가 실행을 한 화면에서 본다. 실제 실행은 업무 소유 서비스(운영 정기 작업은 AI 작업 워커가 운영의 execute API를 불러 실행, [작업 실행 이관](operations-funnel-credit-contract.md#4-작업-실행을-celery로-이관-리팩터링-2026-11-20-사용자-결정)), 감시·재실행 요청은 운영(F-JOB-01). 평가 실행은 작업 감시에서 재실행하지 않는다 |
| 후보 등록 평가 게이트(#787, 2026-11-24 사용자 결정) | 평가 세트가 그 호출로 만든 세트인 프롬프트만 짝을 둔다(운영 서비스 `PromptService`의 상수): `story_context.answer`↔`qa.grounding`, `character_simulation.act`↔`simulation.act`, `character_simulation.narrate`↔`simulation.narrate`, `manuscript_extraction.extract`↔`extraction.extract`(#824). 이 넷은 **그 버전을 그 세트로 돌린 가장 최근 Run의 `passed`가 true**여야 후보로 등록된다(실행 중·미통과·다른 세트 통과는 409 `EVALUATION_REQUIRED`). 범용 세트(`leak.spoiler`·`world.conflict`·`writing.fix`)는 업무 Agent 틀로 만들어 서비스 호출의 입력 모양과 달라 짝을 두지 않는다. 짝이 없는 프롬프트는 지금처럼 평가 없이 후보로 등록한다. 이미 후보인 버전은 그대로 후보다(서비스 반영 조건은 후보 라벨뿐). 짝이 있는 프롬프트는 목록·상세의 버전별 최신 평가도 그 세트의 Run만 보여 화면과 게이트가 같은 Run을 본다 |
| 에이전트별 모델·프롬프트 선택(#705, 2026-11-24 사용자 결정) | 모델은 **Langfuse 프롬프트 버전의 `config.model`**에 둔다(본문과 모델이 한 버전 = 한 **조합**, 새 저장소 없음). 고를 수 있는 모델은 **운영 설정 `LLMOPS_MODELS`의 목록**(AI 서비스가 OpenAI로 부르는 모델만, 기본 gpt-6-luna·gpt-6.1-terra·gpt-6-sol·gpt-6.1-sol·gpt-6-astra, 쉼표로 더하거나 뺀다, #806)이고 운영 서비스가 등록 때 검사한다. Langfuse 모델 정의(모델 단가 탭)는 비용 계산용 단가표일 뿐 선택지가 아니다(claude·gemini 등 AI가 부를 수 없는 정의가 기본으로 들어 있다). 화면은 모델을 고르지 않은 버전을 '기본 모델(환경 설정)'로 보인다(실제 이름은 AI 서비스 환경 변수라 단정하지 않는다, #808). **모든 LLM 호출**(서비스 호출 33개, `app/prompts.py`)의 프롬프트를 AI 서비스가 **기동 때 모두 등록**해 화면에 처음부터 보인다. 기본값은 모델 **gpt-6-luna**(인물 대사 `character_simulation.act`만 2026-11-23 결정대로 gpt-6.1-terra), 프롬프트는 지금 코드 본문이다: `config.model`이 없는 버전은 환경 변수 모델(`OPENAI_MODEL`=gpt-6-luna·act의 `SIMULATION_ACT_MODEL`/terra)을 쓴다. 반영 흐름은 **조합 저장 → (선택) 회귀 평가·지표 → 후보 등록 → 서비스 반영**이고 서비스 반영(production)은 **후보만** 된다(409 `CANDIDATE_REQUIRED`). 후보 등록의 평가 조건은 아래 '후보 등록 평가 게이트(#787)' 행을 따른다. 코드 시드가 바뀌면 AI가 `seed` 라벨의 새 버전으로 자동 등록하고 화면이 '코드 시드 대기'로 보인다. Decisions API로 부르는 `decision_guard.judge`·`character_simulation.direct`는 프롬프트만 바꾸고 모델은 gpt-6-luna 고정이며, 평가 채점기(루브릭)는 서비스 호출이 아니라 대상이 아니다 |
| 프롬프트 자동 개선(#823, 2026-11-24 사용자 결정) | 시뮬레이션 지시문(`character_simulation.act`·`character_simulation.narrate`)의 새 버전을 **GEPA**(`gepa`, MIT, AI `eval` extra)로 만든다: 평가 세트의 **최적화 풀**(게이트 세트와 겹치지 않는 나머지 문항, train/val)로 반성(reflection) 모델이 지시문을 고쳐 쓰고 val 평균이 가장 높은 후보를 고른다. 반성 모델은 `gpt-6-sol`이고 **로컬 OpenCodex 게이트웨이로만** 부른다(`PROMPT_OPTIMIZER_BASE_URL`·`_API_KEY`·`_MODEL`). 생성(task)·채점은 기존 OpenAI 경로·`EVALUATION_JUDGE_MODEL` 그대로다. 1회 평가 호출 상한 `maxMetricCalls`는 기본 **150**·서버 상한 **500**(화면에서 바꾼다). **자동 범위는 새 버전 저장(라벨 없음) + 그 버전의 게이트 세트 회귀 평가 Run 1회까지**다: 후보 등록·서비스 반영은 사람이 기존 버튼으로 한다(게이트 그대로). 트리거는 LLMOps 화면 버튼뿐이고 정기 작업 kind는 만들지 않는다. 저장된 답변을 다시 채점하는 모드는 만들지 않는다. 절차·수치는 [프롬프트 자동 개선 평가 문서](../evaluation/prompt-optimization.md) |
| Airflow | 지금은 쓰지 않는다. 운영 스케줄러가 맡는 '정해진 시각에 소유 서비스의 실행 API 호출'과 '실행 기록 조회'를 나중에 Airflow DAG·REST API로 바꿀 수 있게 실행 API와 기록 모양을 출처 독립으로 둔다 |

## 데이터 출처

| 화면 값 | 정본 | 읽는 경로 |
|---|---|---|
| 회원 수(전체·최근 7일 가입·탈퇴 유예) | Core `auth_member` | Core `GET /internal/v1/members/stats`(운영 서비스 토큰 + 관리자 Bearer) |
| AI 요청 수·실패·시간 초과·지연·토큰·비용 | Langfuse trace·observation | 운영 → Langfuse `GET /api/public/metrics`, `GET /api/public/traces` |
| 사용자 부담 비용 | Core 크레딧 예약 확정 + trace metadata `credit_reservation_id` | 확정된 예약이 붙은 trace의 비용 합. 아직 AI 요청이 크레딧을 차감하지 않으므로 지금은 전부 플랫폼 부담으로 나온다 |
| 답변 대기 문의·접수 신고 | 운영 DB | 운영 Repository |
| 작가 검토 대기(확인 전 제보 `unchecked`·대기 수정 제안 `pending`) | Content | Content `GET /internal/v1/operations/stats` (제보 목록 열람은 `GET /internal/v1/feedback-reports`, [제보 계약](feedback-report-suggestion-contract.md#운영자-열람-750-사용자-결정-2026-11-24)) |
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
  코드의 프롬프트는 시드다: 처음 읽을 때 Langfuse에 없으면(404) 버전 1(`production`·`seed`)로 등록한다. 프롬프트를 읽을 때마다 시드를 `seed` 라벨 버전으로 맞춘다(#705, 맞춰진 상태는 SDK 캐시 읽기뿐이고 쓰기 직전에만 캐시 없이 다시 읽는다):
  production 본문이 시드와 같으면 그 버전에 `seed` 라벨만 달고(시드 본문으로 모델만 바꾼 버전을 승격해도 seed가 따라온다), 다르면 `seed` 버전이 이미 시드 본문이면 그대로, 아니면 시드를 라벨 `seed`의 새 버전(production의 `config` 이어받음)으로 등록한다.
  production은 옮기지 않고(반영은 후보 등록 뒤 운영 화면에서), 맞추기 실패는 경고 로그만 남기고 다음 호출이 다시 맞춘다. 모델은 production 버전의 `config.model`이고 없으면 환경 변수 기본 모델이다
  (Decisions API 호출은 제외). SDK 캐시가 60초라 승격·모델 변경은 재배포 없이 반영된다: 캐시가 지난 뒤 첫 호출은 옛 값을 쓰며 새로 읽고 그다음 호출부터 새 버전이다(SDK의 stale-while-revalidate). 회귀 평가도 평가하는 버전의 `config.model`로 생성한다. 이름은 `<기능>.<용도>`(예 `story_context.answer`, `orchestration.main`).
  Langfuse 키가 없으면(로컬·CI) 추적과 같이 꺼지고 코드 프롬프트를 그대로 쓴다. 키가 있는데 읽기에 실패하면 SDK 캐시(마지막 성공 값)를 쓰고, 캐시도 없으면 503으로 실패한다.
- 시간 초과는 `status:timeout`, 그 밖의 실패는 `status:failed`와 observation `level=ERROR`다. 대기(`waiting`) 턴·취소·연결 끊김은 상태 태그를 달지 않는다.
- 회원 UUID는 Content가 넘기는 작가 Bearer(`X-User-Authorization`)의 `sub`에서 읽고(추적 전용, 인가에 쓰지 않음), `request_id`는 AI가 HTTP 요청마다 발급한다. `fork`는 Content가 오케스트레이션 `target.fork`로 알린다. 요청 루트 trace에는 본문을 남기지 않고 generation observation이 입출력을 갖는다.
- 회귀 평가 결과는 Run 수준 점수다: 지표 평균(NUMERIC, metadata `baseline`·`delta`·`tolerance`)과 `passed`(BOOLEAN). `passed`가 없으면 실행 중이고, 시작 후 2시간이 지나도 없으면 운영 화면은 실패로 본다.
- **시뮬레이션 평가 세트**(2026-11-23 사용자 승인, 인물 시뮬레이션 지시문 `character_simulation.act`·`narrate`의 새 버전을 승격할 수 있게 한다): 틀(세트 등록·Run·기준 Run 비교·승격 게이트 409)은 그대로이고 이 두 세트일 때만 생성·채점이 다르다.
  - **세트**: `app/evaluation/datasets/simulation.act.jsonl`(대사 24)·`simulation.narrate.jsonl`(나레이션 24·독백 22)는 원문 평가 공개 세트(저작권 만료 고전·근대 소설과 CC BY-SA 3.0 SCP 이야기, 해리 포터 없음)에서 `orig_cli.py export`로 만든다. 항목은 `input`(서비스가 그 호출에 보내는 값 그대로 `{set, data}`)·`expectedOutput`(원작의 다음 글)·`metadata`(`source`·`license`·**`judge`**: 채점 입력 `character`·`scene`(직전 장면 전체, 모델 입력의 장면은 줄어 있다)·`facts`(시점 위반 정답표: 그 인물이 아직 모르는 사실 `{id, text}`))다. 한 세트는 한 지시문만 평가한다(다른 지시문이면 422).
  - **생성**: 업무 Agent 틀이 아니라 실제 서비스 호출이다. `app/simulation/agent`의 `act`·`narrate`에 평가 대상 버전의 본문을 그대로 주고(production 버전을 읽지 않는다) 응답 확인·따옴표 통일도 서비스와 같으며 act는 서비스 기본 모델(terra)·구조화 출력 그대로다.
  - **채점**: G-Eval 대신 원문 평가 루브릭(`app/evaluation/rubric.py`, 원문 평가가 같은 문구를 쓴다)을 정답을 보여 준 채점 모델에 구조화 출력 한 번으로 묻는다. 지표는 모두 높을수록 좋다: act `voice`(말투)·`intent`(의도)·`pov_ok`, narrate `style`(문체)·`info`(정보)·`pov_ok`(시점 위반 정답표 중 말했거나 아는 듯 쓴 것이 없으면 1, 있으면 0). 루브릭은 1~5점으로 매기지만 **Run·항목 점수는 Ragas·GEval처럼 0~1로 기록한다**: `voice`·`intent`·`style`·`info`는 (점수 − 1)/4이고 `pov_ok`는 그대로다(원문 평가의 1~5 기록·보고서 수치는 바꾸지 않는다. 0~1로 바꾸기 전에 1~5점으로 기록한 Run은 눈금이 달라 비교할 수 없으니 기준 Run을 새로 만든다. 기준은 production 버전의 가장 최근에 끝난 Run이라 새 Run이 옛 Run을 대신한다). Run 점수는 지표별 평균이고 기준 Run 비교·`passed` 판정은 다른 세트와 같다(지표마다 기준 평균 − `EVAL_TOLERANCE`, 기본 0.1). 응답·채점 응답이 틀에 맞지 않으면 항목 실패다. 채점 호출은 generation `evaluation.rubric_grade`로 모델·사용량만 추적에 남기며(입력·지시문·응답 본문 없음) 회귀 평가 항목의 trace와 자동 개선 trace에 붙는다(#851).
  - **채점 모델**: `EVALUATION_JUDGE_MODEL`(비면 `OPENAI_MODEL`)이고 Ragas·GEval·누설 판정도 같은 설정을 읽는다. 채점 모델이 다른 Run끼리는 비교가 안 되어 바꾼 뒤 첫 비교는 흔들린다. 루브릭 문구는 Langfuse 프롬프트가 아니라 코드에 고정한다(바꿀 수 있게 하면 기준 Run과 채점 기준이 어긋난다).
  - **순서·기준 Run**(#868 확대, 2026-11-25 사용자 결정): 기준 Run은 현재 production 버전의 가장 최근에 끝나고 지표 평균이 남은 Run 가운데 **평가 세트의 마지막 문항이 만들어지거나 바뀐 뒤에 시작한** 것만 유효하다(그 전에 시작한 Run은 새로 올라왔거나 고쳐진 문항을 보지 못해 점수를 비교할 수 없다. 시각이 같아도 뒤가 아니다. 문항 시각은 Langfuse 문항의 `createdAt`과 `updatedAt` 중 늦은 쪽이다: Langfuse 문항은 버전이 있어 올린 문항을 고쳐도 만든 시각이 그대로일 수 있다). 유효한 기준 Run이 없으면 지표 비교를 건너뛰지 않고 **같은 작업(`evaluation.run` 한 건) 안에서 production 버전을 먼저 평가**해 그 평균을 기준으로 새 버전을 이어 평가한다(먼저 도는 production Run은 비교 없이 끝나고 그 Run이 곧 기준이다. 그 Run의 `passed` 점수 설명에 '기준 Run과 비교하지 않았습니다'가 남는다). **비용: 이 경우 평가 Run이 둘이라 호출·비용이 두 배다**(act 24·narrate 46문항 기준 항목마다 생성 1 + 채점 1, 두 번). production 평가가 점수를 하나도 남기지 못하면 후보를 평가하지 않고 502 고정 문구로 끝낸다(기준 없이 통과시키지 않는다). production 버전 자신을 평가하는 요청이거나 production 라벨이 없으면 비교하지 않는다(자신의 Run이 곧 기준). 기준 유무는 접수 때 정하고 큐에서 기다리는 사이 세트가 바뀌어도 다시 보지 않는다. 자동 개선도 같은 규칙으로 기준 유무를 본다(`evaluation.baseline_run`). 그래서 **gate 세트에 문항을 올리면 다음 평가가 production 버전을 다시 평가한다**(아래 '평가 데이터셋 API').
- **추출 평가 세트**(`extraction.extract`, #824, 지시문 `manuscript_extraction.extract`): 틀(세트 등록·Run·기준 Run 비교·`passed`·승격 게이트 409)은 그대로이고 이 세트만 생성·채점이 다르다. 항목은 회차 한 편(`input` = 모델 입력 `{number, title, body}` 그대로)과 정답표(`expectedOutput` = 상위 모델이 서로 다른 지시문으로 두 번 뽑은 대상·진술·관계, 항목마다 `core` = 두 번 모두 뽑음)다. 생성은 `manuscript_extraction.agent.extract`에 그 버전의 본문·모델을 그대로 주고(production 버전을 읽지 않는다) 서비스와 같은 검증을 거친다. **채점은 모델 없이 코드**이고 지표는 `recall`(**설정다운** `core` 정답의 재현율, 대상·진술·관계 평균)·`quote_ok`(검증을 통과해 남은 항목의 비율)이며 0~1이다. 설정다운 정답은 `kind`·`document` 필드로 코드가 가린다: 대상은 물건이면 회차에 두 번 이상 나온 것만, 진술은 인물 문서(identity·soul·goal)만, 관계는 두 끝점이 설정 대상이고 한쪽 이상이 인물인 것만이며 나머지(일상 물건·줄거리 사건)는 `recall` metadata의 참고 지표 `outside`로 돌린다(정밀도·종류 일치 등도 참고로만 남긴다). 세트 파일은 저작권 만료 작품뿐이다: 게이트 세트는 30회차(작품·작가 층화, 평가 1회 = 운영 모델 호출 30회)이고 나머지 회차는 최적화 풀(`datasets/optimize/extraction.extract.jsonl`, 항목에 `metadata.split` train·val, seed가 Langfuse Dataset `optimize.extraction.extract`로 올리고(#868) 게이트와 회차·원문이 겹치지 않는다)이며 해리 포터·웹소설은 로컬 오프라인 평가 전용(`eval/extraction/.data`)이다. 세부는 [추출 평가 세트](../evaluation/extraction-set.md).

## 운영 공개 API (회원 Bearer, Core `operator=true`)

모든 경로는 `/api/v1/operations` 아래다. 권한 키는 V4 시드에 이미 있는 것을 쓰며 새 키는 없다.

| 메서드·경로 | 권한 | 내용 |
|---|---|---|
| `GET /dashboard` | 운영자 누구나 | 회원 수, 오늘·7일 AI 요청·실패율·비용(사용자/플랫폼), 진행 중 작업 수, 답변 대기 문의·접수 신고·작가 검토 대기, 미확인 경고 수. 출처 하나가 실패하면 그 칸만 `null` + `unavailable:[출처]`(나머지는 보인다, 실패를 0으로 바꾸지 않는다). 요청 0건이면 `failureRate`는 `null` |
| `GET /llmops/traces?from&to&feature&status&userId&requestId&page` | `llm` | trace 목록(시각·기능·상태·지연·토큰·비용), `requestId`는 metadata `request_id` 일치 |
| `GET /llmops/traces/{id}` | `llm` | 단계별 observation(이름·시각·지연·모델·토큰·level), 입력·출력 본문 |
| `GET /llmops/metrics?from&to&groupBy=day|feature|model` | `llm` | 요청·실패율·시간 초과율·p50/p95 지연·토큰·비용(사용자/플랫폼)·채택률·승인률·필터 복원률 |
| `GET /llmops/prompts`, `GET /llmops/prompts/{name}` | `llm` | 프롬프트별 버전·라벨·모델(`config.model`)·실제 모델(`effectiveModel`·`modelSource`, #868)·최신 평가 결과와 후보 수(`candidates`, production이 아닌 `candidate-N` 라벨 수). 목록은 `production`·`seed` 버전만 라벨로 읽어(프롬프트당 Langfuse 읽기 최대 2회, 버전 수와 무관, #786) 싣고 후보 수는 Langfuse 목록의 라벨 합집합에서 센다. 상세만 모든 버전과 본문(`prompt`)·변경 메모(`commitMessage`, #807), 고를 수 있는 모델 목록(`models`, #806)을 싣는다 |
| `POST /llmops/prompts/{name}` | `llm` | 새 버전 등록(라벨 없음). `config.model`은 `LLMOPS_MODELS` 목록의 이름(문자열)이어야 하며 아니면 400(#806) |
| `PUT /llmops/prompts/{name}/candidate` `{version}` | `llm` | 그 버전(조합)을 서비스 반영 후보로 등록: 라벨 `candidate-<version>`을 단다(Langfuse 라벨은 한 버전에만 있어 버전 번호를 넣는다, 여럿 공존). 평가 세트가 있는 프롬프트는 그 세트의 최신 Run 통과가 필요하고 아니면 409 `EVALUATION_REQUIRED`(#787), 나머지는 평가를 요구하지 않는다 |
| `PUT /llmops/prompts/{name}/production` `{version}` | `llm` | `production` 라벨 이동(서비스 반영·이전 버전 복원). 그 버전에 자기 후보 라벨이 없으면 409 `CANDIDATE_REQUIRED`(화면은 code로 한국어 안내). 복원도 후보로 등록한 뒤 한다 |
| `GET /llmops/models`, `POST /llmops/models` | `llm` | Langfuse 모델 정의(이름·매칭 패턴·입력/출력 단가) 조회·등록 |
| `GET /llmops/evaluations`, `GET /llmops/evaluations/{runId}` | `llm` | Dataset Run 목록·상세(지표별 점수, 기준 버전 대비 차이, 통과 여부). 상세만 문항별 결과 `items`를 싣는다(아래 '평가 항목 결과'). 목록은 평가 화면의 '에이전트별 평가' 표가 세트별 최근 Run을 찾는 데도 쓴다(위 '에이전트별 평가 표') |
| `POST /llmops/evaluations` `{dataset, prompt, version}` | `llm` | 회귀 평가 실행 요청(AI에 위임, 202 + 실행 기록 ID) |
| `GET /llmops/datasets` | `llm` | Langfuse 평가 세트 배열(이름·짝 프롬프트·종류 gate·pool·general·문항 수·세트가 마지막으로 바뀐 시각 `lastItemAt`·설명). 아래 '평가 데이터셋 API(#868)' |
| `GET /llmops/datasets/{name}/items?page=1&size=20` | `llm` | 한 세트의 문항 쪽(`page`는 1부터) |
| `POST /llmops/datasets/{name}/items` | `llm` | JSONL 파일(multipart `file`)로 이미 있는 세트(gate·pool·general)에 문항 추가: `copyrightConfirmed=true` 필수·전부 아니면 무·세트별 필수 칸·이미 있는 input 거절·500줄 2 MB |
| `POST /llmops/prompts/{name}/optimizations` `{version, maxMetricCalls?}` | `llm` | 프롬프트 자동 개선 실행 요청(AI에 위임, 202 `{accepted:true, prompt, version, maxMetricCalls}`). 최적화 가능 프롬프트(`character_simulation.act`·`character_simulation.narrate`)가 아니면 422 `OPTIMIZATION_UNSUPPORTED`, `maxMetricCalls`가 1~500 밖(기본 150)이거나 없는 버전이면 400·404, 같은 프롬프트의 개선이 실행 중이면 409 `OPTIMIZATION_RUNNING`(AI가 준 409 그대로), AI 접수 실패는 502. 아래 '프롬프트 자동 개선' |
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

### 평가 데이터셋 API (#868)

프롬프트 상세 ② 평가 세트의 '평가 데이터셋 목록·JSONL 업로드'가 쓰는 운영 API다(권한 `llm`). 정본은 Langfuse Dataset이고 운영은 Langfuse Public API(`GET /api/public/v2/datasets`·`/v2/datasets/{name}`·`GET·POST /api/public/dataset-items`·`DELETE /api/public/dataset-items/{id}`)로만 읽고 쓴다(Spring으로 다시 만들지 않는다). **범위 밖**: 새 세트 만들기(세트는 AI의 `ai-eval-seed`가 등록한다), 문항 수정·삭제, 저작권 자동 판정(확인란만). 세트는 이름으로 고르고 종류가 셋이다(2026-11-25 사용자 결정, #868 확대 — 최소 구현보다 정확성을 우선한다): **gate**(후보 등록 게이트의 짝 세트: `simulation.act`·`simulation.narrate`·`extraction.extract`·`qa.grounding`), **pool**(자동 개선의 훈련·검증 재료 `optimize.<게이트 세트>`: `optimize.simulation.act`·`optimize.simulation.narrate`·`optimize.extraction.extract`, seed가 저장소 `datasets/optimize/*.jsonl`을 올려 둔다), **general**(그 밖의 이름, `optimize.`로 시작해도 짝 게이트가 없으면 general). 세 종류 모두 올릴 수 있다. **gate에 올리면** 그 세트의 마지막 문항이 새로 만들어져 지금까지의 기준 Run이 모두 무효가 되므로 다음 평가가 production(기준) 버전을 먼저 다시 평가한다(위 '순서·기준 Run', **비용 발생**). 막지 않고 응답의 `notice`와 화면이 알린다. 기본 세트와 풀을 올리는 seed(`ai-eval-seed`)는 Langfuse에 같은 id·`input`·`expectedOutput`·`metadata`의 문항이 이미 있으면 건너뛰고 없거나 내용이 다를 때만 upsert한다(세트의 기존 문항은 한 번에 읽어 비교하고 파일에 없는 문항은 건드리지 않는다). 그래서 배포(`docker compose up`)마다 기준 Run이 무효가 되지 않고, 파일의 문항 내용을 고쳐 배포하면 그 문항만 올라가 기준 Run이 무효가 되는 것이 맞다. pool에 올리면 기준 Run과 상관없이 다음 자동 개선부터 그 문항을 쓴다(`load_pool`이 Langfuse에서 읽는다).

| 경로 | 응답 |
|---|---|
| `GET /llmops/datasets` | **배열** `[{name, prompt, kind, itemCount, lastItemAt, description}]`. `kind`는 `gate`·`pool`·`general`(위), `prompt`는 그 세트를 평가 세트로 가진 프롬프트(후보 등록 게이트의 짝, 운영 `PromptService`의 `EVALUATION_SETS`를 거꾸로 찾고 없으면 `null`이라 pool·general은 늘 `null`), `itemCount`는 세트의 전체 문항 수, `lastItemAt`은 **그 세트가 마지막으로 바뀐 시각**(문항 `createdAt`·`updatedAt` 중 가장 늦은 시각, ISO-8601 UTC 텍스트, 문항이 없거나 문항에 시각이 없으면 `null`)이다. 평가 서비스가 기준 Run이 유효한지 가리는 값과 같은 최댓값이라(위 '순서·기준 Run') 화면은 기준 Run의 시작 시각이 `lastItemAt`보다 뒤가 아니면(같은 시각 포함) 그 기준을 무효로 보인다. Langfuse 데이터셋에는 개수도 마지막 문항 시각도 없고 문항 목록의 순서를 믿지 않으므로(가장 새 문항이 어디 있든) 세트마다 문항을 100개씩 모두 읽어 세고 최댓값을 구한다. 문항 시각이 시각 모양이 아니면 그 Langfuse 응답이 깨진 것이라 목록 전체가 502다(다른 Langfuse 시각 읽기와 같다). `description`은 Langfuse 설명(없거나 공백이면 `null`) |
| `GET /llmops/datasets/{name}/items?page=1&size=20` | `{items:[{id, input, expectedOutput, metadata}], total}`. `page`는 **1부터**(다른 목록의 0부터와 다르다), `size`는 1~100(밖이면 400), 순서는 Langfuse가 주는 그대로이고 값은 저장된 JSON 그대로(없으면 `null`)다 |
| `POST /llmops/datasets/{name}/items` | `multipart/form-data` — `file`(.jsonl, 확장자 대소문자 무관)·`copyrightConfirmed`(`true`). 201 `{created, kind, notice}`: 만든 문항 수, 세트 종류, 안내 문구(gate일 때만 `gate 세트에 올리면 다음 평가에서 기준 버전을 다시 평가해요(비용 발생)`, 그 밖은 `null`) |

업로드 파일은 UTF-8(BOM 허용) `.jsonl`이고 줄 하나가 문항 하나인 JSON 객체 `{input, expectedOutput, metadata?}`다(빈 줄은 건너뛰고 세지 않는다). 모든 세트의 공통 규칙은 `input`이 **JSON 객체**, `expectedOutput`이 **필수**(없거나 `null`·빈 글·빈 객체·빈 배열이면 오류), `metadata`는 선택이며 JSON 객체여야 한다는 것이다. 그 밖의 칸은 모두 오류다(오타 `expected_output` 포함, `id`도 받지 않는다: 문항 id는 Langfuse가 만들고 같은 파일을 다시 올리면 문항이 또 생긴다). 한 줄에 JSON 뒤로 글이 더 붙어 있어도 오류다. **채점기가 읽는 칸은 세트마다 더 필요하다**: 채점기가 거절할 문항이 한 줄이라도 들어가면 그 세트의 이후 평가가 모두 실패하기 때문이다. 규칙은 AI의 실제 채점 코드(`app/evaluation/service.py`·`simulation.py`·`extraction.py`)와 seed 세트·풀의 항목 모양에서 읽어 정했고(운영 단위 테스트가 seed 파일의 모든 항목이 이 규칙을 통과하는지 파일로 확인한다), 세트 이름으로 채점기를 고르는 것도 평가 서비스와 같다(pool은 짝 gate와 같다):

| 세트 | 더 필요한 칸 |
|---|---|
| `qa.*` (Ragas) | `input.question`(글)·`input.contexts`(글 목록, 비어 있지 않음), `expectedOutput`은 글 |
| `simulation.act` | `input.data`(객체)·`metadata.judge`, `expectedOutput`은 글 |
| `simulation.narrate` | `input.data`(객체)·`input.set`(`narration`·`monologue`)·`metadata.judge`, `expectedOutput`은 글 |
| `extraction.extract` | `input`은 회차 `{number(1 이상 정수), title, body}`, `expectedOutput`은 정답표 `{mentions, statements, relationships}`(항목 모양과 `core` 표시)이고 **설정에 드는 `core` 정답이 하나 이상**(없으면 `recall`을 정할 수 없다) |
| 그 밖(general) | `metadata.criteria`(글, DeepEval GEval 기준), `expectedOutput`은 글 |

`metadata.judge`는 루브릭 입력 `{character(글, 나레이션은 빈 글), scene:[{by, text}], facts:[{id, text}]}`다. pool의 `metadata.split`은 `train`·`val`만 받는다(아래).

**전부 아니면 무**: 검사는 값싼 것부터이고 하나라도 걸리면 아무것도 만들지 않는다 — 권한(403) → 저작권 확인 → 파일 → 크기 → 모든 줄(형식과 위 채점기 칸) → 세트가 있는지 Langfuse에서 확인(404) → **그 세트와 짝 세트의 기존 문항을 모두 읽어 줄마다 질문 검사와 split 정하기** → 파일 순서대로 한 건씩 만든다. **질문 검사**: `input`(키 순서·공백을 맞춘 JSON의 SHA-256, 정수 `1`과 실수 `1.0`은 같게 보지 않는다)이 이 세트에 이미 있거나, **짝 세트**(gate ↔ pool: `simulation.act` ↔ `optimize.simulation.act`)에 이미 있거나, 파일 앞 줄에 있으면 그 줄을 오류로 한다(시험 문제를 학습에 섞지 않고 같은 문항이 두 번 들어가지 않게 한다. 짝 세트가 Langfuse에 없으면 건너뛴다). **split 정하기**: pool에 올리는 줄의 `metadata.split`이 없으면 input 해시의 앞 32비트로 `train`·`val`을 정한다(같은 input은 늘 같은 쪽). 비율은 **그 풀에 이미 있는 val 문항의 비율**이라 기존 풀의 비율을 그대로 잇는다(예: train 106·val 20이면 val 약 16%). train·val 문항이 한쪽이라도 없는 풀은 비율을 알 수 없어 줄마다 `metadata.split`을 직접 적게 한다(오류 줄). 줄에 적은 `split`은 그대로 쓰고 다른 `metadata` 칸은 보존한다. 만드는 도중 Langfuse가 실패하면 이미 만든 문항을 지우고(최선: 지우기가 실패하면 그 문항은 남는다) 처음 실패를 돌려준다. 성공하면 활동 기록 `DATASET_UPLOAD`(`DATASET`·세트 이름·`<kind> · <건수>건 · <파일 이름>`, 예 `gate · 24건 · set.jsonl`)를 남긴다([활동 기록 계약](operations-admin-activity-contract.md)).

| 상태 · code | 언제 |
|---|---|
| 403 `FORBIDDEN` | `llm` 권한이 없다(입력을 읽기 전에 확인) |
| 400 `COPYRIGHT_CONFIRM_REQUIRED` | `copyrightConfirmed`가 `true`가 아니거나 없다 |
| 400 `INVALID_REQUEST` | 파일이 없다·`.jsonl`이 아니다·문항이 하나도 없다·UTF-8이 아니다, 세트 이름이 비었거나 200자를 넘는다, `page`·`size`가 범위 밖이다, Langfuse가 항목을 거절했다(세트의 스키마 검사 등) |
| 413 `DATASET_TOO_LARGE` | 문항이 500줄(빈 줄 제외)을 넘거나 파일이 2 MB를 넘는다(multipart 한도 `max-file-size=2MB`·`max-request-size=3MB`). 3 MB를 넘으면 nginx가 JSON이 아닌 413으로 먼저 끊는다 |
| 400 `DATASET_INVALID` | `{code, message, errors:[{line, message}]}` — 형식·채점기 칸이 틀린 **모든** 줄(파일의 1부터 센 줄 번호, 한 줄에 첫 문제 하나, 메시지는 화면 검사와 같은 한국어). 형식이 모두 맞은 뒤에는 이미 있는 `input`(`이 세트에 이미 있는 input이에요.`·`짝 세트(optimize.simulation.act)에 이미 있는 input이에요. 시험 문제를 학습에 섞지 않아요.`·`파일의 3번째 줄과 input이 같아요.`)과 split을 정할 수 없는 줄이 같은 모양으로 온다 |
| 404 `NOT_FOUND` | 없는 세트 |
| 502 `UPSTREAM_FAILED` | 그 밖의 Langfuse 실패 |

공개 진입점: `/api/v1/operations/llmops/` 접두는 nginx(`frontend/nginx.conf`·`infrastructure/nginx.dev.conf`)와 Vite 프록시에 이미 있어 새 경로를 열 필요가 없고, nginx는 이 접두에 한해 요청 본문을 3 MB까지 받는다(`client_max_body_size 3m`, 기본 1 MB로는 2 MB 파일이 413으로 막힌다, CI 정적 테스트가 지킨다).

화면 규칙: `.jsonl`만 받고 그 밖은 읽기 전에 거절한다. 파일을 고르면 프런트가 같은 검사(Zod, `frontend/src/domain/entities/llmDatasets.ts`)로 **미리보기**(통과 건수·첫 항목·오류 줄, 오류는 5줄까지 줄 번호·이유)를 보이고, 오류 줄이 있거나 문항이 없거나 **'저작권 있는 원문(웹소설·해리 포터 등)이 아님' 확인란**을 체크하지 않으면 올리지 못한다(올린 문항은 Langfuse에 저장되므로). 화면 검사는 위 서버 규칙 가운데 줄 형식과 세트별 필수 칸까지 같아야 하고, 이미 있는 input·split 정하기는 세트의 문항을 읽어야 해서 서버만 하며 `DATASET_INVALID`의 `errors`로 돌려준다(화면은 그 줄을 그대로 보인다). gate 세트에 올릴 때는 `notice` 문구를 올리기 전에 보인다. 서버가 다시 검사하며 다르면 서버 결과가 정본이다.

### 프롬프트 실제 모델 (#868)

운영 `GET /llmops/prompts`·`/prompts/{name}`의 버전마다 `effectiveModel: string|null`·`modelSource: 'version'|'default'|null`을 싣는다. `config.model`을 고른 버전은 그 값과 `version`, 고르지 않은 버전은 AI 서비스가 그 프롬프트에 실제로 쓰는 기본 모델과 `default`이고, AI가 답하지 못하거나 모르는 프롬프트면 둘 다 `null`이다(성공 흉내 금지, 모델 이름을 운영·프런트에 하드코딩하지 않는다). 목록·상세를 읽을 때마다 AI를 한 번 부르고, 실패해도 화면은 뜨고 버전이 고른 모델은 그대로 보인다. 등록·후보·반영 응답의 버전은 AI를 부르지 않아 고른 모델만 채운다.

AI 내부 API `GET /internal/v1/prompts/default-models`(`X-Internal-Token`, `app/prompt_models/`) → `{models: {<프롬프트 이름>: <모델|null>}}`. 기동 때 등록하는 모든 프롬프트(`app/prompts.py` SEEDS)의 항목이 있고 값은 호출 코드가 모델을 정하는 규칙의 환경·상수 쪽 그대로다(모델·Langfuse를 부르지 않는다):

- 대부분은 `OPENAI_MODEL`이고 비어 있으면 `null`이다.
- `character_simulation.plan·act·narrate·check`는 `simulation.agent`가 호출마다 정하는 값이다(act는 `SIMULATION_ACT_MODEL`, 비면 `ACT_MODEL`(gpt-6.1-terra), `SIMULATION_ACT_BASE_URL`(외부 제공사)이 있으면 `OPENAI_MODEL`).
- Decisions API를 부르는 `decision_guard.judge`·`character_simulation.direct`는 코드의 고정 모델(gpt-6-luna)이다. **한계**: 이 둘은 버전의 `config.model`을 쓰지 않는데도(AI가 무시한다) 모델을 고른 버전은 `effectiveModel`이 그 선택으로 나온다 — 응답이 '무시됨'까지는 알리지 않는다.

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
Prompt { name, versions:[{version, labels:[string], createdAt?, evaluation?:{runId, passed, createdAt}, model?, effectiveModel?, modelSource?, prompt?, commitMessage?}], candidates, evaluationDataset?, models? }   // model은 config.model(없으면 null), effectiveModel·modelSource는 위 '프롬프트 실제 모델'(모르면 null), prompt·commitMessage·models는 상세에서만, 목록의 versions는 production·seed뿐, evaluationDataset은 후보 등록에 통과가 필요한 세트(없으면 null)
EvalDataset { name, prompt?, itemCount, description? }                 // GET /llmops/datasets의 응답은 이 배열(래퍼 없음)
DatasetItem { id, input?, expectedOutput?, metadata? }                   // GET /llmops/datasets/{name}/items의 응답은 { items:[DatasetItem], total }
Model { id, modelName, matchPattern, inputPrice, outputPrice, unit }        // 가격은 토큰당 USD
Evaluation { runId, dataset, prompt, version, status(running|completed|failed), passed?, createdAt,
             metrics:[{name, score, baseline?, delta?}], items?:[EvaluationItem] }      // items는 상세에만
EvaluationItem { itemId, scores:{<지표>:0~1}, failed, error? }
OptimizationAccepted { accepted:true, prompt, version, maxMetricCalls }
LeakCheck { id, traceId, workId, checkedAt, matched:[string], suspected, reason? }
Alert { id, ruleKey, status, message, value?, targetRef?, createdAt, actedBy?, actedAt?, note? }
AlertRule { key, metric, threshold?, windowMinutes, enabled, updatedAt }
JobRun { id, kind, source, status, trigger, progress?{done,total}, startedAt?, finishedAt?, error?, targetId? }
Schedule { id, kind, cron, enabled, params, createdAt, updatedAt, lastRun?:JobRun }
```

목록 경로는 끝 슬래시 없이 부른다(Spring 6 기본). 오류는 기존 운영 공통 `{code,message}`이며 Langfuse·AI·Core·Content 실패는 502 `UPSTREAM_FAILED`(대시보드만 칸별 `unavailable`).

관리자 변경 조치(프롬프트 등록·후보 등록·서비스 반영, 자동 개선 실행(`PROMPT_OPTIMIZE`), 모델 등록, 평가 실행, 평가 데이터셋 업로드(`DATASET_UPLOAD`), 경고 처리·기준 변경, 표본 비율 변경, 일정 CRUD, 재실행)는 성공 뒤
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

tick은 일정을 보기 전에 `queued`가 10분, `running`이 30분을 넘은 기록(워커가 죽었거나 execute 호출이 실패해 남은 것)을 failed+고정 사유(작업 워커 응답 없음)로 닫아 그 일정이 영원히 막히지 않게 한다. 이 닫기와 AI 접수 실패 처리는 읽은 상태일 때만 failed로 바꾸는 조건부 UPDATE라 그사이 워커가 선점했거나 결과가 기록된 run은 덮어쓰지 않고, 접수 응답을 잃었어도 이미 워커가 선점했으면 접수된 것으로 본다. 재시작 때는 `running`을 failed로 닫는다(핸들러가 운영 프로세스 안에서 돌기 때문).

| kind | 실행 위치 | 내용 |
|---|---|---|
| `llm_alert_check` | 운영 | 경고 규칙을 Langfuse 지표·실패 작업과 비교해 경고 생성. 생성 시 운영자에게 사이트 안 알림 사건 발행 |
| `leak_sample_check` | 운영 → Content·AI | 직전 구간 Fork 작품 요청 trace를 표본 비율로 뽑고 Content가 준 원작 비공개 카드 제목·미발행 회차 제목을 답변 글자와 대조한다 → 하나라도 걸린 건만 AI `POST /internal/v1/evaluations/leak-check` `{response, references, question?}`(`references`는 걸린 제목 그대로, `question`은 사용자 질문 원문(요청 루트 관측 input의 `request`)이고 없으면 null, DeepEval)로 판정한다. 제목이 질문에 이미 있어도 걸리면 넘기고, 답변이 사용자의 말을 되풀이했을 뿐인지 비공개 내용까지 드러냈는지는 AI가 질문을 보고 판단한다 → 의심이면 `leak_suspected` 경고. 걸린 제목이 없으면 AI를 부르지 않고 `suspected=false` 결과만 남긴다 |
| `regression_eval` | AI | 운영 handler가 AI `POST /internal/v1/evaluations`로 평가를 요청만 한다(기록의 성공 = AI가 접수, `targetId`=Run 이름). AI가 Langfuse Dataset Run을 만들고, Run의 진행·결과는 작업 감시가 Langfuse에서 `kind=evaluation` 기록으로 따로 보인다 |
| `alert_cleanup` | 운영 | 90일 지난 해결 경고 삭제 |

Content 내부 `GET /internal/v1/works/{id}/leak-references`는 Fork 작품의 원작 기준 비공개 카드 제목·미발행 회차 제목을 준다(서비스 토큰, 공개 진입점 미노출).

- 대시보드 `jobs`: `running`은 대기·실행 중인 `job_run` 수 + Content 전처리 `queued`·`running`·`loading` 수 + 실행 중인 회귀 평가 수, `failedLast24h`는 최근 24시간 안에 끝난 `FAILED` `job_run` 수 + 같은 24시간 안에 끝난 Content 전처리 `failed` 수 + 시작이 24시간 안인 실패한 회귀 평가 수다(Content 쪽은 최신 100건, 평가는 끝난 시각이 없고 최신 50개만 읽는다). Content나 Langfuse를 읽지 못하면 일부만 센 값을 보이지 않고 이 칸을 `null`로 하며 `unavailable`에 그 출처(`content`·`langfuse`)를 한 번만 적는다(평가는 Content 집계가 끝난 뒤에만 읽고, Langfuse가 이미 실패했으면 다시 읽지 않는다).
- `llm_alert_check`의 `job_failed`(metric `failed_jobs`) 판정: 규칙 `windowMinutes` 안에 끝난 `FAILED` `job_run` 수 + Content 전처리 `failed` 수(위 `failedLast24h`에서 회귀 평가 실행을 뺀 집계: Langfuse가 내려가도 판정이 계속돼야 하고 경고 검사의 실패가 `job_failed`에 잡혀야 하므로 평가는 세지 않는다)가 `threshold` 이상이면 값=건수로 경고를 만든다. 실패가 0건이면 `threshold`가 0이어도 만들지 않고, 같은 규칙의 미해결 경고가 있으면 다시 만들지 않는다. Langfuse(AI 규칙)와 Content(`job_failed`)는 따로 읽어 한쪽이 내려가도 다른 쪽을 평가하고, 읽지 못한 쪽이 있으면 둘 다 시도한 뒤 실행이 실패한다.

## 프롬프트 자동 개선 (#823, 2026-11-24 사용자 결정)

LLMOps 화면의 `자동 개선` 버튼이 시뮬레이션 지시문의 새 버전을 만든다. 운영은 접수만 하고(위 API) 실행은 AI 작업 워커(`ai-jobs-worker`, 큐 `jobs`)가 한다. 최적화 가능 프롬프트와 그 게이트 세트·최적화 풀은 다음 둘이다(운영·AI가 각자 상수로 갖는다).

| 프롬프트 | 게이트 세트(회귀 평가) | 최적화 풀(저장소 파일 → seed가 Langfuse Dataset `optimize.<게이트 세트>`로 등록) |
|---|---|---|
| `character_simulation.act` | `simulation.act` | `app/evaluation/datasets/optimize/simulation.act.jsonl` → Dataset `optimize.simulation.act` |
| `character_simulation.narrate` | `simulation.narrate` | `app/evaluation/datasets/optimize/simulation.narrate.jsonl` → Dataset `optimize.simulation.narrate` |

최적화 풀은 원문 평가 공개 세트(저작권 만료 고전·근대 소설과 CC BY-SA 3.0 SCP 이야기, 해리 포터 없음) 중 **게이트 세트가 쓰지 않은 나머지 문항**이다(`orig_cli.py export --pool`, 호출 없음). 항목 모양은 게이트 세트와 같고 `metadata.split`이 `train`·`val`이다. **풀도 Langfuse Dataset이다**(#868, 2026-11-25 사용자 결정): `python -m app.evaluation.seed`(`ai-eval-seed`)가 `datasets/*.jsonl`(게이트 세트)과 함께 `datasets/optimize/*.jsonl`을 `optimize.<파일 이름>`(예 `optimize.simulation.act`)로 멱등 등록한다(공개 세트만, 해리 포터·웹소설은 계속 로컬 전용). 그래서 운영 화면의 업로드가 풀에도 문항을 더하고, **`optimization.service.load_pool`은 Langfuse 키가 있으면 Dataset `optimize.<세트>`에서 읽는다**(`metadata.split`으로 train·val, 운영 업로드 문항 포함). 읽지 못하면 저장소 파일로 몰래 바꾸지 않고 503으로 실패하며(없는 Dataset은 `ai-eval-seed`를 다시 실행하라는 고정 문구), 키가 없는 로컬 오프라인 평가에서만 저장소 파일을 읽는다. 게이트 세트의 문항이 바뀌면 기준 Run이 무효가 된다(위 '순서·기준 Run': 다음 평가가 production 버전을 먼저 다시 평가한다). 게이트 세트가 최적화가 한 번도 보지 못한 검증 세트가 되도록 **풀과 게이트는 같은 input을 나누어 갖지 않는다**(seed 파일은 단위 테스트가, 운영 업로드는 짝 세트 검사가 지킨다).

| 단계 | 내용 |
|---|---|
| 접수 | 운영이 `llm` 권한·최적화 가능 프롬프트·버전 존재를 확인하고 AI 내부 `POST /internal/v1/optimizations` `{prompt, version, maxMetricCalls}`(`X-Internal-Token`)를 부른다. AI는 지원 대상이 아니면 422, 같은 프롬프트의 개선이 실행 중이면 409 `{"detail": …}`(운영은 그대로 409 `OPTIMIZATION_RUNNING`)이고, 아니면 Celery `jobs` 큐 태스크 `optimization.run`을 올려 202 `{accepted:true}`를 돌려준다(올리지 못하면 503). **이 태스크만 `acks_late=False`다**: 개선은 수십 분 걸려 RabbitMQ 확인 제한(기본 30분)을 넘기면 같은 작업이 다시 배달돼 처음부터 다시 돌고 과금이 두 번 되기 때문이다(죽은 워커의 개선을 자동으로 이어 받지 않는다) |
| 동시 실행 | 프롬프트별 1건. 워커가 AI 체크포인트 DB(`AI_CHECKPOINT_DATABASE_URL`)의 Postgres advisory lock(세션 잠금, 키 `prompt_optimization:<이름>`)을 실행 내내 잡고, 접수도 같은 잠금을 한 번 잡았다 놓아 실행 중인지 본다. 큐에서 기다리는 사이의 접수는 막지 못한다(워커가 시작할 때 잠금을 못 잡으면 그 실행은 trace ERROR로 끝난다) |
| 기준 평가 | 풀 읽기(Langfuse 키가 있으면 Dataset `optimize.<세트>`)·`gepa` 설치·**반성 게이트웨이**(반성 모델에 짧은 호출 1회, 로컬 게이트웨이라 OpenAI 호출이 아니다)를 먼저 확인해 어긋나면 OpenAI 호출 없이 ERROR로 끝낸다. 그 뒤 게이트 세트에 현재 production 버전의 **유효한** 기준 Run(그 세트의 마지막 문항이 만들어지거나 바뀐 뒤에 시작한 끝난 Run, 회귀 평가와 같은 `evaluation.baseline_run` 규칙)이 없으면 먼저 그 평가를 돌린다(기준 Run이 없으면 새 버전이 실패 항목만 없어도 통과해 무엇이든 후보가 되기 때문) |
| 개선 | GEPA(`gepa.optimize`)가 `{instructions: <기준 버전 본문>}`을 시드로 풀의 train으로 반성하고 val로 고른다. 안쪽 평가는 항목마다 `simulation.generate`(생성)와 루브릭 채점을 **직접 호출**하고 Langfuse Dataset Run을 만들지 않는다(minibatch마다 Run이 생겨 평가 목록·기준 Run 탐색 창(최근 100개)을 밀어내기 때문). 항목 점수는 그 세트 지표(act `voice`·`intent`·`pov_ok`, narrate `style`·`info`·`pov_ok`, 0~1)의 평균이다. 반성 입력은 모델 입력·생성 글·정답(원작의 다음 글)·지표 점수·위반 사실 본문(`metadata.judge.facts`)이고 루브릭 문구는 바꾸지 않는다(기준 Run과 어긋난다). 생성·채점이 실패한 항목은 0점으로 두되 **실패 호출이 전체의 20%를 넘으면 중단하고 trace를 ERROR로 남긴다**(실패를 점수로 숨기지 않는다) |
| 저장 | 최고 후보가 `best − seed ≥ 0.05`(seed = 기준 본문의 val 평균)일 때만 저장한다: 지표 표준오차가 0.03~0.08이라 후보 여럿 중 최고를 고르면 잡음만으로 시드를 넘기 때문이다. 그리고 ① `app/simulation/prompt.py`의 `SAFETY` 문장을 포함하고 ② 길이가 기준 본문의 2배 이하여야 한다. 어긋나면 저장하지 않고 이유를 trace에 남긴다. 저장은 Langfuse 새 버전(**라벨 없음**, 기준 버전의 `config`를 이어받음)이고 `commitMessage`는 `GEPA 자동 개선: 기준 v{n}, val {seed}→{best}, 평가 Run {run}`이다 |
| 회귀 평가 | 저장한 버전을 게이트 세트로 평가하는 Run **1회**(기준 Run 비교·`passed`는 기존 규칙 그대로)로 자동 범위가 끝난다. Run 이름은 저장 전에 만든다(commitMessage에 넣어야 하므로 예상 버전 = 최신 버전 + 1을 쓰고, 저장된 버전 번호가 다르면 평가 없이 ERROR로 끝난다). 기준·회귀 평가 Run은 정식 평가처럼 **자기 trace로** 돈다(`prompt_optimization` trace 문맥 밖의 새 스레드에서 실행해 항목 span이 이 trace에 붙지 않는다, 실패는 그대로 올라와 trace를 ERROR로 끝낸다) |
| 끝난 뒤 | 후보 등록(`PUT …/candidate`)과 서비스 반영(`PUT …/production`)은 사람이 기존 화면 버튼으로 한다. 후보 등록은 평가 게이트(#787)를 그대로 지난다 |

- **결과 가시성**: 개선 1건 = trace `prompt_optimization`(요청 루트 관측 이름·태그 `feature:prompt_optimization`). 시작 때 metadata `prompt`·`baseVersion`·`maxMetricCalls`, 끝날 때 `seedScore`·`bestScore`·`savedVersion`·`baselineRun`(기준 평가를 했을 때)·`evaluationRun`(두 평가 Run은 이름만 남기고 항목 호출은 각 Run의 trace에 있다)·`outcome`(`saved`·`no_improvement`·`rejected`)과 저장하지 않았을 때의 이유 `reason`(`개선 없음`, 또는 SAFETY·길이 검사 실패 문구)을 남긴다. 실패면 level ERROR와 고정 사유다. GEPA 안쪽 생성·채점 호출은 그 trace의 generation(`simulation.act`·`evaluation.rubric_grade`)으로 남아 비용이 보이고 반성 모델 호출은 모델·사용량만 남긴다(본문 없음). 워커 로그는 GEPA의 점수 줄만 남기고(반성 지시문 본문·예외 메시지는 버린다, #852) 예기치 않은 예외는 클래스 이름과 호출 경로만 남긴다(메시지 없음, #850).
- **반성 모델 경로**: `PROMPT_OPTIMIZER_BASE_URL`(로컬 `.env` 예 `http://host.docker.internal:10100/v1`, 비면 기본 OpenAI)·`PROMPT_OPTIMIZER_API_KEY`(비면 `OPENAI_API_KEY`)·`PROMPT_OPTIMIZER_MODEL`(기본 `gpt-6-sol`). 게이트웨이의 Responses 호출은 `input`이 메시지 목록이고 `store=False`일 때만 된다. 구독 게이트웨이의 429·일시 오류는 SDK가 두 번까지 다시 시도한다(`max_retries=2`). Docker Desktop이 아닌 Linux에서는 `host.docker.internal`이 자동으로 풀리지 않아 compose가 반성을 부르는 `ai-jobs-worker`에도 `extra_hosts: host.docker.internal:host-gateway`를 준다. 컨테이너가 `host.docker.internal`로 부르면 로컬 OpenCodex 게이트웨이가 `Host`가 `localhost`·`127.0.0.1`·`[::1]`이 아니라는 이유로 403(`origin_rejected`, DNS 재바인딩 방어, API 키로도 못 지난다)을 돌려주므로, AI가 그 이름일 때만 `Host: localhost:<포트>`로 바꿔 보낸다(`agent._headers`, #841 첫 실행에서 확인). 생성·채점은 이 설정과 무관하게 OpenAI API 키다.
- **예상 호출·시간**: 화면이 보이는 OpenAI 호출 수 어림 = `2 × maxMetricCalls`(생성 + 채점) `+ 2 ×` 게이트 세트 문항 수(회귀 평가: act 24·narrate 46, 화면 상수)이고 유효한 기준 Run이 없으면(게이트 세트에 문항을 올린 직후 포함) 그만큼 더 든다(반성 모델 호출은 로컬 게이트웨이라 OpenAI 호출이 아니다). act 첫 실행 실측은 상한 150에 약 9~10분·OpenAI 호출 384건·약 0.65달러다([첫 실행 결과](../evaluation/prompt-optimization.md#첫-실행-결과-841-2026-11-24), 처음 어림은 호출당 2~3초에 항목 5개 동시면 20~45분이었다). narrate는 아직 재지 않았다.

### 평가 항목 결과(실패 로그)

운영 상세 `GET /llmops/evaluations/{runId}`는 지표 평균에 더해 문항별 결과 `items`를 싣는다(목록은 싣지 않는다). AI는 지금처럼 항목마다 trace 점수(점수 이름 = 지표 이름, `pov_ok` 점수의 comment에 위반 사실 id)를 남기고, 운영은 Langfuse **Experiments items API**(`GET /api/public/experiment-items?experimentId&fromStartTime&fields=core,scores`)로 Run의 항목과 항목 점수를 읽는다(v4는 Dataset Run items GET이 404다). 입력·출력·정답 본문은 읽지도 싣지도 않는다.

`items:[{itemId, scores:{<지표>:0~1}, failed, error?}]`: `itemId`는 평가 세트 항목 id(Experiments의 `experimentItemId`)다. 문항 `failed` = ① 항목 오류(생성 실패: 항목 관측 level ERROR, 채점 실패: 항목 점수 없음 — **끝난 Run에서만**) ② `pov_ok`가 0(위반 사실 있음) ③ 지표 하나라도 0.5 미만. `error`는 ①일 때만 고정 문구(`생성 또는 채점에 실패했어요.`)다. 실행 중인 Run(`status=running`)에서 점수가 아직 없는 문항은 생성·채점 중이라 실패로 보지 않고 `failed=false`·`scores={}`·`error` 없음으로 주며(화면은 '진행 중'), Run이 끝나거나 실패로 판정된 뒤에야 점수 없음이 실패다. 정렬은 실패 먼저·항목 id 순이다.
## 사이트 안 알림

경고가 생기면 운영 서비스가 기존 교환기 `storyfork.events`에 `operations.alert.raised`(recipient = `llm` 또는 `jobs` 권한을 가진 운영자마다 한 건)를 발행하고 Core가 알림함에 넣는다.
운영 서비스에 AMQP 연결(`spring-boot-starter-amqp`, Core가 이미 쓰는 의존성)이 더해진다.

## 실행 연결

- nginx·Vite: `/api/v1/operations/{dashboard,llmops,alerts,jobs}`와 하위 경로를 Operations로. Langfuse 웹은 공개 진입점에 열지 않는다(개발자용 별도 포트).
- env: 운영 `OPERATIONS_LANGFUSE_BASE_URL`·`LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY`(AI와 같은 프로젝트 키), `OPERATIONS_AI_BASE_URL`·`INTERNAL_TOKEN`(AI 내부 호출, 그리고 AI 작업 워커가 운영 `/internal/v1/jobs/**`를 부를 때 받는 쪽 인증. AI 워커는 `OPERATIONS_SERVICE_BASE_URL`로 운영을 부르고 `/internal/**`은 공개 진입점(nginx·Vite)에 열지 않는다), RabbitMQ 접속값. Langfuse 프로젝트·키는 `LANGFUSE_INIT_*` 헤드리스 초기화로 만든다.
- AI 평가 의존성 `ragas`·`deepeval`과 자동 개선 의존성 `gepa`(MIT, #823 사용자 승인)는 `[project.optional-dependencies] eval`에 두고 평가를 실행하는 이미지(worker)만 설치한다. 자동 개선은 `PROMPT_OPTIMIZER_BASE_URL`·`PROMPT_OPTIMIZER_API_KEY`·`PROMPT_OPTIMIZER_MODEL`(위 '프롬프트 자동 개선')을 AI 작업 워커에 넘긴다.

## 단계

1. Core 통계 · 운영 대시보드·추적·지표 중계 · AI 계측 보강 · Langfuse Compose · 프런트 `data`·`llm` 추적/지표 화면 (병렬)
2. 프롬프트 이관·모델 정의 → 회귀 평가 → 경고 규칙·알림 → 누설 표본 검사
3. 작업 감시: 운영 스케줄러·일정 CRUD는 1단계와 병렬, 전처리 작업 목록은 #343(전처리) 병합 후 연결

## ponytail 한계

- 운영 화면의 지표는 Langfuse 집계를 요청마다 읽는다(캐시 없음). 느려지면 정기 작업 스냅샷 테이블로 바꾼다.
- 사용자 부담 비용은 AI 요청이 Core 크레딧 예약을 쓰기 시작해야 0이 아니게 된다.
- 필터 복원률은 콘텐츠 필터 기능이 생기기 전까지 비어 있다.
- 회귀 평가의 비용 상한이 없다(추후 결정). 평가는 관리자 실행·켠 일정으로만 돈다. 자동 개선만 `maxMetricCalls`(기본 150·상한 500) 상한이 있다.
- 시뮬레이션 세트는 항목이 24·46개라 같은 항목을 두 지시문으로 돌린 차이에 잡음이 있다. 로컬 확인(12·23항목)의 표준오차는 0~1 눈금에서 act 의도 0.077·말투 0.042·시점 0.083, narrate 문체 0.035·정보 0.027이다(전체 세트면 1/√2쯤). 기본 `EVAL_TOLERANCE` 0.1(Compose가 `.env`의 값을 AI 컨테이너로 넘기고 비면 0.1)은 낫지도 나쁘지도 않은 변경이 잡음만으로 불통과가 되는 일을 줄이지만 없애지는 못한다: act 의도는 표준오차의 1.3배라 12항목 기준 어림으로 10% 안팎이 불통과일 수 있다(24항목이면 4% 안팎). 로컬 확인(채점 `gpt-6.2-sol`)의 항목별 기록을 새 기준으로 **다시 판정만** 하면(추가 호출 없음) P1은 `voice` +0.042·`intent` −0.083·`pov_ok` +0.083, N3는 `style` +0.022·`info` −0.022·`pov_ok` 0이라 둘 다 통과가 예상된다(처음 1~5점 기록과 허용 오차 0.05로는 둘 다 불통과였다). 세부는 [v3 보고서 6장](../evaluation/simulation-v3.md#6-운영-화면에서-p1n3-반영하는-절차)이다.
- 운영 스케줄러는 단일 인스턴스를 가정한다(DB 잠금 없음). 여러 대로 늘리거나 Airflow로 옮길 때 실행 주체를 하나로 바꾼다. (handler 실행은 AI 작업 워커 여러 개가 병렬로 부르지만 `queued`→`running` 선점이 조건부 UPDATE라 한 기록은 한 번만 돈다.)
- 멈춘 기록 정리의 한도(queued 10분·running 30분)는 고정 상수다. 30분을 넘겨 도는 handler는 실패로 기록된 뒤 끝나면 자기 결과로 덮어쓰고, 그동안 같은 일정이 다음 기록을 만들 수 있다. 한도가 모자라는 작업이 생기면 설정으로 바꾼다.
- 작업 워커 큐 `jobs`는 평가와 정기 작업이 같이 쓰므로 긴 평가가 워커를 모두 차지하면 정기 작업 기록이 `queued`로 기다리고, 10분을 넘기면 위 정리가 실패로 닫는다(워커 수는 `AI_JOBS_CONCURRENCY`).
- 자동 개선(#823)은 프롬프트별 1건만 잠금으로 막고 큐에서 기다리는 사이의 두 번째 접수는 막지 못한다(그 실행은 시작할 때 잠금을 못 잡아 ERROR로 끝난다). 긴 개선이 `jobs` 큐 워커를 오래 차지하므로 개선 중에는 정기 작업 기록이 `queued`로 기다린다(10분을 넘기면 위 정리가 실패로 닫는다).
- 자동 개선의 저장 여유 0.05·실패율 20%·val 20문항·동시 5건은 고정값이다. val이 작아 후보 고르기에 잡음이 있고 최종 확인은 게이트 세트 Run이다(그 Run도 24·46문항이라 위 표준오차가 그대로 적용된다). 예상 버전(최신 + 1)과 저장된 버전이 다른 드문 경쟁은 평가 없이 끝나고 저장된 라벨 없는 버전만 남는다.
- GEPA는 평가 호출 상한을 반복 단위로 확인해 상한을 조금 넘길 수 있다(실측: 상한 40에 호출 42, 최대 val 문항 수 + minibatch 2회쯤). 화면의 예상 호출 수는 어림이다.
- 죽은 워커의 개선은 자동으로 이어 받지 않는다(`acks_late=False`): 끝나지 않은 trace(`status` 없음)가 남고 다시 누르면 처음부터 돈다. 안쪽 평가가 건너뛴 Langfuse Dataset Run 대신 trace의 generation(생성·채점)으로만 비용이 남는다. 채점 응답이 잘린 JSON이면 SDK가 응답 대신 예외를 올려 그 호출의 토큰은 generation에 없다(ERROR 한 줄, 드문 실패).
- 평가 상세 `items`는 Experiments items API의 앞 100개까지만 읽고(게이트 세트 24·46문항), 항목 생성·채점 실패의 사유는 고정 문구 하나다(원인은 AI 로그·trace에서 본다).
- 에이전트별 평가 표(#837)의 최근 결과는 평가 목록(최근 50건) 안에서만 찾아, 그보다 오래전 Run뿐인 세트는 '실행한 평가 없음'으로 보인다. 행 목록은 프런트 상수라 세트가 생기면(Decision Guard 라우팅·설정 추출 등) 상수와 [검색 품질 평가 §1.1](../evaluation/retrieval.md#11-llmops-화면의-에이전트별-평가-표)을 함께 고친다.
- 평가 데이터셋 업로드(#868 확대)의 한계: 중복 input은 정규화 JSON의 해시라 정수 `1`과 실수 `1.0`, 글자만 조금 다른 비슷한 문항은 같게 보지 않는다. 세트와 짝 세트의 기존 문항을 모두 읽어(문항 API 100개씩) 비교하므로 아주 큰 세트는 업로드가 느리다. 업로드와 평가·개선이 동시에 돌아도 서로 막지 않는다(기준 유무는 접수 때 정하고 큐에서 기다리는 사이 세트가 바뀌어도 다시 보지 않는다). 풀 `split`은 올릴 때의 기존 val 비율(act 약 16%)로 정하므로 풀이 자라면 val 문항 수도 따라 자라 GEPA의 val 평가 비용이 는다(원래 val은 풀마다 20문항 고정).
- `GET /llmops/datasets`는 호출마다 모든 세트의 모든 문항을 읽는다(`lastItemAt`을 문항 목록의 순서에 기대지 않고 최댓값으로 구하려고). 세트·풀이 커지면(풀 문항은 항목당 수 KB~수십 KB) 느려진다. 느려지면 Langfuse가 최신순을 보장하는지 확인해 첫 문항만 읽거나 정기 작업 스냅샷으로 바꾼다.
- seed의 '같은 내용' 판정은 `input`·`expectedOutput`·`metadata`의 값 비교다(객체의 키 순서는 상관없다). 문항 상태(보관)는 보지 않아, 보관한 seed 문항은 내용이 같으면 다시 켜지 않는다(이전에는 매 배포가 다시 올려 켜졌다).
- 기준 Run 탐색(`baseline_run`)은 그 세트의 최근 100개 실험만 본다. 같은 세트의 Run이 그보다 많으면 유효한 기준이 있어도 못 찾아 production 버전을 다시 평가한다(비용 두 배, cursor 페이지는 필요해질 때 더한다).
