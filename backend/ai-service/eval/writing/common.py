"""집필 AI 기준선 평가 공통: 환경(.env·로컬 Content), 개발 작가 로그인, 비용 장부(OpenAI HTTP 응답의 usage를 세고 상한에서 호출 전에 멈춘다).

평가는 이 워크트리의 서비스 함수를 프로세스 안에서 부른다(실제 코드 경로). Content는 로컬 스택(127.0.0.1:8081, MCP는 개발 작가 Bearer)이고,
Langfuse 키는 지워 프롬프트는 코드 기본값(초기 설정)이며 평가 원문이 추적에 남지 않는다. 원문·문항·응답은 `.data/`(git 무시)에만 둔다.
"""

import contextlib
import json
import os
import sys
import time
from pathlib import Path

import httpx

sys.path.append(str(Path(__file__).resolve().parents[1] / 'novelbrain'))   # metrics.wilson_interval(이름이 겹치는 run.py보다 뒤에 둔다)
from metrics import wilson_interval  # noqa: E402

HERE = Path(__file__).resolve().parent
DATA = HERE / '.data'
AI = HERE.parents[1]                                   # backend/ai-service
HP = AI / 'eval' / 'simulation' / '.data' / 'hp'        # 해리 포터 회차·세계관(hp_episodes.py)
ENV = Path(os.environ.get('STORYFORK_ENV', AI.parents[1] / '.env'))
MAIN_ENV = Path('C:/SKN_project/SKN34-FINAL-4TEAM/.env')  # 워크트리에는 .env가 없어 기본 체크아웃의 것을 읽는다
WORK_ID = '465ce7e8-0ee0-4b21-83dc-1b358a252a9a'       # 로컬 스택의 「해리 포터(평가용·로컬 전용)」
LIMIT_USD = 10.0                                         # 사용자 결정(2026-11-24): 이번 기준선 평가 전체 상한
# shortcut: 저장소에 gpt-6-luna 단가가 없어 기존 평가(eval/novelbrain/cost.py)처럼 gpt-5.6-luna 단가로 센다. 공식 단가를 확인하면 바꾼다.
PRICE_IN, PRICE_CACHED, PRICE_OUT = 0.20, 0.02, 1.20     # USD / 1M tokens


class BudgetExceeded(RuntimeError):
    pass


def usage_of(body: dict) -> tuple[int, int, int]:
    """(입력, 출력, 캐시 입력) 토큰. Responses·Decisions(input/output_tokens)와 Chat Completions(prompt/completion_tokens) 모양을 읽는다."""
    u = body.get('usage') or {}
    tokens_in = u.get('input_tokens', u.get('prompt_tokens', 0)) or 0
    tokens_out = u.get('output_tokens', u.get('completion_tokens', 0)) or 0
    details = u.get('input_tokens_details') or u.get('prompt_tokens_details') or {}
    return tokens_in, tokens_out, details.get('cached_tokens', 0) or 0


class Ledger:
    """호출마다 `{ts, kind, model, in, out, cached, usd, tag}` 한 줄. 합계가 limit 이상이면 check()가 BudgetExceeded다."""

    def __init__(self, path: Path, limit: float = LIMIT_USD):
        self.path, self.limit, self.tag = Path(path), limit, ''
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def rows(self) -> list[dict]:
        return [json.loads(line) for line in self.path.read_text(encoding='utf-8').splitlines() if line.strip()] if self.path.exists() else []

    def spent(self) -> float:
        return sum(r['usd'] for r in self.rows())

    def check(self) -> None:
        if self.spent() >= self.limit:
            raise BudgetExceeded(f'비용 상한 {self.limit}달러에 닿아 호출하지 않았다(누적 {self.spent():.4f}달러)')

    def charge(self, usage: tuple[int, int, int], model: str, kind: str) -> float:
        tokens_in, tokens_out, cached = usage
        cost = ((tokens_in - cached) * PRICE_IN + cached * PRICE_CACHED + tokens_out * PRICE_OUT) / 1_000_000
        with self.path.open('a', encoding='utf-8') as file:
            file.write(json.dumps({'ts': round(time.time()), 'kind': kind, 'model': model, 'in': tokens_in, 'out': tokens_out,
                                   'cached': cached, 'usd': cost, 'tag': self.tag}) + '\n')
        return cost


def _record(ledger: Ledger, request: httpx.Request, response: httpx.Response) -> None:
    kind = request.url.path.rsplit('/', 1)[-1]
    try:
        body = response.json()
    except ValueError:
        body = {}   # 스트림 응답은 usage를 읽지 못한다(평가 경로는 스트림을 쓰지 않는다)
    ledger.charge(usage_of(body) if isinstance(body, dict) else (0, 0, 0), str((body or {}).get('model', '')) if isinstance(body, dict) else '', kind)


def _clients() -> list:
    """계측할 httpx 계열 모듈. openai 3.x SDK는 httpx2로 보내고 LangChain 등 다른 경로는 httpx를 쓴다."""
    mods = [httpx]
    try:
        import httpx2
        mods.append(httpx2)
    except ImportError:
        pass
    return mods


@contextlib.contextmanager
def metered(ledger: Ledger):
    """이 블록 안의 api.openai.com 호출을 장부에 남기고, 상한이면 보내기 전에 BudgetExceeded로 멈춘다(httpx·httpx2의 send를 감싼다)."""
    saved = []
    for mod in _clients():
        sync_send, async_send = mod.Client.send, mod.AsyncClient.send
        saved.append((mod, sync_send, async_send))

        def send(self, request, _orig=sync_send, **kwargs):
            if request.url.host != 'api.openai.com':
                return _orig(self, request, **kwargs)
            ledger.check()
            response = _orig(self, request, **kwargs)
            response.read()
            _record(ledger, request, response)
            return response

        async def asend(self, request, _orig=async_send, **kwargs):
            if request.url.host != 'api.openai.com':
                return await _orig(self, request, **kwargs)
            ledger.check()
            response = await _orig(self, request, **kwargs)
            await response.aread()
            _record(ledger, request, response)
            return response

        mod.Client.send, mod.AsyncClient.send = send, asend
    try:
        yield ledger
    finally:
        for mod, sync_send, async_send in saved:
            mod.Client.send, mod.AsyncClient.send = sync_send, async_send


def load_env() -> None:
    """루트 .env의 값을 아직 없는 변수에만 넣고, Content는 로컬 스택 주소로, Langfuse는 끈다(값은 출력하지 않는다)."""
    path = ENV if ENV.exists() else MAIN_ENV
    for line in path.read_text(encoding='utf-8').splitlines():
        key, sep, value = line.partition('=')
        if sep and key.strip() and not key.lstrip().startswith('#'):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    os.environ['CONTENT_SERVICE_BASE_URL'] = 'http://127.0.0.1:8081'
    for key in ('LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'):
        os.environ.pop(key, None)


def login() -> str:
    """개발 작가(저장소 공개 샘플 회원 writer@example.test, 로컬 전용)로 공개 진입점에 로그인해 Content MCP Bearer를 걸고 토큰을 돌려준다.
    비밀번호는 환경변수 STORYFORK_SEED_PASSWORD로만 받는다. 토큰은 30분 뒤 끝나 대상마다 다시 부른다."""
    from app.content_mcp import service as content_mcp
    with httpx.Client(base_url='http://localhost:5173', timeout=30) as client:   # 쿠키를 이어 CSRF 토큰을 붙인다(seed.Client와 같다)
        csrf = client.get('/api/v1/auth/csrf').json()['csrfToken']
        response = client.post('/api/v1/auth/login', headers={'X-CSRF-TOKEN': csrf},
                               json={'email': 'writer@example.test', 'password': os.environ['STORYFORK_SEED_PASSWORD']})
        response.raise_for_status()
    token = response.json()['accessToken']
    content_mcp.AUTHORIZATION.set(f'Bearer {token}')
    return token


def jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')


def episode(number: int) -> tuple[str, str]:
    """발행한 회차의 (제목, 본문). seed._publish_episodes와 같이 첫 줄 제목, 나머지를 strip한 본문이다(Content 색인 오프셋 기준)."""
    title, _, body = (HP / 'episodes' / f'{number:03d}.md').read_text(encoding='utf-8').partition('\n')
    return title.strip(), body.strip()


def rate(k: int, n: int) -> dict:
    """비율과 Wilson 95% 구간(분모 n을 함께 낸다). n이 0이면 value는 None(0점이 아니다)."""
    low, high = wilson_interval(k, n)
    return {'k': k, 'n': n, 'value': round(k / n, 4) if n else None, 'low': round(low, 4), 'high': round(high, 4)}


def ask(instructions: str, payload: dict, schema, max_tokens: int = 2000):
    """평가용 모델 호출 한 번(문항 생성·의미 채점): Responses 구조화 출력, store=False, 자동 재시도 없음. 모델은 OPENAI_MODEL(초기 설정과 같다).
    완료되지 않았거나 파싱되지 않으면 RuntimeError다(점수를 꾸미지 않는다)."""
    from openai import OpenAI
    with OpenAI(timeout=180, max_retries=0) as client:
        response = client.responses.parse(model=os.environ['OPENAI_MODEL'], store=False, max_output_tokens=max_tokens,
                                          instructions=instructions, input=json.dumps(payload, ensure_ascii=False), text_format=schema)
    if response.status != 'completed' or response.output_parsed is None:
        raise RuntimeError(f'평가 모델 응답 미완료: {response.status}')
    return response.output_parsed


def summarize(cases: dict, scored: list, means: tuple[str, ...] = ()) -> dict:
    """사례 점수 → 지표. 0/1 값은 비율(Wilson 구간), means에 든 키와 개수 값은 평균이다. 측정하지 못한 사례는 분모에서 빼고 measured로 따로 센다.
    family별로도 같은 집계를 낸다."""
    def agg(rows: list[dict]) -> dict:
        out = {}
        for key in sorted({k for s in rows for k in s if k != 'measured'}):
            vals = [s[key] for s in rows if key in s]
            binary = key not in means and all(v in (0, 1) for v in vals)
            out[key] = rate(sum(vals), len(vals)) if binary else {'mean': round(sum(vals) / len(vals), 4), 'n': len(vals)}
        return out
    rows = [(cases[cid].get('family', '-'), s) for cid, _, _, s in scored if s.get('measured')]
    return {'measured': {'n': len(rows), 'of': len(scored)}, **agg([s for _, s in rows]),
            'by_family': {f: agg([s for g, s in rows if g == f]) for f in sorted({f for f, _ in rows})}}
