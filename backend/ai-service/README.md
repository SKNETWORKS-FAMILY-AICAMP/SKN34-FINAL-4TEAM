# STORYFORK AI Service

FastAPI 기반 내부 서비스입니다. Health와 내부 인증이 필요한 `POST /internal/v1/proposals` 생성 API를 제공합니다. 실행·검증 상태는 [콘텐츠 통합 안내](../../docs/content-integration.md)를 참고하세요.
현재 Core Service의 `core-api` 모듈이 Health와 콘텐츠 생성 API를 호출합니다. Compose에서 AI Service의 호스트 포트는 공개하지 않습니다.

## 목표 서비스 경계 (DEC-41)

[4개 서비스 구조](../../docs/design/service-boundaries.md)는 Core(회원·인증·크레딧·회원 알림), 별도 Kotlin/Spring Boot 콘텐츠 앱(창작·독서 정본·콘텐츠 인가·채택·발행), 별도 Kotlin/Spring Boot 운영 앱(문의·공지·신고 사건·운영 결정·감사·작업 감시), 이 Python AI 앱(모델 실행)으로 나뉩니다. 콘텐츠·운영은 필요한 AI 작업을 요청하며 호출·인증·사용량·정산·알림 계약은 후속 설계합니다. 현재 콘텐츠 호출자는 분리 전 `core-api`이며 별도 콘텐츠·운영 앱은 아직 없습니다. 아래 실행 명령·내부 토큰·Compose 경로는 현행 구성입니다.

## 실행과 검증

Python `>=3.11,<3.15`와 uv를 사용합니다.

```bash
uv sync --locked --extra dev
uv run --locked uvicorn app.main:create_app --factory --reload --port 8000
```

로컬 개발 검증은 변경·직접 영향 범위의 **단위 테스트만** 선택합니다. TestClient·HTTP는 통합 계층이며 로컬에서 통합/시스템·전체 suite·컨테이너를 실행하지 않습니다.

```bash
uv run --locked --extra dev python -m pytest -m 'not integration' tests/generation/test_agent.py -k missing_key
```

CI는 AI 서비스가 선택되면 lock 검사 후 pytest `-m 'not integration'` → `-m integration`으로 각각 한 번 실행합니다.
워크플로가 이 디렉터리에서 `uv run --locked --extra dev python -m pytest`와 해당 marker를 직접 호출하며 별도 runner·shell wrapper는 없습니다.
제공사 단위 테스트는 monkeypatch 대역이며 AI 계약 변경 시 Core·web 소비자와 실제 HTTP 시스템 회귀도 선택합니다.
시스템의 AI 키/모델은 빈 값으로 고정해 명시적인 503과 DB 실패 상태를 확인하며 유료 모델은 호출하지 않습니다.
자세한 선택/계층 정책은 [공통 검증](../../docs/development.md#검증)을 따릅니다. hosted `Required CI` 성공 확인 전에는 검증 대기입니다.

`GET /internal/v1/health`는 `{"status":"up","service":"storyfork-ai-service"}`를 반환합니다.
실제 흐름은 `HTTP → health/router.py → HealthResponse → JSON`입니다.
`app/main.py`는 FastAPI와 Health·generation router를 조립합니다. 시작 시 모델·네트워크 자원을 생성하지 않으므로
설정 객체·컨테이너·종료용 lifespan은 필요하지 않습니다.

## OpenAI와 향후 경계

[최신 MVP 설계](../../docs/design/design.md)의 최종 모델·제공사·에이전트 프레임워크는 미정입니다. **현재 생성 구현은 `openai` SDK의 Responses API를 사용**하며, 이는 전체 역할·다중 에이전트 구성을 확정한 것이 아닙니다. 집필 AI 복합 실행은 사용자 요청으로 LangGraph를, 인물 시뮬레이션의 장면 에이전트는 사용자 결정(2026-11-14, #362)으로 LangChain `create_agent` + 미들웨어를 쓰며(연출 결정은 `langchain-typesafe`로 OpenAI Decisions 호출), 그 밖의 에이전트 구성은 확정하지 않았습니다. `openai-agents` 의존성은 남아 있지만 현재 실행 코드에서 Agent를 구성하지 않습니다.
Health는 키 없이 시작하고 OpenAI 클라이언트를 만들거나 호출하지 않습니다.
루트 `.env`의 `OPENAI_API_KEY`와 `OPENAI_MODEL`은 생성 요청 시 AI 런타임에서만 읽습니다.
Core와 동일한 `INTERNAL_TOKEN`이 필요합니다. Responses API의 실제 모델·응답 ID·사용량을 반환하고 정본은 변경하지 않습니다. Health 성공은 모델 접근 성공을 뜻하지 않습니다.
직접 실행은 루트 `.env`를 자동으로 읽지 않습니다. AI에 필요한 `OPENAI_API_KEY`, `OPENAI_MODEL`, `INTERNAL_TOKEN`만 해당 터미널에 설정합니다. 자동 설정 전달은 공통 `docker-compose.yaml`과 prod/dev 조합을 사용합니다([인프라 안내](../../infrastructure/README.md)).
prod는 소스 빌드 이미지, dev는 CI가 게시한 `:develop` 이미지를 사용하며 둘 다 키·모델은 AI에만, 내부 토큰은 Core·AI에만 전달합니다. 공통/prod의 모델 기본값은 비어 있고 dev의 기존 `gpt-5.6-luna` 기본값은 유지합니다. 실제 모델 접근 검증을 뜻하지 않습니다.

콘텐츠 정본·콘텐츠 인가·채택·발행은 목표 콘텐츠 서비스, 회원·인증·크레딧·회원 알림은 Core, 운영 판단은 운영 서비스가 소유하며 AI가 직접 확정하지 않습니다. 현재 허용 문맥 구성·생성 작업 기록·제안 채택은 `core-api`의 콘텐츠 코드가 담당합니다. 향후에도 문서·원고와 그래프 관계는 같은 기준 버전·허용 범위를 따라야 하며 조회 경로는 후속 설계합니다. 장애를 정상 결과로 숨기는 fallback이나 Agent별 서버는 추가하지 않습니다.

LLMOps는 운영 영역이고 정본은 self-host Langfuse입니다. 운영 화면이 그 Public API로 통합하며 Spring Boot로 전체 기능을 재구현하지 않습니다([계약](../../docs/design/operations-llmops-contract.md)). AI 런타임은 요청마다 trace 하나를 남깁니다: 요청 루트 관측 하나가 요청 전체(SSE는 `done`까지)를 덮고, 루트와 모든 하위 observation에 회원 UUID·세션·기능 태그(`feature:<키>`)·metadata(`request_id`·`work_id`·`fork`)가 붙으며 상태(`success|failed|timeout`)는 루트의 metadata `status`입니다. 모델 호출은 generation(모델·사용량·프롬프트 버전)이고 모델 지시문은 Langfuse 프롬프트(`production` 버전, 이름 `<기능>.<용도>`)를 읽어 씁니다. `LANGFUSE_PUBLIC_KEY`·`LANGFUSE_SECRET_KEY`가 없으면 추적을 끄고 코드의 지시문을 씁니다. 컨테이너를 종료(SIGTERM)할 때는 아직 보내지 않은 추적을 먼저 보내고 끝납니다.
구현 기준은 [AGENTS.md](AGENTS.md), [Agent 구현 경계](docs/agent-structure.md)를 따릅니다.

## 초기 세계관 추출 (5-B)

`POST /internal/v1/initial-world/extractions`는 기존 내부 토큰·OpenAI 설정으로 #219 Input을 받아 검증된 후보 Output만 반환합니다. 실제 모델 호출 경로는 구현했지만 유료 호출·추출 품질은 미검증입니다. 저장·승인·Content 실행 연결은 제외하며 [호출/실패 계약과 검증 한계](../../docs/design/initial-world-ai-extraction.md)를 따릅니다. 기존 이어쓰기 API는 유지합니다.

## 인물 시뮬레이션 턴 속도 스위치와 성적표 (#642)

턴 하나는 연출 결정(Decisions) → 대사·나레이션 생성 → 검사(위반 시 최대 2회 재생성)의 모델 호출을 차례로 기다린다. 모델은 `gpt-6-luna`로 두고, 아래 스위치가 대기 시간을 얼마나 줄이고 품질을 얼마나 잃는지
[성적표](../../docs/evaluation/simulation.md)로 잰다. 스위치는 **호출 때 읽고, 기본값(빈 값)은 지금 동작 그대로**다. `.env.example`에는 빈 기본값 주석으로 있고 compose는 이 값을 AI 컨테이너에 넘기지 않는다(성적표는 프로세스 환경에서 직접 읽는다. 채택하면 base compose·인프라 문서에 연결한다).

| 환경 변수 | 값 | 효과 |
|---|---|---|
| `SIMULATION_REASONING_EFFORT` | `none`·`minimal`·`low`·`medium`·`high`(비우면 지정 안 함) | 계획·인물 턴·나레이션·검사 호출(`agent._parse`)의 `responses.parse`에 `reasoning={'effort': 값}`을 보낸다. 그 밖의 값은 모델을 부르기 전에 503 설정 오류다 |
| `SIMULATION_SKIP_FORCED_DIRECTOR` | `1` | `service.rules`가 고를 턴을 하나로 정했고 그 턴이 대사가 아니면(시작·메모·비트 전환·마무리) 연출 모델을 부르지 않는다. 시점은 직전 턴 시점이고 없으면 전지적이다. 독백은 직전 시점이 인물 시점일 때만 생략한다(`director.forced`) |
| `SIMULATION_WORLD_CACHE` | `1` | 대화 모드에서 resume마다 다시 읽는 세계관(`world_studio_read` 둘)을 프로세스 안에서 재사용한다. 목록(`world_studio_list`)은 매번 부르고, 그 `draftRevision`이 같고 `relationshipStatus`가 `current`일 때만 (세계관, 기준 회차) 칸을 쓴다. 고친 세계관은 revision이 올라 다음 요청에 반영된다(#356). Fork 이어받기와 원고 발췌 검색은 캐시하지 않는다(칸은 32개까지) |
| `SIMULATION_SKIP_NARRATION_CHECK` | `1` | 전지적(omniscient) 나레이션 턴은 검사 모델을 부르지 않고 통과로 붙인다. 서버 규칙 검사(`_problem`)와 인물 시점 나레이션·독백·대사의 검사는 그대로다 |

성적표 실행기는 [`eval/simulation/`](eval/simulation/README.md)에 있다(`prepare`·`estimate`·`run`·`report`, 해리 포터 원문 기반 세계관은 `build-hp`·`show-hp`·`seed-hp`와 `--world hp`). `run`·`build-hp`는 실제 OpenAI를 부르므로 비용 승인 뒤에만 쓴다(OpenAI 상한에 닿으면 `--via ocx`로 이어 받는 안내가 나온다).
스위치마다 켰을 때·껐을 때의 호출 수를 단위 테스트가 단언한다: `uv run --locked --extra dev python -m pytest -m 'not integration' tests/simulation eval/simulation`.

## 회귀 평가·누설 판정 (DEC-55)

운영 서비스가 부르는 내부 API입니다([계약](../../docs/design/operations-llmops-contract.md)). Langfuse 4.x(`events_only`) 기준이며 `ragas`·`deepeval`은 `--extra eval`입니다(AI 이미지에는 설치하고, 단위 테스트는 설치 없이 통과합니다).

| 경로 | 내용 |
|---|---|
| `POST /internal/v1/evaluations` `{dataset, prompt, version}` | 평가 세트·프롬프트 버전·설정을 확인한 뒤 `202 {runName}`을 먼저 돌려주고 백그라운드로 평가합니다 |
| `POST /internal/v1/evaluations/leak-check` `{response, references[], question?}` | 응답이 비공개 참조를 드러내는지 GEval 한 번으로 판정해 `{suspected, reason}`을 돌려줍니다. 사용자 질문 원문 `question`(선택)을 주면 질문에 이미 나온 이름을 되풀이하거나 근거가 없다고 답한 응답은 의심하지 않고 비공개 참조의 내용을 새로 알려 줄 때만 의심합니다 |

결과는 Langfuse Experiments API(`GET /api/public/experiments?fromStartTime=…&name=<runName>&fields=core,metadata,scores`)로 읽습니다.

- 실험 이름은 `runName`(`<프롬프트>@v<버전>-<UTC yyyymmddTHHMMSSZ>-<hex6>`)이고 `fields=metadata`로 읽는 `metadata`에는 `prompt`·`version`·`dataset`·`tolerance`·`baselineRun`·`baselineVersion`(모두 문자열)을 실어 보냅니다(서버가 돌려주는 모양은 실서버 확인 전).
- Run 수준 점수는 `scores`에 있고 실험 id(`Experiment.id`)를 `datasetRunId`로 단 것입니다(Scores v3는 `experimentId`). `passed`(BOOLEAN, metadata `failedItems`·`totalItems`·`tolerance`·`baselineRun`·`baselineVersion`)와 지표 평균(NUMERIC, metadata `baseline`·`delta`·`tolerance`)이며, `qa.` 평가 세트는 `faithfulness`·`context_precision`, 그 밖은 `geval`입니다. `passed`가 없으면 실행 중입니다.
- 항목 점수는 항목 trace에 같은 이름으로 남습니다.

평가 세트는 `app/evaluation/datasets/*.jsonl`(저작권 만료 작품만)이고 `python -m app.evaluation.seed`로 Langfuse에 멱등 등록합니다. 설정은 `OPENAI_API_KEY`·`OPENAI_MODEL`(채점 모델 겸용)·`LANGFUSE_*`·`INTERNAL_TOKEN`이고 선택 `EVAL_TOLERANCE`(기본 0.05)가 있습니다.
