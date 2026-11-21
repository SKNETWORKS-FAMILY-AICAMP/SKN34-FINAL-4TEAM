# AI 파이프라인 관찰 대시보드 계약 (DEC-58)

LLM Ops `프롬프트·모델` 쪽(`/admin?tab=llm&view=prompts`)에 **전체** 보기를 더해, 집필 AI 파이프라인 전체를 캔버스 그래프로 보이고
노드(Decision Guard·메인 에이전트·업무 Agent·도구)를 누르면 그 노드가 실제로 어떻게 판정·처리했는지 모든 기록을 보인다.
목적은 프롬프트 개선이다(Decision Guard는 OpenAI Decisions 판정 모델이라 프롬프트로 고친다). 평가 세트를 이 화면에서 만드는 일은 다음 단계다.

## 결정 (2026-11-20 사용자 결정)

- 화면: `프롬프트·모델` 쪽 위에 보기 전환 `전체 | 프롬프트 | 모델`(주소 `&sub=`, 없으면 전체). 전체 = 파이프라인 캔버스 + 노드 기록 패널.
- 캔버스는 이미 쓰는 `react-force-graph-2d`(d3-force + canvas, 새 의존성 없음)로 그리고, 노드 위치는 고정 좌표(왼→오 흐름)다.
- 데이터 정본은 Langfuse observation이다(DEC-55). 새 저장소를 만들지 않는다. 기본 기간은 최근 7일.

## 파이프라인 노드

운영 서비스가 고정 목록으로 정의한다(`id`, 표시 이름, observation 이름 규칙, 다음 노드). 이름 규칙은 AI 코드의 실제 observation 이름과 맞춘다.

| 노드 | observation 이름 | 다음 |
|---|---|---|
| `request` 집필 AI 요청 | 요청 루트 `orchestration` | guard |
| `guard` Decision Guard | `decision_guard`, `decision_guard.generation` | main, (거절이면 끝) |
| `main` 메인 에이전트 | `main_agent` | 업무 Agent 7개, mcp |
| `qa`·`writing`·`manuscript_review`·`world`·`research`·`rating`·`character_simulation` | `step.<기능>`과 그 하위(`story_context.qa`·`retrieval`·`evidence_check`·`world_review.*`·`simulation.director` 등) | apply |
| `mcp` Content MCP 도구 | `mcp.*` | — |
| `apply` 작가 승인 반영 | `step.*.apply` | — |

단독 기능(`proposals`·`initial_world`·`manuscript_extraction`·`work_tags`·`world_review`·`rating`·`preprocessing`)은 캔버스 아래 줄에 따로 둔다.

## AI 계측 보강 (ai-service)

- `decision_guard` span의 `output`에 판정 결과(허용 여부·범위·기능별 yes/no와 이유 필드 그대로)를 남긴다(지금은 metadata만).
- `main_agent` generation의 `output`을 `{text, toolCalls:[{name, args}]}`로 남긴다(지금은 글 또는 도구 이름 목록). 도구를 부른 이유는 그 호출의 인자(`ask_*`의 요청문)와 같은 응답의 글이다.
- 메인이 실행하지 않고 돌려보낸 도구 호출(노출 밖·병렬 불가·승인 필요)은 `main_agent.blocked` 이벤트(span)로 이름·이유를 남긴다.
- 프롬프트 시드 문자열은 바꾸지 않는다.

## 운영 API (`llm` 권한)

| 경로 | 내용 |
|---|---|
| `GET /llmops/pipeline?from&to` | `{nodes:[{id,label,next:[id],standalone,count,errors,p95LatencyMs?,promptNames:[string]}]}` — 노드별 observation 수·ERROR 수·p95 지연과 그 노드 generation에 연결된 프롬프트 이름 |
| `GET /llmops/pipeline/{nodeId}/records?from&to&level&page` | 그 노드 observation 목록(최신순, 20개씩): `{id,traceId,name,type,startTime,latencyMs,level,statusMessage?,model?,promptName?,promptVersion?,input?,output?,metadata?}`. 본문은 칸마다 앞 8,000자까지 |
| `GET /llmops/traces/{id}` (기존 확장) | observation마다 `parentObservationId`·`input`·`output`·`metadata`를 더한다(같은 8,000자 제한) — 작업 하나의 실행 흐름 트리 |

Langfuse 실패는 502 `UPSTREAM_FAILED`(기존 규칙).

## 화면

- 캔버스: 노드 = 이름·건수·오류 수(오류가 있으면 위험 색), 선 = 흐름. 노드를 누르면 오른쪽(좁으면 아래) 기록 패널.
- 기록 패널: 결과 필터(전체·통과·거절/오류), 기록 표(시각·결과·지연·모델·프롬프트 버전), 줄을 펼치면 입력·출력·판정 근거(메타데이터)·도구 호출(이름·인자)을 그대로 보인다.
  Guard는 결과 칸에 허용/거절과 기능별 판정을, 메인은 부른 도구와 인자를 보인다. 줄마다 `실행 흐름 보기`(그 trace의 observation 트리, 단계마다 입력·출력)와
  그 노드 프롬프트로 가는 `프롬프트 보기`(기존 프롬프트 상세)를 둔다.
- 키보드: 캔버스는 보조이고, 같은 노드 목록을 캔버스 아래 버튼 목록으로도 둔다(초점·Enter로 열림).

## ponytail 한계

- 노드 목록은 코드에 고정이다. 새 Agent를 추가하면 운영 목록도 함께 고친다.
- 본문 8,000자 자르기 때문에 긴 원고는 끝이 보이지 않는다. 전문은 Langfuse에서 본다(개발자용).
