# 시뮬레이션 평가 세트 (`simulation.act`·`simulation.narrate`)

운영 회귀 평가(LLM Ops)에서 인물 시뮬레이션 지시문 `character_simulation.act`·`narrate`의 새 버전을 평가·승격하는 세트다. 원문 기반 평가의 공개 세트(고전·근대 소설과 SCP 재단 한국어 이야기, 해리 포터 없음)에서
`eval/simulation/orig_cli.py export`가 만들고 `python -m app.evaluation.seed`가 Langfuse Dataset으로 등록한다(파일 이름 = 세트 이름). 다른 세트(`leak.*`·`qa.*`·`world.*`·`writing.*`)와 달리 업무 Agent 틀이 아니라 실제 서비스 호출로 만들고 원문 평가 루브릭으로 채점한다.
방식은 [운영 LLMOps 계약](../../../../../docs/design/operations-llmops-contract.md), 설계·재현은 [원문 기반 평가 §10](../../../../../docs/evaluation/simulation-original.md#10-운영-llmops-등록-형식내보내기)에 있다.

| 파일 | 평가하는 지시문 | 항목 |
|---|---|---|
| `simulation.act.jsonl` | `character_simulation.act` | 대사 24 |
| `simulation.narrate.jsonl` | `character_simulation.narrate` | 나레이션 24·독백 22 |

- `input`은 서비스가 그 호출에 모델에 보내는 값 `{set, data}` 그대로이고 `expectedOutput`은 원작의 다음 글이다.
- **Langfuse에 올라간 값은 파일과 조금 다르다.** `expectedOutput`이 따옴표로 감싼 글(act의 모든 정답)이면 Langfuse가 JSON으로 읽어 바깥 따옴표를 벗겨 저장하고, 평가·자동 개선은 그 저장값을 쓴다([계약 한계](../../../../../docs/design/operations-llmops-contract.md#ponytail-한계)). seed는 저장 모양으로 견주어 같으면 다시 올리지 않는다.
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

# 추출 평가 세트 (`extraction.extract`)

운영 회귀 평가(LLM Ops)에서 회차 설정 추출 지시문 `manuscript_extraction.extract`의 새 버전을 평가·승격하는 세트다(짝, [계약](../../../../../docs/design/operations-llmops-contract.md)). 저작권이 만료된 근대 한국 소설(위키문헌, 작가 14명·작품 80편)의 회차 한 편이 항목 하나이고
`eval/extraction/ex_cli.py export`가 만들며 `python -m app.evaluation.seed`가 Langfuse Dataset으로 등록한다(파일 이름 = 세트 이름). 설계·재현·한계는 [추출 평가 세트](../../../../../docs/evaluation/extraction-set.md)에 있다.

| 파일 | 평가하는 지시문 | 항목 |
|---|---|---|
| `extraction.extract.jsonl` | `manuscript_extraction.extract` | **게이트** 30회차(작품 30편, 작가를 번갈아 한 회차씩 고른 층화). 평가 1회 = 운영 모델 호출 30회 |
| `optimize/extraction.extract.jsonl` | (자동 개선의 훈련·검증 재료) | **최적화 풀** 157회차(id `extraction.extract.opt-NNN`, `metadata.split` train 137·val 20). seed가 하위 폴더 `optimize/`도 읽어 Dataset `optimize.extraction.extract`(`optimize.<파일 이름>`)로 등록한다(#868, 시뮬레이션 풀 둘도 같다). 게이트와 항목·(작품, 회차)·본문이 겹치지 않는다(`tests/evaluation/test_seed.py`) |

- `input`은 운영이 모델에 보내는 `{number, title, body}` 그대로이고 `expectedOutput`은 정답표(`mentions`·`statements`·`relationships`, 항목마다 `core` = 상위 모델이 서로 다른 지시문으로 두 번 모두 뽑음)다. 채점 모델은 없고 코드가 정답표와 대조하며, 게이트 `recall`은 정답표 가운데 설정다운 `core`(`kind`·진술의 `document`로 가른다: 일상 물건·줄거리 사건 제외)만 센다. 정답표 진술은 `{kind, document, quote, core}`다. 풀도 같은 모양이다.
- `metadata.source`가 작품·저자·출처·라이선스(사망 연도와 위키문헌 PD 틀)·회차이고 `metadata.gold`가 정답표를 만든 모델·실행·일치도다. 일치도(`agreement`)의 실수는 Langfuse가 16자리까지만 남긴다(채점기는 읽지 않는다).
- **정답표는 모델 두 번의 결과라 사람 검수 전이다.** 진술은 두 번의 선택이 갈려 `core`가 작다. `core` 대상이 3개 미만이거나 진술이 5개 미만인 회차는 만들지 않았다.
- 해리 포터·웹소설 원문·정답표는 저작권이 있어 이 세트에 없다(로컬 오프라인 평가 전용, `eval/extraction/.data`).
