"""비용 장부: 호출마다 토큰과 추정 금액(USD)을 한 줄씩 남기고 합계를 낸다. 상한은 호출 수가 아니라 금액으로 막는다.

단가는 OpenAI 공식 모델 페이지의 gpt-5.6-luna(2026-11-14 확인): 입력 $0.20·캐시 입력 $0.02·출력 $1.20 (100만 토큰당),
Batch API는 절반, 입력이 272K 토큰을 넘는 요청은 입력 2배·출력 1.5배. 이전 실행(입력 2,295,259·출력 1,483,197)의 추정 실비는 약 $2.24다.
"""

import fcntl
import json
import threading
import time
from collections import defaultdict
from pathlib import Path

PRICE_IN, PRICE_CACHED, PRICE_OUT = 0.20, 0.02, 1.20   # USD / 1M tokens
BATCH_FACTOR = 0.5
LONG_INPUT = 272_000
LIMIT_USD = 28.0   # 새 키(조직 microstone)의 승인 30달러에서 남기는 여유(장부 기준 상한). 이전 키의 사용분은 `.data/cost-previous-key.jsonl`에 기록만 하고 세지 않는다


def usd(tokens_in: int, tokens_out: int, cached: int = 0, batch: bool = False, long: bool = False) -> float:
    """토큰 합계의 추정 금액. cached는 입력 중 캐시된 토큰 수, long은 입력 272K 초과 요청의 할증(요청 하나에만 적용)이다."""
    fresh = tokens_in - cached
    cost = (fresh * PRICE_IN + cached * PRICE_CACHED) * (2 if long else 1) + tokens_out * PRICE_OUT * (1.5 if long else 1)
    return cost / 1_000_000 * (BATCH_FACTOR if batch else 1)


def request_usd(tokens_in: int, tokens_out: int, cached: int = 0, batch: bool = False) -> float:
    """요청 하나의 추정 금액: 입력이 272K를 넘으면 할증이 붙는다."""
    return usd(tokens_in, tokens_out, cached, batch, long=tokens_in > LONG_INPUT)


class CostLog:
    """호출마다 `{kind, in, cached, out, batch, failed, usd}` 한 줄. 스레드·프로세스가 함께 써도 flock으로 한 줄씩 안전하다."""

    def __init__(self, path):
        self.path, self._lock = Path(path), threading.Lock()
        self._offset, self._total = 0, 0.0
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, kind: str, tokens_in: int, tokens_out: int, cached: int = 0, batch: bool = False, failed: bool = False,
               chars: int = 0) -> float:
        cost = request_usd(tokens_in, tokens_out, cached, batch)
        line = json.dumps({'ts': round(time.time()), 'kind': kind, 'in': tokens_in, 'cached': cached, 'out': tokens_out,
                           'batch': batch, 'failed': failed, 'usd': cost, 'chars': chars})
        with self._lock, self.path.open('a') as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            file.write(line + '\n')
        return cost

    def rows(self) -> list[dict]:
        return [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()] if self.path.exists() else []

    def spent(self) -> float:
        """지금까지의 합계. 새로 덧붙은 줄만 읽어 호출마다 불러도 가볍다(다른 프로세스가 쓴 줄도 반영)."""
        with self._lock:
            size = self.path.stat().st_size if self.path.exists() else 0
            if size < self._offset:
                self._offset, self._total = 0, 0.0
            if size > self._offset:
                with self.path.open('rb') as file:
                    file.seek(self._offset)
                    chunk = file.read(size - self._offset)
                end = chunk.rfind(b'\n') + 1   # 쓰는 중인 마지막 줄은 다음에 읽는다
                self._total += sum(json.loads(line)['usd'] for line in chunk[:end].decode().splitlines() if line.strip())
                self._offset += end
            return self._total

    def summary(self) -> dict:
        """kind별 호출 수·토큰·금액·실패 수·Batch 호출 수."""
        out = defaultdict(lambda: {'calls': 0, 'in': 0, 'out': 0, 'usd': 0.0, 'failed': 0, 'batch': 0, 'chars': 0})
        for row in self.rows():
            block = out[row['kind']]
            block['calls'] += 1
            block['chars'] += row.get('chars', 0)
            block['in'] += row['in']
            block['out'] += row['out']
            block['usd'] += row['usd']
            block['failed'] += row['failed']
            block['batch'] += row['batch']
        return dict(out)


def calibrate(summary: dict, default: float = 1.5) -> tuple[float, dict[str, int]]:
    """비용 장부 요약(`CostLog.summary`)에서 글자 수/입력 토큰 비와 종류별 호출당 평균 출력 토큰을 잰다.
    파일럿의 실측값을 다음 단계의 예상 금액(`batch.estimate`)에 쓴다. 글자 수가 기록되지 않았으면 default를 쓴다."""
    chars = sum(b['chars'] for b in summary.values())
    tokens = sum(b['in'] for b in summary.values() if b['chars'])
    return (chars / tokens if chars and tokens else default), {k: round(b['out'] / b['calls']) for k, b in summary.items() if b['calls']}
