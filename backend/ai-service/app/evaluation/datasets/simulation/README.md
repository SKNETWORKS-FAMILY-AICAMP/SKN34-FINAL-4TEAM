# 원문 기반 시뮬레이션 평가 세트 (LLMOps 등록 형식)

공개 세트 ①대사 ②연출 ③나레이션·독백 ④검사 문항을 기존 평가 세트 jsonl 형식(`id`·`input`·`expectedOutput`·`metadata.source`·`metadata.criteria`)으로 낸 것이다.
설계·재현은 [원문 기반 시뮬레이션 평가 세트](../../../../../../docs/evaluation/simulation-original.md)에 있다. `eval/simulation/orig_cli.py export`가 만든다.

| 파일 | 내용 | 라이선스 |
|---|---|---|
| `original.jsonl` | 고전소설 5편(위키문헌)·근대 한국 소설 5편(작가 사망 1962년 이전, 위키문헌 원문) | 저작권 만료 |
| `original-scp.jsonl` | SCP 재단 한국어(scpko.wikidot.com) 이야기 5편 | **CC BY-SA 3.0** (이 파일 전체. 문항마다 `metadata.source`에 작품·저자·URL·라이선스) |

- `input`은 서비스가 그 문항에서 모델에 보내는 값 그대로다(①③④ `data`, ② `state`·`cast`·`allowed`·`lastPov`).
- 이 폴더는 `datasets/` 바로 아래가 아니다: `app/evaluation/seed.py`가 `datasets/*.jsonl`을 모두 등록하고 `tests/evaluation/test_seed.py`가 정확히 네 세트를 기대한다. 실행 경로에 연결하는 일은 다음 작업이다.
- 해리 포터 문항·원문은 저작권이 있어 저장소에 없다(집계만 `eval/simulation/results/`).
