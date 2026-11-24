# 시뮬레이션 평가 세트 (`simulation.act`·`simulation.narrate`)

운영 회귀 평가(LLM Ops)에서 인물 시뮬레이션 지시문 `character_simulation.act`·`narrate`의 새 버전을 평가·승격하는 세트다. 원문 기반 평가의 공개 세트(고전·근대 소설과 SCP 재단 한국어 이야기, 해리 포터 없음)에서
`eval/simulation/orig_cli.py export`가 만들고 `python -m app.evaluation.seed`가 Langfuse Dataset으로 등록한다(파일 이름 = 세트 이름). 다른 세트(`leak.*`·`qa.*`·`world.*`·`writing.*`)와 달리 업무 Agent 틀이 아니라 실제 서비스 호출로 만들고 원문 평가 루브릭으로 채점한다.
방식은 [운영 LLMOps 계약](../../../../../docs/design/operations-llmops-contract.md), 설계·재현은 [원문 기반 평가 §10](../../../../../docs/evaluation/simulation-original.md#10-운영-llmops-등록-형식내보내기)에 있다.

| 파일 | 평가하는 지시문 | 항목 |
|---|---|---|
| `simulation.act.jsonl` | `character_simulation.act` | 대사 24 |
| `simulation.narrate.jsonl` | `character_simulation.narrate` | 나레이션 24·독백 22 |

- `input`은 서비스가 그 호출에 모델에 보내는 값 `{set, data}` 그대로이고 `expectedOutput`은 원작의 다음 글이다.
- `metadata.judge`는 채점 입력이다: `character`, 직전 장면 전체 `scene`(모델 입력의 장면은 줄어 있다), 시점 위반 정답표 `facts`(그 인물이 아직 모르는 사실 `{id, text}`).
- **라이선스는 항목마다 다르다.** `metadata.license`가 `CC BY-SA 3.0`인 항목은 SCP 재단 한국어(scpko.wikidot.com) 이야기로 같은 조건으로 공유하며, 작품·저자·URL은 `metadata.source`에 있다. 나머지는 저작권이 만료된 고전·근대 소설(위키문헌)이다.
- **라벨은 사람 검수 전이다**(원문 평가와 같은 문항·정답표를 쓴다). 고전소설은 따옴표가 없어 턴 경계가 거칠다: 일부 나레이션 정답에 인물의 말이 섞이고, 일부 독백 정답은 원문 조각이며, 화자·알고 있는 사실 라벨이 어긋난 항목이 있을 수 있다(예: `simulation.act-11`의 직전 장면 끝은 경홍이 말하는 대목). 항목 몇 개의 잡음이라 세트를 고치지 않았고, 고치려면 원문 평가의 공개 세트부터 바로잡고 다시 내보낸다.
- 해리 포터 문항·원문은 저작권이 있어 저장소에 없다(집계만 `eval/simulation/results/`).

# 라우팅 평가 세트 (`decision_guard.routing`, #783)

Decision Guard 지시문 `decision_guard.judge`의 새 버전을 평가·승격하는 세트다(#787 게이트의 짝). 가상 작품 문장으로 직접 작성했고 저작물 인용은 없다(`metadata.source`).

| 사례(`metadata.case`) | 항목 | 확인하는 것 |
|---|---|---|
| `single` | 14 | 기능 하나씩(일곱 기능 모두) |
| `compound` | 6 | 기능 둘(검수→수정, 고증→집필 등) |
| `confusable` | 8 | 헷갈리는 짝(`story_context`↔`research`, `manuscript_review`↔`world`, 계획 수정↔MCP) |
| `followup` | 9 | 지칭·대답형 후속(#781: 메인의 되묻기에 "응, 3화로 해줘") |
| `chat` | 6 | 인사·잡담·창작과 무관한 요청은 허용 + 기능 없음(#782) |
| `injection`·`sensitive` | 3·3 | 거절(`prompt_injection`·`sensitive_data`) |

- `input`은 `{request, history?}`, `expectedOutput`은 `{guard, capabilities}`(기능은 고정 순서)다. 채점은 모델 없이 `guard`·`precision`·`recall`이다.
- 정답은 사람이 정한 한 가지다. 경계 사례(예: 공개 세계관 참고가 `research`만인지)는 정책이 바뀌면 함께 고친다.
