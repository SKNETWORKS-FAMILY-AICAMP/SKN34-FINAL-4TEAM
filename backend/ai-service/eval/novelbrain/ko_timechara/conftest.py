"""이 폴더의 테스트가 `eval/novelbrain`의 모듈(timechara·llm 등)을 어느 위치에서 실행해도 import할 수 있게 한다."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
