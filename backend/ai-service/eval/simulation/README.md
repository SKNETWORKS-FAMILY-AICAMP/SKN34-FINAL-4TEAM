# 인물 시뮬레이션 성적표 (#642)

인물 시뮬레이션 턴 속도 스위치(설정 A~E)가 속도와 품질에 주는 영향을 지표로 잰다. 스위치는 [AI 서비스 README](../../README.md#인물-시뮬레이션-턴-속도-스위치와-성적표-642), 설정·지표·결과 표는 [평가 결과](../../../../docs/evaluation/simulation.md)에 있다.
`eval/novelbrain`(TimeChara 파싱·세계관 구성·시점 규칙·공개 채점·비용 장부·Wilson 구간·부호 검정)을 import해서 쓰고 다시 구현하지 않는다(`sys.path`에 `eval/novelbrain`을 더한다).
그래서 모듈 이름은 `sim_` 접두어로 novelbrain의 모듈과 겹치지 않게 했다.

## 파일

| 파일 | 역할 |
|---|---|
| `sim_cli.py` | 명령 `prepare`·`estimate`·`run`·`report`·`build-hp`·`show-hp`·`seed-hp`와 결과 JSON 조립. `run`·`estimate`·`report`는 `--world thin|hp`, `run`은 `--via openai|ocx` |
| `sim_config.py` | 설정 A~E(환경 변수 조합)·스위치 적용·같은 경로의 설정 재사용 계획·예상 호출 수와 금액(순수 함수) |
| `sim_worlds.py` | TimeChara·홍길동전 시연 세계관·해리 포터 원문 기반 세계관(`hp_world`) → `service.World`(Content 호출 없음), 표본 고정, 고정 장면 목록(해리 포터 8 + 한국어 2) |
| `hp_chapters.py` | 해리 포터 번역본 장 나누기(머리 형식·목차·빠진 장 처리, 못 찾은 장은 묶음) |
| `hp_build.py` | 장 → 모델 추출 → 정체 정리(영어 이름) → 인물 IDENTITY·SOUL·GOAL → `.data/hp/world.json`(시연 세계관 형식, 서버 한도 안·인물당 관계 상한) · `preview.md` |
| `hp_traits.py` | SOUL·GOAL 다시 쓰기: 원문 전체의 변하지 않는 면만 쓰게 하는 요청, 반전·결과 금지 낱말(정해 둔 것 + 인물의 뒤 회차에만 나오는 고유명사) 검사 |
| `hp_seed.py` | `world.json`을 로컬 스택에 배치로 적재하고 다시 실행하면 서버를 world.json과 같게 맞춘다(바뀐 카드·관계 갱신, 줄어든 관계는 종료 연결로 끝냄; `seed.py` 함수 재사용, localhost만, 비밀번호는 환경변수) |
| `sim_via.py` | `--via ocx`: 로컬 OpenCodex 게이트웨이(구독 경로) 어댑터와 금액 0 장부 |
| `sim_quality.py` | 품질: 질문 → 운영 인물 턴 경로(`character_view` → `act` → 서버 규칙 → `check` → 재생성) → 공개 기준 채점 |
| `sim_speed.py` | 속도: 고정 장면을 장면 에이전트로 끝까지 돌려 `UsageLedger` 기록을 집계 단위로 만든다 |
| `sim_stats.py` | 백분위·품질/속도 집계·표 출력(순수 함수) |
| `test_*.py` | 위 순수 로직과 실행 흐름의 단위 테스트(모델·채점·Content는 대역, 호출 없음) |
| `results/*.json` | `run`이 쓰는 집계(커밋 대상, 질문·응답 없음). 아직 없다 |

`.data/`(git 무시)에는 TimeChara 원문·표본(`sample.json`)·질문별 기록(`runs/*.jsonl`: 응답 본문 포함)·채점 캐시·비용 장부·해리 포터 번역본(`hp/raw`)과 거기서 만든 장 나눈 글·`world.json`·`preview.md`가 있다. **저장소에 커밋하지 않는다.**

## 재현

명령 전체(`prepare`·`estimate`·`run`·`report`)는 [결과 문서 §5](../../../../docs/evaluation/simulation.md#5-재현)에 있다. `prepare`는 HuggingFace 로그인·약관 동의가 필요하다(비상업 연구 한정, 토큰은 `~/.cache/huggingface/token`).
단위 테스트: `uv run --locked --extra dev python -m pytest -m 'not integration' eval/simulation` (`eval/novelbrain`과 한 번에 돌려도 이름이 겹치지 않는다).

## 규칙

- **`run`은 비용 승인 뒤에만 쓴다.** 시작 전에 예상 표를 출력하고 예상 합계가 상한(`--limit-usd`, 기본 10달러)을 넘으면 호출 없이 멈춘다. 시작한 뒤에는 `.data/cost.jsonl` 장부의 누적 합계로 막는다(품질·속도·재실행이 같은 장부를 쓴다): 품질은 진행 중인 질문의 비용이 끝나야 장부에 남아 새 질문을 '장부 + 동시 수(`--workers`) × 질문당 최대 금액'이 상한 안일 때만 시작하고(`sim_config.question_max_usd`: 모든 시도·채점을 출력 상한으로 센 금액), 속도는 장면 하나의 여유(0.50달러)가 남을 때만 시작한다. 시뮬레이션 모델 호출(act·check·narrate·director)은 토큰으로 계산해 같은 장부에 남기고, 채점은 `eval/novelbrain`의 `usd_llm`이 남긴다. 단가는 `cost.py`(gpt-5.6-luna) 값이다.
- 같은 경로를 지나는 설정은 한 번만 돌린다(`sim_config.plan_runs`): 품질에서는 추론 강도만 닿아 C·D·E가 B와 같고, 속도에서는 세계관 캐시(D)가 Content 호출이 없어 효과가 없으므로 C와 같다. 결과 JSON의 `ranAs`가 그 대응이다.
- `run`은 시작할 때 `LANGFUSE_*` 키를 지운다: TimeChara 원문이 팀 Langfuse에 남지 않고, 프롬프트도 코드 문자열(운영 production 버전이 아님)로 돈다.
- 중단하면 `.data/runs/<suite>-<설정>.jsonl`에 끝낸 질문·장면이 남아 같은 명령이 이어 받는다. 처음부터 다시 내려면 그 파일을 지운다(프롬프트·표본을 바꾼 뒤에는 꼭 지운다).
- 속도는 장면을 순서대로 돈다(병렬 호출이 지연을 흔들지 않게). 품질은 `--workers`(기본 12) 질문씩 병렬이다.
- 질문·응답·모델 응답 본문은 오류 메시지·로그에 넣지 않는다. 호출 실패·채점 실패는 점수를 꾸미지 않고 `errors`·`failedJudge`로 센다.
- **해리 포터 원문 기반 세계관**(`build-hp`·`seed-hp`, 방법·누설 방지·한계는 [결과 문서 §8](../../../../docs/evaluation/simulation.md#8-원문-기반-세계관해리-포터)): `build-hp`는 장부 누적 상한(`--limit-usd`, 기본 18달러)을 시작 전 예상과 호출 사이 모두 지키고, 끝낸 호출은 디스크 캐시에 남아 같은 명령이 이어 받는다.
  `seed-hp`는 로컬 스택(localhost만)에만 넣고 공유·원격 DB에는 넣지 않는다. 다시 실행하면 회차마다 서버의 그 시점 관계와 world.json의 그 시점 관계를 비교해 다른 것만 보낸다(서버는 관계를 지우지 않고 종료 연결을 쓰므로 줄어든 관계도 이렇게 끝난다). 비밀번호는 환경변수 `STORYFORK_SEED_PASSWORD`로만 받고 출력하지 않는다.
- **`--via ocx`**: OpenAI 상한에 닿으면 안내하는 이어 받기 경로다(로컬 OpenCodex 게이트웨이, 금액 0, 모델 gpt-6-luna). `speed`는 거절한다. ocx 호출은 장부에 `via: ocx`·금액 0으로 남고 품질 결과의 문항 기록에 `via`가 남는다(openai·ocx가 섞이면 `report`가 알린다).
- 의존성 파일은 바꾸지 않았다.
