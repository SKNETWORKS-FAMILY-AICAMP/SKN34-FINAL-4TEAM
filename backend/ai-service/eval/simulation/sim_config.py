"""설정 A~E와 실행 계획·예상 금액: 순수 로직. 모델·네트워크 호출이 없다.

설정은 환경 변수 스위치(#642)의 조합이다. 스위치는 호출 때 읽으므로 한 프로세스에서 설정을 차례로 바꿔 돌릴 수 있다(동시에 둘은 안 된다).
"""

import os
import sys
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'novelbrain'))

from cost import request_usd, usd  # noqa: E402  eval/novelbrain/cost.py(단가·금액 계산). request_usd는 입력이 272K 토큰을 넘는 요청의 할증을 센다(장부와 같다)

from app.simulation import agent, director, scene_agent, service  # noqa: E402

EFFORT, SKIP_DIRECTOR, WORLD_CACHE, SKIP_NARRATION = agent.EFFORT, director.SKIP_FORCED, service.WORLD_CACHE, scene_agent.SKIP_NARRATION_CHECK
SWITCHES = (EFFORT, SKIP_DIRECTOR, WORLD_CACHE, SKIP_NARRATION)

CONFIGS = {'A': {}, 'B': {EFFORT: 'low'}}  # A는 모두 끈 지금 동작이고, 뒤로 갈수록 앞 설정에 스위치를 하나씩 더한다
CONFIGS['C'] = {**CONFIGS['B'], SKIP_DIRECTOR: '1'}
CONFIGS['D'] = {**CONFIGS['C'], WORLD_CACHE: '1'}
CONFIGS['E'] = {**CONFIGS['D'], SKIP_NARRATION: '1'}

# 스위트의 경로에서 효과가 있는 스위치. 품질은 인물 턴(act·check)뿐이고, 속도는 세계관을 Content에서 읽지 않아(Content 호출 없음) 캐시만 효과가 없다.
RELEVANT = {'quality': {EFFORT}, 'speed': {EFFORT, SKIP_DIRECTOR, SKIP_NARRATION}}


@contextmanager
def applied(config: str):
    """설정의 스위치만 켜고(나머지는 끈다) 끝나면 환경을 되돌린다. 셸에 남은 스위치도 A에서는 꺼진다."""
    before = {name: os.environ.get(name) for name in SWITCHES}
    try:
        for name in SWITCHES:
            os.environ.pop(name, None)
        os.environ.update(CONFIGS[config])
        yield
    finally:
        for name, value in before.items():
            os.environ.pop(name, None)
            if value is not None:
                os.environ[name] = value


def plan_runs(configs: list[str], suite: str) -> dict[str, str]:
    """설정 → 실제로 돌릴 설정. 그 스위트의 경로에 닿는 스위치 값이 같은 설정은 앞의 것의 결과를 재사용한다(효과가 0이라 호출을 아낀다)."""
    first: dict[frozenset, str] = {}
    return {name: first.setdefault(frozenset((k, v) for k, v in CONFIGS[name].items() if k in RELEVANT[suite]), name) for name in configs}


# --- 예상 금액(호출 없이) ---------------------------------------------------------------------------------------------------
# 입력 토큰은 호출 종류별로 주어지고(prepare 뒤에는 실제 입력 크기, 전에는 가정값), 아래 값은 가정이다. 출력은 호출당 상한으로 잡아 금액이 낮게 나오지 않게 한다.
REGEN = 0.25      # 첫 응답이 검사에 걸릴 확률(가정). 재생성은 최대 2번이라 기대 시도 수는 1 + r + r²
ATTEMPTS = 1 + REGEN + REGEN ** 2
OUT_TOKENS = 1500  # 호출당 출력(추론 토큰 포함) 상한: agent.py의 max_output_tokens
JUDGE_OUT = 330   # 채점 호출의 평균 출력(novelbrain/batch.py OUT_GUESS 실측)
DIRECTOR_IN, DIRECTOR_OUT = 3_000, 100
TURNS, FORCED, OMNISCIENT = 8, 2, 2   # 장면당 턴 수(가정)와 그중 규칙이 정한 턴·전지적 나레이션 턴(시작·마무리)
SPATIAL_FIRST = ('past-absence', 'past-presence')   # 공간 판정을 먼저 하는 유형(공개 채점 흐름)
JUDGE_MAX_OUT = 3000  # 채점 호출의 max_output_tokens(novelbrain/run_timechara.py의 JUDGE_TOKENS)


def question_max_usd(q: dict) -> float:
    """질문 하나가 쓸 수 있는 최대 금액: 인물 턴·검사를 모든 시도(처음 + 재생성)만큼 하고 첫·최종 응답을 각각 시공간 2번 + 성격 1번 채점하며 출력은 호출당 상한까지 쓰는 경우.
    진행 중인 질문의 비용은 끝나야 장부에 남아, 품질 실행은 새 질문을 시작하기 전에 '장부 + 동시 수 × 이 금액'으로 상한을 확인한다."""
    attempts = service.REGENERATIONS + 1
    return attempts * (usd(q['act_in'], OUT_TOKENS) + usd(q['check_in'], OUT_TOKENS)) + 2 * 3 * usd(q['judge_in'], JUDGE_MAX_OUT)


def estimate_quality(inputs: list[dict]) -> dict:
    """품질: 질문마다 인물 턴(act)·검사(check)·채점(judge) 호출. inputs 항목은 {'type', 'act_in', 'check_in', 'judge_in'}(입력 토큰).
    첫 응답과 (재생성했다면) 최종 응답을 각각 채점하고, 시공간 판정 1~2번과 성격 판정 1번이 한 응답의 채점이다."""
    calls, money = {'act': 0.0, 'check': 0.0, 'judge': 0.0}, 0.0
    for q in inputs:
        judged = (1 + REGEN) * ((2 if q['type'] in SPATIAL_FIRST else 1) + 1)
        for kind, n, size, out in (('act', ATTEMPTS, q['act_in'], OUT_TOKENS), ('check', ATTEMPTS, q['check_in'], OUT_TOKENS), ('judge', judged, q['judge_in'], JUDGE_OUT)):
            calls[kind] += n
            money += n * usd(size, out)
    return {'calls': calls, 'usd': money}


def estimate_speed(scenes: list[dict], config: str) -> dict:
    """속도: 장면마다 TURNS턴. 연출 호출은 규칙이 정한 FORCED턴을 뺀 만큼(C부터), 생성·검사는 기대 시도 수만큼, 전지적 나레이션 검사는 E에서 뺀다.
    scenes 항목은 {'act_in', 'check_in', 'narrate_in'}(입력 토큰)이고, 'narrate_check_in'(전지적 나레이션 검사 입력)이 있으면 나레이션 검사는 그 크기로 센다
    (그 입력은 아직 공개되지 않은 설정 전체를 금지 목록으로 담아 인물 검사보다 훨씬 클 수 있다: 해리 포터 원문 세계관에서 실측 평균 30만 토큰). 없으면 인물 검사와 같은 크기로 센다.
    생성은 인물·나레이션 입력의 평균 크기로 센다."""
    env, n = CONFIGS[config], len(scenes)

    def mean(key: str) -> float:
        return sum(s.get(key, s['check_in']) for s in scenes) / (n or 1)

    calls = {'director': n * (TURNS - (FORCED if env.get(SKIP_DIRECTOR) else 0)), 'gen': n * TURNS * ATTEMPTS, 'check': n * (TURNS - OMNISCIENT) * ATTEMPTS,
             'narrate_check': n * (0 if env.get(SKIP_NARRATION) else OMNISCIENT) * ATTEMPTS}
    money = (calls['director'] * usd(DIRECTOR_IN, DIRECTOR_OUT) + calls['gen'] * usd((mean('act_in') + mean('narrate_in')) / 2, OUT_TOKENS)
             + calls['check'] * usd(mean('check_in'), OUT_TOKENS) + calls['narrate_check'] * request_usd(round(mean('narrate_check_in')), OUT_TOKENS))
    return {'calls': calls, 'usd': money}


def estimate(suite: str, configs: list[str], inputs: list[dict]) -> dict[str, dict]:
    """설정마다 {calls, usd, reusedFrom}. 다른 설정의 결과를 재사용하는 설정은 호출·금액이 0이다."""
    runs, rows = plan_runs(configs, suite), {}
    for name in configs:
        if runs[name] != name:
            rows[name] = {'calls': {}, 'usd': 0, 'reusedFrom': runs[name]}
        else:
            rows[name] = {**(estimate_quality(inputs) if suite == 'quality' else estimate_speed(inputs, name)), 'reusedFrom': None}
    return rows
