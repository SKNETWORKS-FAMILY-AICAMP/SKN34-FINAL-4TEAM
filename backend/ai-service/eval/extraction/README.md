# 추출 평가 세트 빌더 (`eval/extraction/`)

회차 설정 추출 지시문 `manuscript_extraction.extract`의 운영 평가 세트 `extraction.extract`(저작권 만료 공개 작품)를 만들고, 같은 항목 모양의 로컬 세트(해리 포터)를 오프라인으로 채점한다.
설계·채점 정의·측정 결과·한계는 [추출 평가 세트](../../../../docs/evaluation/extraction-set.md)에 있다. 운영 채점 코드는 `app/evaluation/extraction.py`(이 폴더는 이미지에 들어가지 않는다).

| 파일 | 역할 |
|---|---|
| `ex_sources.py` | 회차 원천: 공개 근대 소설 5편(위키문헌 원문, 현대어 번역·번안판 아님)과 로컬 해리 포터를 운영 회차 크기(5천~6천 자)로 자른다 |
| `ex_gold.py` | 정답표: ocx `gpt-6.2-sol`(금액 0)이 서로 다른 지시문 A·B로 두 번 뽑고 서비스 검증을 통과한 항목을 core(교집합)·합집합으로 합친다 |
| `ex_cli.py` | `gold`(정답표 → `.data/sets/<원천>.jsonl`), `export`(공개 세트 → `app/evaluation/datasets/`), `score`(오프라인 채점 → `results/` 집계) |
| `test_ex_*.py` | 가짜 호출 단위 테스트 |

```bash
cd backend/ai-service
uv run --locked --extra dev python eval/extraction/ex_cli.py gold --source public     # ocx 게이트웨이(127.0.0.1:10100)가 켜져 있어야 한다. OpenAI 키를 쓰지 않는다
uv run --locked --extra dev python eval/extraction/ex_cli.py export
uv run --locked --extra dev python -m pytest eval/extraction                         # CI는 tests/만 돌리므로 이 폴더는 로컬 실행
```

- `.data/`(`.gitignore`)에 원문·정답표·모델 응답 캐시가 있다. 해리 포터 원문·정답표는 **저장소·Langfuse에 두지 않는다**(`export`는 저작권 만료 공개 항목이 아니면 멈춘다). `results/`에는 숫자와 항목 id만 둔다.
- `ex_cli.py`는 시작 때 Langfuse 키를 지운다(원문이 Langfuse로 가지 않게).
