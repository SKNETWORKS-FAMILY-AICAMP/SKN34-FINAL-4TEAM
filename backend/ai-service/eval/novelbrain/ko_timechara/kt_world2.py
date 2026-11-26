"""KoTimeChara 세계관 시제품(v2): 회차 원문만 보고 인물 문서·사건(@ 대상)·인물 사이 관계를 뽑고 작품 단위로 합쳐 NovelBrain 세계관(kt_world와 같은 모양)을 만든다.

평가 폴더 안의 실험이다(서비스 전처리 app/manuscript_extraction은 바꾸지 않는다). 정답표(knowledge.jsonl·kt_label)와 기존 세계관(world.json)은 읽지 않고 회차 원문(work.json)만 읽는다.

    cd backend/ai-service
    uv run --locked --extra dev --extra manuscript python eval/novelbrain/ko_timechara/kt_world2.py run --gen-model=gpt-6-luna --gen-effort=low --step-llm=learn=gpt-6-luna@high --name=world2 --limit-usd=5 [작품 id …]

회차마다(회차끼리 병렬, batch.run_rounds): ① 인물 뽑기 → (③ 사건 정리: ① 인물 목록이 입력, 행동·대화 하나가 한 사건 ∥ ② 인물 문서: ① 인물 목록의 모두에게 인물마다, 사건과 서로 독립) →
(④ 인물 사이 관계 + ④' 사건의 자리: 누가 그 자리에 있었나·그 자리엔 없었지만 이 회차 안에서 소식을 들었나, 둘 다 ③ 사건이 입력). 문서는 정체·성격·말투·목표에 그 회차에서 한 일·겪은 일(행적)을 시간 순서로 더한다:
사건 단위가 정답표와 달라도·자리 연결이 빠져도 회차 본문 전체를 본 인물별 기록이 인물 기억에 남는다(사건에 안 이어진 인물도 문서를 부르므로 그 회차에 한 일이 있으면 기억이 생긴다).
모델 출력은 원문으로 다시 확인한다(이름이 본문에 있는 인물·대상만, 사건 인용·관계 인용·말투 대사가 원문에 있는 것만, 자리 단계가 더하는 '그 자리에 있던' 인물은 이름이 사건 인용 근처에 있을 때만,
문서의 '밝혀지지 않는다'류 문장은 뺀다. 어긋난 항목은 고치지 않고 빼서 코드별 건수를 남긴다).
작품마다 한 번(서로 독립이라 한 패스): ⑤ 합치기 — 이름이 같거나 호칭 변형(서비스 _base 규칙)인 카드는 코드가 합치고, 이름이 다른 같은 인물·동명이인은 모델 호출 한 번이 코드가 고른 후보 쌍(한쪽 이름이 다른 쪽 이름에
들어 있음, 한쪽 소개에 다른 쪽 이름)과 증거 문장을 보고 확정·거부만 한다(모델 출력은 인용이 입력 인용 중 하나여야 받지만, 이름 포함을 코드가 확인한 호칭 변형의 same은 인용이 틀려도 받는다 — 인용을 줄여 쓴 한 줄 때문에 주인공이 둘로 갈렸다. same: 단순 호칭 차이는 합치고 숨겨진 정체(가면·가명·뒤늦게 밝혀진 신분)는 카드를 따로 둔 채 「동일 인물」 관계를
밝혀진 회차부터 건다, distinct: 동명이인, uncertain: 통계에만). 같은 사건에 함께 나오거나 서로 관계가 있는 두 인물은 모델이 같다고 해도 합치지 않는다(apart_pairs). ⑥ 뒤 회차 들음 — 회차마다(2화부터) 앞 회차 사건 목록과 이 회차 본문으로
앞 사건을 이 회차에서 처음 전해 듣는 인물을 묻는다(그 회차에 앞 사건 카드로 「들음」을 잇는다). 단계별로 모델·추론 강도를 달리할 수 있다: --step-llm 'kind=모델[@강도]'(들음은 luna@high가 정밀 45~53%·재현 29~30%로 low의 21~28%·13~20%보다 낫다).
⑦ 카드 다듬기(--no-refine으로 끈다, 합치기·들음 뒤 마지막 단계) — 원문을 보고 모든 카드의 회차 칸을 채운다. 카드 단위 호출(카드끼리 병렬, 입력이 길면 회차 묶음으로 나눠 한 라운드):
(A) 인물이 아닌 카드(장소·조직·능력·사물·규칙·이름 붙은 사건): 코드가 회차마다 원문에서 카드 이름(합쳐진 호칭 포함)이 글자 그대로 나온 문장과 앞뒤 한 문장(회차당 10곳, 긴 문장은 자른다)과 그 카드가 @로 나온 사건의 인용을 모아 모델에 준다.
모델은 모은 문장만 보고 본문(text) = 처음 나온 회차 문장만으로 쓴 '무엇인가' 1~2문장, 회차 칸(episodes[n]) = 그 회차 문장으로 쓴 설명 3~6문장(인물 이름·사건을 써도 된다, 새로 말할 것이 없으면 칸 없음)을 쓴다. 문장마다 근거 인용(quote)이 그 회차에 모아 보여 준 원문 안에 글자 그대로 있어야 받는다.
본문 누설은 분류가 아니라 칸으로 막는다: NovelBrain 필터는 장소·조직·능력·규칙 카드 본문을 공개 회차 이후 모든 인물에게 보여 주지만(app.novelbrain.service._LINKED_TYPES) 비인물 카드의 회차 칸은 인물에게 보여 주지 않는다(서비스 변환은 characterDocs를 인물 카드만 읽고 색인도 인물 카드만 회차 문서를 만든다).
그래서 본문은 짧은 정의뿐이고(인물 이름·글에 대한 말·과거 동작 끝맺음 문장은 코드가 처음 회차 칸으로 옮긴다) 자세한 내용은 모두 회차 칸이다. 앞 문장을 되풀이하는 칸 문장은 코드가 버린다.
(B) 사건 카드는 호출하지 않는다. 인물 카드의 회차 칸·IDENTITY도 건드리지 않고, 대신 작가용 종합 소개(world['summary'], 필터·스냅샷이 읽지 않는다)를 더한다: 병합 인물 또는 전체 글자 수가 3,000자를 넘는 인물의 회차 칸들로 5~8문장, 문장마다 근거 회차 번호가 실제 칸인지만 확인한다.
(C) --tighten(기본 끔, 직전 판): 병합 인물 IDENTITY 다시 쓰기·긴 인물 회차 칸 줄이기(인물이 알아야 하는 쪽 점수를 깎아 끈다). 호출은 refine_card·refine_summary·refine_identity·refine_section 종류로 따로 세고 --step-llm으로 모델을 고를 수 있다. 앞 단계 결과가 이미 있으면 'refine' 부속 명령이 그 기록(works/<id>/<base>/) 위에서 다듬기만 새로 부른다.

세계관의 카드·관계(NovelBrain 입력):
- 인물 카드: 본문(IDENTITY) = 첫 등장 회차의 정체 글(없으면 그 회차 소개), 공개 = 첫 등장 회차, episodes[n] = n회차 인물 문서(정체·성격·말투·목표·행적) + 그 회차에 겪었거나 들은 사건의 제목·설명.
  SOUL·GOAL은 회차 없이 따로 두지 않는다(뒤 회차의 성격이 앞 회차로 새지 않게). 이름만 나온 인물(mentioned)은 사건과 잇지 않고 사건 글도 기억에 넣지 않는다.
- 사건 카드: 제목·본문(detail의 @이름은 이름만 남김), 공개 = 사건 회차. 관계: 인물 → 사건 '겪음'·'들음'(기록 회차 = 그 회차), 인물이 아닌 @ 대상 → 사건 '관련', 인물 사이 관계, '동일 인물'.
- 인물이 아닌 대상(장소·조직·능력·사물·규칙·이름 붙은 사건)의 카드는 본문 = 이름이고(공개 정보라 사건 줄거리를 실으면 그 사건을 모르는 인물에게 새어 나간다) ⑦이 짧은 정의 본문과 작가용 회차 칸을 채운다.
- 평가용 덧붙임: world['events'](사건 카드 id → 회차·제목·인용·겪음/들음/이름만 나온 카드), world['aliases'], world['identity'](동일 인물 관계). NovelBrain은 읽지 않는다.

결과는 KT/works/<작품 id>/<name>/episodes/NN.json(회차별), <name>.json(세계관), <name>_stats.json과 KT/<name>_stats.json(작품별·전체 통계)에 쓴다(git 무시, 원문 포함). 화면에는 집계만 낸다.
응답 캐시 KT/cache-<name>·장부 KT/cost-<name>.jsonl은 --name별로 따로라 기존 산출물을 덮지 않는다. 같은 명령을 다시 치면 캐시로 호출 없이 다시 만든다.
"""

import kt_common  # noqa: F401  경로 설정이 다른 import보다 먼저여야 한다
import argparse
import json
import re
import time
import unicodedata
from collections import Counter
from functools import lru_cache
from itertools import combinations
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.manuscript_extraction.service import _base as _service_base   # 호칭 변형 규칙(서비스와 같은 것을 import한다, 서비스 코드는 고치지 않는다)
from app.novelbrain.models import Card, Relation
from batch import Round, cost_report, run_rounds
from kt_common import KT
from kt_exec import EFFORTS, load_works, make_executor, make_gen_llm
from kt_text import evidence_ok, squash
from kt_world import save_world
from run_timechara import check_name as _check_name

CHARS_TOKENS, DOC_TOKENS, EVENTS_TOKENS, RELS_TOKENS, MERGE_TOKENS, PRESENCE_TOKENS, LEARN_TOKENS = 3_000, 2_500, 9_000, 3_000, 5_000, 4_000, 3_000
STEPS = ('chars', 'doc', 'events', 'presence', 'rels')   # 회차별 호출 단계(통계의 칸)
REFINE_KINDS = ('refine_card', 'refine_summary', 'refine_identity', 'refine_section')   # ⑦ 카드 다듬기의 호출 종류(카드 설명·인물 종합 소개·병합 인물 소개·긴 회차 칸)
KINDS = STEPS + ('learn', 'merge') + REFINE_KINDS   # 호출 종류 전부(--step-llm이 고를 수 있는 이름)
FACTOR = {'minimal': 1, 'low': 1, 'medium': 2, 'high': 3, 'xhigh': 4, 'max': 4}   # 추론 토큰도 max_output_tokens에 들어 있어 강도가 높으면 출력 한도를 늘린다(low는 그대로라 캐시 열쇠가 같다)
FACTORS: dict[str, int] = {}   # 호출 종류 → 출력 한도 배수(run이 강도에 맞춰 채운다)
PRESENCE_WINDOW = 300   # 자리 단계가 더하는 '그 자리에 있던' 인물은 이름이 사건 인용에서 이만큼(공백 없이 접은 글자 수) 안에 본문에 나와야 한다(개발 세트에서 더한 연결의 정답률이 거리에 따라 떨어졌다)
DOC_LIMIT = 3_000   # 인물 기억 한 칸의 글자 한도(서비스 DOC_LIMIT과 같다): 넘치면 줄을 자르지 않고 넘치는 줄부터 뺀다
DOC_FIELDS = ('identity', 'personality', 'speech', 'speech_quote', 'goal', 'activity')
ROLE_RANK = {'mentioned': 0, 'heard': 1, 'experienced': 2}
RESERVED = ('world', 'world_svc', 'work', 'knowledge', 'vectors')   # works/<작품 id>/ 안의 다른 파일 이름과 겹치는 이름
SENTENCE = re.compile(r'(?<=[.!?。])\s+')
SPLIT = re.compile(r'(?<=[.!?。])\s+|\n+')   # 본문을 문장으로 가르는 규칙(합치기 증거 문장)
NEGATION = re.compile(r'(?:밝혀지|드러나|언급되|알려지|나타나|제시되|묘사되|서술되|확인되|파악되|나오|등장하)지\s*(?:않|못)|(?:확인|단정|판단|파악|알)\s*(?:할\s*)?수\s*없|단정하기(?:는)?\s*어렵')   # 근거가 없다는 말만 하는 문장(군더더기)
COUNT_SUFFIXES, INFO = ('_proposed', '_kept', '_checked', '_ok'), ('character_variant', 'presence_added', 'presence_upgraded')   # 통계에서 버린 코드가 아닌 항목
CARD_TOKENS, SUMMARY_TOKENS, IDENTITY_TOKENS, SECTION_TOKENS = 6_000, 3_000, 1_500, 3_000   # ⑦의 호출 종류별 출력 한도(카드는 회차 묶음 하나의 칸을 한 번에 받는다)
EVENT_OVERLAP = 4   # 본문 문장이 처음 나온 회차의 관련 사건 글과 (카드 자신의 이름을 뺀 뒤) 이만큼 이어서 같으면 사건에서 온 사실이라 본문에서 뺀다(공백 없이 접은 글자 수)
MIN_NAME, SPOT_MAX, SPOT_CUT = 2, 10, 300   # 원문에서 카드 이름을 글자 그대로 찾을 때: 이름의 최소 글자 수(한 글자 이름은 다른 낱말 속에서도 맞는다) / 회차당 모으는 곳 수 / 문장 하나의 글자 상한
BATCH_CHARS, BATCH_EPISODES = 10_000, 8   # 카드 호출 한 번의 입력 상한(회차 묶음): 글자 수 / 회차 수
DEFINE_MAX, CELL_MAX, REPEAT = 2, 6, 0.8   # 본문 문장 상한 / 회차 칸 하나의 문장 상한 / 앞 문장(본문·앞 회차 칸)과 3글자 조각이 이 비율 이상 같으면 되풀이로 버린다
SUMMARY_MIN_CHARS, SUMMARY_INPUT, SUMMARY_MAX = 3_000, 20_000, 8   # 인물 종합 소개: 병합이 아니어도 전체 글자 수가 이 이상이면 대상 / 입력 글자 상한 / 문장 상한
BODY_MAX = 5   # 병합 인물 소개(--tighten)의 문장 상한
MIN_QUOTE = 8   # 근거 인용의 최소 길이(공백 없이 접은 글자 수): 너무 짧은 인용은 아무 데나 들어맞는다
SECTION_LIMIT = 1_200   # 인물 회차 칸이 이보다 길면(앞 회차와 같은 줄을 뺀 뒤에도) 그 칸만 모델로 줄인다
GROUNDED = 0.5   # 줄인 줄이 입력 칸에 있는 내용이어야 하는 정도: 공백 없이 접은 글 3글자 조각 중 입력에도 있는 비율의 하한
REPEATABLE = ('[정체]', '[성격]', '[말투]', '[목표]')   # 앞 회차 칸과 글자 그대로 같으면 코드가 빼는 줄([행적]·사건 줄은 같아도 둔다)
LABELS = ('[정체]', '[성격]', '[말투]', '[목표]', '[행적]', '[겪은 일]', '[들은 일]')   # 인물 회차 칸의 줄 표지(doc_lines·memory_text가 만든다)
EVENT_LABELS = ('[겪은 일]', '[들은 일]')
META = re.compile(r'\d+\s*(?:화|회차)|(?:언급|등장|서술|묘사|소개)(?:된|되|한|하)')   # 글에 대한 말(회차 번호·'언급된다'·'등장한다'): 세계 안의 사실이 아니라 본문 줄거리의 흔적이라 본문·소개에서 뺀다
PAST = re.compile(r'(?:았|었|였|했|됐|랐|겼|쳤|혔|렸|섰|웠|췄)다[.!]?$')   # 과거 동작으로 끝나는 문장: 장소·조직 같은 카드의 본문은 오래 이어지는 사실이라 한 번 일어난 일은 회차 칸으로 보낸다
ECHO = re.compile(r'^\[(?:인물|\d+화 기억)\]')   # 모델이 입력의 머리글을 따라 쓴 줄(내용이 아니라 세지 않고 뺀다)
KIND_LABEL = {'location': '장소', 'organization': '조직', 'ability': '능력', 'object': '사물', 'rule': '규칙', 'event': '이름 붙은 사건'}

CHARS_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문이다. 이 회차에 나오는 인물(등장했거나 이야기 속에 이름이 나온 인물)을 뽑는다.
- name: 본문이 그 인물을 부르는 고유한 이름 그대로(조사를 붙이지 않는다). 종족·직업·직함·무리만 가리키는 말(예: 드워프, 고블린, 비서, 헌터들)은 이름이 아니므로 넣지 않는다. 한 인물을 여러 이름으로 부르면 이 회차에서 가장 자주 쓰인 이름 하나로 적는다.
- intro: 이 인물이 누구인지 한 구절(본문에 드러난 직업·신분·관계).
본문에 없는 내용은 쓰지 않는다. 다른 회차의 내용은 모른다."""

DOC_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문과 그 회차에 나오는 인물 한 명이다. 이 회차 본문에서 드러난 그 인물에 대해 자세히 쓴다.
- identity: 정체(신분·직업·소속·외모·내력·다른 사람과의 관계)를 이 회차에서 밝혀진 만큼 자세히 서술한다.
- personality: 성격·가치관·태도를 이 회차의 행동과 대사에서 드러난 만큼 서술한다.
- speech: 말투(존댓말·반말·말버릇·어조)를 서술한다.
- speech_quote: 그 말투가 드러난 이 인물의 대사 한 줄을 본문에서 한 글자도 고치지 말고 그대로 복사한다.
- goal: 이 회차에서 드러난 목표·바람·계획.
- activity: 이 회차에서 그 인물이 한 일과 겪은 일을 시간 순서로 2~5문장에 쓴다(어디서 누구와 무엇을 했는지, 누구에게 무엇을 듣거나 보았는지, 그 결과). 그 자리에 함께 있었거나 곁에서 지켜본 일도 빠뜨리지 않고, 다른 사람에게 전해 들은 일은 전해 들었다고 밝혀 쓴다.
이 회차 본문에 근거가 없는 항목은 반드시 빈 문자열로 둔다: 지어내지 않고 '밝혀지지 않는다'·'드러나지 않는다'·'언급되지 않는다'·'알 수 없다' 같은 없다는 말도 쓰지 않는다. 본문이 말해 주는 것만 쓴다. 다른 회차의 내용은 모른다."""

EVENTS_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문과 이 회차에 나오는 인물 목록이다. 이 회차에서 일어난 사건을 시간 순서로 빠짐없이 뽑는다(보통 6~12개). 한 사건은 한 번의 행동이나 대화 하나(같은 자리에서 이어지는 하나의 일)이고, 이어서 일어난 서로 다른 행동·대화는 사건을 나눠 적는다. 각 사건:
- title: 사건의 이름(6~20자 짧은 명사구, 결과를 쓰지 않는다).
- detail: 사건을 설명한다(누가 어디서 무엇을 어떻게 했는지 1~3문장). 사건에 등장하는 대상은 이름 앞에 @를 붙여 적는다(예: "@철수는 @영희에게 @칼을 건넸다").
- quote: 그 사건을 가장 잘 보여 주는 본문 문장 하나를 한 글자도 고치지 말고 그대로 복사한다.
- mentions: detail에서 @를 붙인 대상마다 하나씩. name은 본문이 그 대상을 부르는 이름 그대로(조사 제외), kind는 character(인물)·location(장소)·organization(조직)·ability(능력·기술·마법)·object(물건)·rule(세계의 규칙·제도)·event(이야기 속에서 이미 이름이 붙은 다른 사건) 중 하나다. 이 일곱 가지 밖의 대상에는 @를 붙이지 않는다.
  인물(character)은 위 인물 목록에 있는 이름만 쓰고(목록에 없는 인물·직함·무리에는 @를 붙이지 않는다) role을 반드시 쓴다: experienced = 그 자리에서 사건에 참여했거나 직접 보고 들었다, heard = 그 자리에 없었지만 이 회차 안에서 누군가에게 사건의 소식을 전해 듣고 알게 된 사람(듣는 쪽이며 소식 속에서 이야기되는 사람이 아니다), mentioned = 이야기 속에 이름만 나왔고 그 인물은 이 사건을 모른다. 인물이 아닌 대상의 role은 none이다.
종족·직업·직함·무리만 가리키는 말은 인물이 아니다. 본문에 없는 내용은 쓰지 않는다. 다른 회차의 내용은 모른다."""

PRESENCE_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문, 이 회차의 인물 목록, 이 회차의 사건 목록(번호·제목·설명)이다. 사건마다 그 사건의 자리에 누가 있었는지 가려낸다. 항목마다:
- event: 사건 번호.
- present: 그 사건이 일어난 자리에 있었던 인물의 이름(인물 목록의 이름 그대로). 직접 행동한 인물, 행동의 대상이 된 인물, 말을 건네거나 들은 인물, 곁에서 지켜본 인물이 모두 해당한다. 설명에 이름이 나오지 않아도 본문에서 그 자리에 있었음이 드러나면 넣는다. 그 자리에 없었거나 이야기 속에 이름만 나온 인물은 넣지 않는다.
- heard: 그 자리에는 없었지만 이 회차 안에서 다른 사람에게 그 사건의 소식을 전해 듣고 알게 된 인물(듣는 쪽). 소식 속에 이야기되는 인물이나 소식을 전한 인물은 그 자리에 있었다면 present에 넣고, 없었다면 어디에도 넣지 않는다.
사건을 한 항목씩 빠짐없이 쓰고 해당하는 인물이 없으면 빈 목록으로 둔다. 본문에 없는 내용은 쓰지 않는다. 다른 회차의 내용은 모른다."""

LEARN_INSTRUCTIONS = """다음은 같은 소설의 앞 회차에서 일어난 사건 목록(id·회차·제목·설명)과 그 뒤 한 회차의 인물 목록·본문이다. 이 회차 본문에서 어떤 인물이 앞 회차의 사건을 처음 전해 듣거나 알게 되는 장면만 찾는다(소문·편지·보고를 듣거나 읽는 경우, 이야기를 나누다 알게 되는 경우, 직접 확인하는 경우). 항목마다:
- event: 앞 회차 사건의 id 그대로.
- learner: 그 사건을 이 회차에서 알게 되는 인물의 이름(인물 목록의 이름 그대로).
- quote: 그 장면을 가장 잘 보여 주는 이 회차 본문 문장 하나를 한 글자도 고치지 말고 그대로 복사한다.
그 사건에 이미 참여했거나 직접 본 인물은 넣지 않는다. 사건이 단지 언급될 뿐 그 인물이 새로 알게 되는 것이 아니면 넣지 않는다. 해당하는 장면이 없으면 빈 목록으로 둔다. 본문에 없는 내용은 쓰지 않는다."""

RELS_INSTRUCTIONS = """다음은 한국 소설의 한 회차 본문과 이 회차의 인물 목록·사건 목록이다. 이 회차에서 드러난 인물 사이의 관계를 뽑는다(예: 사제, 연인, 적대, 동료, 부모와 자식, 주종, 가족).
- source·target: 인물 목록에 있는 서로 다른 두 이름. source → target 「label」은 'target은 source의 label'로 읽는다(예: 제자 → 스승 「스승」, 가윤 → 채율 「친구」).
- label: 관계 이름을 10자 이내로 짧게 쓴다(문장을 쓰지 않는다).
- quote: 그 관계를 보여 주는 본문 문장 하나를 한 글자도 고치지 말고 그대로 복사한다.
본문이 사실로 보여 준 관계만 쓰고 추측·소문은 쓰지 않는다. 같은 관계를 두 번 쓰지 않는다. 다른 회차의 내용은 모른다."""

MERGE_INSTRUCTIONS = """입력은 한 소설의 인물 요약(overview: 프로그램이 이름이 같거나 호칭만 다른 인물을 묶은 것마다 ref·names·episodes·intro), 회차별 인물 목록(episodes의 mentions: ref = "회차:번호", name, intro), 회차별로 검증된 인용 목록(quotes)과 후보 쌍(candidates)이다.
프로그램이 이름이 같거나 호칭만 다른 인물(치삼·치삼이·치삼아·치삼은)을 같은 인물로 묶는다. 너는 그 기본값이 틀리는 경우와 이름이 다른 같은 인물만 알려 준다(성을 뗀 이름과 성이 붙은 이름, 직함이 붙은 이름처럼 이름이 다른 같은 인물이 많다: overview에서 그런 쌍을 찾는다). 해당하는 것이 없으면 links를 빈 목록으로 낸다.
- left·right: 입력의 ref 그대로(예: "3:2")이며 이름이 아니라 ref를 쓴다. overview에서 찾은 쌍은 overview의 ref를 쓴다.
- same: 이름이 다른 두 호칭이 같은 인물이라고 인용이 보여 주는 쌍. left는 본체(본명·먼저 쓰인 이름), right는 별칭·가면·가명이다. hidden은 그 인물이 정체를 숨겼거나(가면·가명·위장) 뒤늦게 신분이 밝혀진 경우 true, 성과 이름·직함과 이름 같은 단순한 호칭 차이면 false다. 두 이름이 함께 나온다는 이유만으로 같은 인물로 보지 않는다.
- distinct: 이름이 같거나 호칭만 다르지만 서로 다른 인물(동명이인)인 쌍.
- uncertain: 같은 인물인지 인용만으로 알 수 없는 쌍(quote는 빈 문자열이어도 된다).
- quote: 입력의 인용 목록이나 candidates의 evidence에서 글자 그대로 고른 하나다(same·distinct). 이름이 서로 겹치지 않는 별칭·숨겨진 정체(예: 태곤과 자운, 가면과 본명)는 두 인물의 이름이 모두 들어 있어야 하고, 한쪽 이름이 다른 쪽 이름에 들어 있는 호칭 변형(예: 해랑과 정해랑, 별제와 청송 별제)은 한쪽 이름만 들어 있어도 된다.
candidates는 프로그램이 같은 인물일 수 있다고 골라낸 쌍이다(left·right = overview의 ref, names = 두 묶음의 이름들, together = 두 묶음이 같은 회차 인물 목록에 함께 나온 회차 수, evidence = 두 이름이 모두 든 본문 문장). 한쪽 이름이 다른 쪽 이름에 들어 있거나 한쪽 소개에 다른 쪽 이름이 나오는 쌍이다. 후보마다 판정해 links에 낸다: 같은 인물이면 same, 가족·친구·적처럼 서로 다른 사람이거나 동명이인이면 distinct, 알 수 없으면 uncertain. 한 장면에 함께 나오거나 서로 관계를 맺는 두 사람은 다른 사람이다.
근거 없는 추측은 내지 않는다."""


class Person(BaseModel):
    name: str
    intro: str


class Persons(BaseModel):
    characters: list[Person]


class CharDoc(BaseModel):
    identity: str
    personality: str
    speech: str
    speech_quote: str
    goal: str
    activity: str


class Mention(BaseModel):
    name: str
    kind: Literal['character', 'location', 'organization', 'ability', 'object', 'rule', 'event']   # 세계관 카드 카테고리 7종(기타는 @를 붙이지 않는다)
    role: Literal['experienced', 'heard', 'mentioned', 'none']   # 인물만 앞의 셋 중 하나, 그 밖의 대상은 none


class Event(BaseModel):
    title: str
    detail: str
    quote: str
    mentions: list[Mention]


class Events(BaseModel):
    events: list[Event]


class Presence(BaseModel):
    event: int
    present: list[str]
    heard: list[str]


class Presences(BaseModel):
    events: list[Presence]


class Learn(BaseModel):
    event: str
    learner: str
    quote: str


class Learned(BaseModel):
    learned: list[Learn]


class Rel(BaseModel):
    source: str
    target: str
    label: str
    quote: str


class Rels(BaseModel):
    relations: list[Rel]


class Link(BaseModel):
    left: str
    right: str
    verdict: Literal['same', 'distinct', 'uncertain']
    hidden: bool
    quote: str


class Links(BaseModel):
    links: list[Link]


REFINE_CARD_INSTRUCTIONS = """다음은 한국 소설의 설정 카드 하나(장소·조직·능력·사물·규칙·이름 붙은 사건 중 하나)와, 이 카드의 이름이 나온 회차마다 원문에서 모은 문장들이다(이름이 나온 문장과 그 앞뒤 문장, 이 카드가 나온 사건의 인용). 이 문장들만 보고 설정집에 실을 이 카드의 설명을 쓴다. 문장에 없는 내용은 절대 쓰지 않는다(상식·추측 금지).
출력은 두 칸이다.
- body: 이 카드가 무엇인지 알려 주는 짧은 정의 1~2문장. '처음 나온 회차' 자료만으로 쓴다(뒤 회차 자료는 쓰지 않는다). 이 문장은 이 카드를 모르는 모든 인물에게도 보이므로 인물 이름·사건·누가 무엇을 했는지·그때의 상태나 결과는 쓰지 않는다. 정의할 만한 내용이 없으면 비운다. 이번 호출에 처음 나온 회차가 없으면 늘 비운다.
- cells: 회차마다 그 회차 자료로 쓴 설명 3~6문장 — 모습·위치·소속과 구성원·쓰임새·조건과 대가·그 회차에 드러나거나 달라진 것. 이 칸은 작가용이라 그 회차 자료에 근거가 있으면 인물 이름과 사건을 써도 된다. 처음 나온 회차도 칸을 가진다. 문장 하나는 사실 하나를 구체적으로 쓴다. 그 회차 자료로 새로 말할 것이 없거나 앞 회차 칸 내용의 되풀이뿐이면 그 회차는 적지 않는다.
문장마다 quote를 붙인다: 그 문장의 근거가 된 자료 문장 하나(또는 그 일부)를 글자 그대로 복사한다(8자 이상). body의 quote는 처음 나온 회차 자료에서, cells의 quote는 그 회차 자료에서 고른다. '밝혀지지 않았다'·'알려지지 않았다'처럼 없다는 말은 쓰지 않는다.
(body 예: "성문 바깥 산기슭에 있는 훈련장이다." cells 예: "넓은 돌바닥 안뜰이다. 동쪽 담 아래에 우물이 있고 새벽마다 문하생들이 이곳에 모여 수련한다.")"""

REFINE_SUMMARY_INSTRUCTIONS = """다음은 한국 소설의 인물 한 명의 회차별 기억([n화 기억])이다. 이 인물은 여러 호칭으로 나올 수 있다. 이 기억들만 보고 설정집에 실을 이 인물의 종합 소개를 5~8문장으로 쓴다. 전체 회차를 아우르며 누구인가(신분·역할)·성격과 말투·목표(변화가 있으면 그 변화)·주요 행적·주요 관계를 담고, 호칭이 여럿이면 함께 적는다(예: "A(B로도 불린다)는 …"). 기억에 없는 내용은 쓰지 않는다. '밝혀지지 않았다'처럼 없다는 말은 쓰지 않는다.
문장마다 episodes에 그 문장의 근거가 된 회차 번호([n화 기억]의 n)를 모두 적는다."""

REFINE_IDENTITY_INSTRUCTIONS = """다음은 한국 소설의 인물 한 명의 소개 자료다. 이 인물은 프로그램이 같은 사람으로 합친 여러 이름(호칭)으로 나온다. 자료는 이 인물이 처음 나온 회차 하나의 것이다(이름별 소개·인물 문서, 그 회차의 사건·관계와 원문 인용).
자료만 보고 설정집에 실을 이 한 사람의 소개(IDENTITY) 2~5문장을 쓴다. 자료에 나온 이름(호칭)들을 함께 적어 한 사람의 소개로 읽히게 하고(예: "A(B로도 불린다)는 …"), 누구이고 어떤 위치·성질인지처럼 이 회차까지 드러난 오래 이어지는 사실만 쓴다. 자료에 없는 내용과 뒤 회차 내용은 쓰지 않는다. '밝혀지지 않았다'처럼 없다는 말은 쓰지 않는다.
문장마다 quote를 붙인다: 그 문장의 근거가 된 자료의 '인용:' 줄이나 말투 대사 하나를 글자 그대로 복사한다. 근거가 되는 인용이 없는 내용은 쓰지 않는다."""

REFINE_SECTION_INSTRUCTIONS = """다음은 한국 소설의 인물 한 명의 한 회차 기억이다. 줄마다 항목 표지([정체]·[성격]·[말투]·[목표]·[행적]·[겪은 일]·[들은 일])로 시작한다. 같은 내용을 되풀이하는 줄·문장을 하나로 합치고 군더더기를 덜어 더 짧게 정리해 같은 형식으로 다시 쓴다.
- 이 기억에 있는 내용만 쓴다. 새 내용을 더하지 않는다.
- 항목 표지를 그대로 쓰고 줄 순서도 [정체]·[성격]·[말투]·[목표]·[행적]·[겪은 일]·[들은 일] 순으로 둔다.
- [겪은 일]·[들은 일] 줄은 사건마다 한 줄씩 남기고 사건 제목(표지 다음 '제목: 설명'의 제목)을 그대로 둔다. 줄일 수 있는 것은 설명이다.
- [말투]의 대사 예시는 글자를 바꾸지 않는다.
- 입력 끝의 [목표 길이] 이하로 줄인다. 사건 줄은 제목을 지울 수 없어 더 줄일 수 없으면 그대로 둔다."""


class Said(BaseModel):
    text: str
    quote: str


class Cell(BaseModel):
    episode: int
    sentences: list[Said]


class Described(BaseModel):
    body: list[Said]
    cells: list[Cell]


class Cited(BaseModel):
    text: str
    episodes: list[int]   # 문장의 근거가 된 회차 번호(그 회차 칸이 실제로 있어야 한다)


class Summarized(BaseModel):
    sentences: list[Cited]


class Introduced(BaseModel):
    sentences: list[Said]


class Tightened(BaseModel):
    text: str


def limit(kind: str, base: int) -> int:
    """호출 종류의 max_output_tokens: 기본 한도 × 그 종류의 강도 배수(FACTORS, 없으면 1)."""
    return base * FACTORS.get(kind, 1)


def parse_routes(specs: list[str]) -> dict[str, tuple[str, str | None]]:
    """--step-llm 'kind=모델[@강도]'를 {kind: (모델, 강도 또는 None)}로: 그 종류의 호출만 다른 게이트웨이 모델·추론 강도로 보낸다(나머지는 --gen-model·--gen-effort)."""
    routes = {}
    for spec in specs:
        kind, _, rest = spec.partition('=')
        model, _, effort = rest.partition('@')
        if kind not in KINDS or not model or (effort and effort not in EFFORTS):
            raise SystemExit(f"--step-llm '{spec}'은 쓸 수 없다: kind={'·'.join(KINDS)} 중 하나, 모델[@{'·'.join(EFFORTS)}].")
        routes[kind] = (model, effort or None)
    return routes


def route(llm, others: dict) -> None:
    """llm의 for_kind를 바꿔 others(kind → Llm)에 있는 종류는 그 Llm으로 보낸다(Planner·SyncExecutor가 요청마다 for_kind로 고른다). 캐시 열쇠에 모델 이름이 들어 있어 같은 캐시 폴더를 함께 써도 섞이지 않는다."""
    llm.for_kind = lambda kind, base=llm.for_kind: others.get(kind) or base(kind)


def check_name(name: str) -> str:
    """결과 이름(--name): 세계관 파일 이름(works/<id>/<name>.json)이 되므로 작품 폴더의 다른 파일과 겹치는 이름은 막는다."""
    return _check_name(name, RESERVED)


def _flat(text: str) -> str:
    return ' '.join(text.split())


def plain(detail: str) -> str:
    """사건 설명의 @표지를 떼고 이름만 남긴다."""
    return detail.replace('@', '')


# ---- 회차별 모델 출력 재검증(순수 함수) ----

def verify_people(text: str, out: Persons) -> tuple[dict[str, str], Counter]:
    """① 인물: 이름이 본문에 글자 그대로 있는 2~20자 이름만(중복 제외). 이름 → 한 구절 소개."""
    stats: Counter = Counter()
    people: dict[str, str] = {}
    for p in out.characters:
        stats['characters_proposed'] += 1
        name = _flat(p.name)
        if not 2 <= len(name) <= 20 or name not in text:
            stats['character_name'] += 1
        elif name in people:
            stats['character_dup'] += 1
        else:
            people[name] = _flat(p.intro)[:120]
            stats['characters_kept'] += 1
    return people, stats


def verify_doc(text: str, out: CharDoc) -> tuple[dict, Counter]:
    """② 인물 문서: 말투 대사가 원문에 없으면 그 줄만 버린다(서술은 둔다). 모든 칸이 비면 빈 문서."""
    stats: Counter = Counter()
    doc = {field: _flat(getattr(out, field))[:1000] for field in DOC_FIELDS}
    for field in (f for f in DOC_FIELDS if f != 'speech_quote'):   # 대사 줄은 원문 복사라 거르지 않는다
        sentences = [s for s in SENTENCE.split(doc[field]) if s]
        kept = [s for s in sentences if not NEGATION.search(s)]
        stats['doc_negation'] += len(sentences) - len(kept)
        doc[field] = ' '.join(kept)
    if doc['speech_quote']:
        stats['speech_quote_checked'] += 1
        if evidence_ok(text, doc['speech_quote']):
            stats['speech_quote_ok'] += 1
        else:
            stats['speech_quote'] += 1
            doc['speech_quote'] = ''
    if not any(doc.values()):
        stats['docs_empty'] += 1
        return {}, stats
    stats['docs_kept'] += 1
    return doc, stats


def _listed(name: str, people: dict, stats: Counter) -> str | None:
    """이 회차 인물 목록(①)의 이름으로 맞춘다: 그대로 있거나 호칭 변형(_base가 같음)이 하나뿐이면 그 이름이고, 목록에 없으면 None이다(누가 인물인지는 ①이 정한다: 직함·무리가 인물로 새지 않게)."""
    if name in people:
        return name
    variants = [p for p in people if _base(p) == _base(name)]
    if len(variants) == 1:
        stats['character_variant'] += 1
        return variants[0]
    return None


def _mentions(text: str, mentions: list[Mention], people: dict, stats: Counter) -> list[dict]:
    kept: dict[tuple[str, str], str] = {}
    for m in mentions:
        stats['mentions_proposed'] += 1
        name = _flat(m.name).lstrip('@')
        if not 2 <= len(name) <= 20 or name not in text:
            stats['mention_name'] += 1
            continue
        role = 'none'
        if m.kind == 'character':
            if m.role not in ROLE_RANK:
                stats['mention_role'] += 1   # 인물에는 역할이 반드시 있어야 한다
                continue
            role, name = m.role, _listed(name, people, stats)
            if name is None:
                stats['mention_unlisted'] += 1
                continue
        if (m.kind, name) in kept:
            stats['mention_dup'] += 1
            if m.kind == 'character' and ROLE_RANK[role] > ROLE_RANK[kept[m.kind, name]]:
                kept[m.kind, name] = role   # 같은 인물이 둘로 올라오면 더 많이 아는 역할이 이긴다
            continue
        kept[m.kind, name] = role
        stats['mentions_kept'] += 1
    return [{'name': name, 'kind': kind, 'role': role} for (kind, name), role in kept.items()]


def verify_events(text: str, out: Events, people: dict[str, str]) -> tuple[list[dict], Counter]:
    """③ 사건: 제목·설명이 있고 인용이 원문에 있는 사건만(어긋나면 그 사건을 버리고 건수를 남긴다). @ 대상은 이름이 본문에 있는 것만이고, 인물은 ① 목록의 인물이며 역할이 있어야 한다."""
    stats: Counter = Counter()
    events, seen = [], set()
    for e in out.events:
        stats['events_proposed'] += 1
        title, detail, quote = _flat(e.title)[:40], _flat(e.detail), _flat(e.quote)
        if not title or len(detail) < 8:
            stats['event_text'] += 1
            continue
        stats['event_quote_checked'] += 1
        if not evidence_ok(text, quote):
            stats['event_quote'] += 1
            continue
        stats['event_quote_ok'] += 1
        if (title, squash(quote)) in seen:
            stats['event_dup'] += 1
            continue
        seen.add((title, squash(quote)))
        events.append({'title': title, 'detail': detail, 'quote': quote, 'mentions': _mentions(text, e.mentions, people, stats)})
        stats['events_kept'] += 1
    return events, stats


def verify_presence(out: Presences, people: dict[str, str], count: int) -> tuple[list[tuple[int, str, str]], Counter]:
    """④' 사건의 자리: 사건 번호가 1~count이고 이름이 ① 인물 목록(호칭 변형 포함)에 있는 것만. 한 사건에서 같은 인물이 여러 번 올라오면 그 자리에 있던(experienced)이 들음(heard)을 이긴다.
    (사건 번호 − 1, 이름, 역할) 목록을 사건·이름 순으로 돌려준다."""
    stats: Counter = Counter()
    found: dict[tuple[int, str], str] = {}
    for item in out.events:
        stats['presence_proposed'] += 1
        if not 1 <= item.event <= count:
            stats['presence_event'] += 1
            continue
        for role, names in (('experienced', item.present), ('heard', item.heard)):
            for raw in names:
                stats['presence_names_proposed'] += 1
                name = _listed(_flat(raw), people, stats)
                if name is None:
                    stats['presence_name'] += 1
                elif ROLE_RANK[role] > ROLE_RANK.get(found.get((item.event - 1, name)), -1):
                    found[item.event - 1, name] = role
    stats['presence_names_kept'] = len(found)
    return [(index, name, role) for (index, name), role in sorted(found.items())], stats


def near(text: str, quote: str, name: str, window: int) -> bool:
    """이름이 사건 인용에서 window자(공백 없이 접은 글 기준, 인용 안은 거리 0) 안에 본문에 나오는가. 인용이 본문에 없으면 판단하지 않고 False."""
    body, quoted, who = squash(text), squash(quote), squash(name)
    start = body.find(quoted)
    if start < 0 or not who:
        return False
    end, i = start + len(quoted), body.find(who)
    while i >= 0:
        if i < end + window and i + len(who) > start - window:
            return True
        i = body.find(who, i + 1)
    return False


def apply_presence(events: list[dict], links: list[tuple[int, str, str]], text: str = '', window: int | None = None) -> tuple[list[dict], Counter]:
    """③ 사건에 ④' 결과를 더한다: 사건에 없는 인물은 그 역할로 더하고, 있는 인물은 더 많이 아는 역할이면 올린다(내리지 않는다). 입력은 바꾸지 않는다.
    window를 주면 그 자리에 있던(experienced) 인물은 이름이 사건 인용 window자 안에 본문에 나올 때만 더하고(near, 아니면 presence_far), 들음은 거리를 묻지 않는다(소식은 사건과 떨어진 곳에서 들을 수 있다)."""
    stats: Counter = Counter()
    out = [{**e, 'mentions': [dict(m) for m in e['mentions']]} for e in events]
    for index, name, role in links:
        if role == 'experienced' and window is not None and not near(text, out[index]['quote'], name, window):
            stats['presence_far'] += 1
            continue
        mentions = out[index]['mentions']
        mine = next((m for m in mentions if m['kind'] == 'character' and m['name'] == name), None)
        if mine is None:
            mentions.append({'name': name, 'kind': 'character', 'role': role})
            stats['presence_added'] += 1
        elif ROLE_RANK[role] > ROLE_RANK[mine['role']]:
            mine['role'] = role
            stats['presence_upgraded'] += 1
    return out, stats


_PALATAL = re.compile('([\u1109\u110c\u110e])([\u1163\u1167\u116d\u1172])')   # ㅅㅈㅊ + ㅑㅕㅛㅠ(옛 표기: 샹·셔·쇼·쥬)
_INITIAL_N = re.compile('(^|\\s)\u1102(?=[\u1163\u1167\u116d\u1172\u1175])')   # 낱말 첫 ㄴ + ㅑㅕㅛㅠㅣ(옛 표기: 냥·녀·뇨·뉴·니)
_PLAIN = str.maketrans('\u1163\u1167\u116d\u1172', '\u1161\u1165\u1169\u116e')   # ㅑㅕㅛㅠ → ㅏㅓㅗㅜ


def _modern(name: str) -> str:
    """옛 표기를 현대 표기로 바꾼 글(이름 묶음 키로만 쓴다, 카드 이름은 그대로): 같은 이름이 옛 표기와 현대 표기로 따로 나오는 고전 작품에서 한 사람이 둘로 갈리고 정답표(현대 표기)와도 안 맞는 것을 막는다.
    ponytail: 낱말 첫 ㄴ+ㅣ를 ㅇ으로 읽어 현대 외래 이름(니콜·뉴턴)도 키가 바뀌지만 같은 작품에 '이콜' 같은 이름이 따로 있을 때만 부딪힌다(같은 사건에 나오면 apart_pairs가 막는다)."""
    jamo = _PALATAL.sub(lambda m: m[1] + m[2].translate(_PLAIN), unicodedata.normalize('NFD', name))
    return unicodedata.normalize('NFC', _INITIAL_N.sub(lambda m: m[1] + '\u110b', jamo))


def _base(name: str) -> str:
    """이름 묶음 키: 서비스 호칭 변형 규칙에 옛 표기 정규화(_modern)를 더한다."""
    return _service_base(_modern(name))


def event_id(episode: int, number: int) -> str:
    """세계관 사건 카드 id: e<회차 두 자리>-<그 회차의 사건 번호(1부터)>."""
    return f'e{episode:02d}-{number}'


def earlier_events(records: list[dict]) -> list[dict]:
    """앞 회차 기록의 사건 목록: id는 세계관 사건 카드 id(e<회차>-<번호>), known = 그 사건을 겪었거나 들은 인물의 기본 이름(_base, 이미 아는 사람)."""
    return [{'id': event_id(r['episode'], i), 'episode': r['episode'], 'title': e['title'], 'detail': plain(e['detail']),
             'known': {_base(m['name']) for m in e['mentions'] if m['kind'] == 'character' and m['role'] in ('experienced', 'heard')}}
            for r in records for i, e in enumerate(r['events'], 1)]


def verify_learned(text: str, out: Learned, earlier: list[dict], people: dict[str, str], episode: int) -> tuple[list[dict], Counter]:
    """뒤 회차에 전해 들음: 사건 id가 앞 회차 목록에 있고, 인물이 이 회차 ① 목록(호칭 변형 포함)에 있고, 그 사건을 이미 겪었거나 들은 사람이 아니고, 인용이 이 회차 원문에 있는 것만(같은 사건·인물은 한 번)."""
    stats: Counter = Counter()
    by_id = {e['id']: e for e in earlier}
    kept, seen = [], set()
    for item in out.learned:
        stats['learned_proposed'] += 1
        event, learner, quote = by_id.get(_flat(item.event)), _listed(_flat(item.learner), people, stats), _flat(item.quote)
        if event is None:
            stats['learn_event'] += 1
        elif learner is None:
            stats['learn_name'] += 1
        elif _base(learner) in event['known']:
            stats['learn_known'] += 1
        else:
            stats['learn_quote_checked'] += 1
            found = evidence_ok(text, quote)
            stats['learn_quote_ok'] += found
            if not found:
                stats['learn_quote'] += 1
            elif (event['id'], learner) in seen:
                stats['learn_dup'] += 1
            else:
                seen.add((event['id'], learner))
                kept.append({'episode': episode, 'event': event['id'], 'learner': learner, 'quote': quote})
                stats['learned_kept'] += 1
    return kept, stats


def verify_relations(text: str, out: Rels, people: dict[str, str]) -> tuple[list[dict], Counter]:
    """④ 인물 사이 관계: 두 끝점이 ① 인물 목록의 서로 다른 인물이고 label이 1~10자이며 인용이 원문에 있는 것만(중복 제외)."""
    stats: Counter = Counter()
    kept, seen = [], set()
    for r in out.relations:
        stats['relations_proposed'] += 1
        source, target, label, quote = _listed(_flat(r.source), people, stats), _listed(_flat(r.target), people, stats), _flat(r.label), _flat(r.quote)
        if source is None or target is None:
            stats['relation_endpoint'] += 1
            continue
        if source == target:
            stats['relation_self'] += 1
            continue
        if not 1 <= len(label) <= 10:
            stats['relation_label'] += 1
            continue
        stats['relation_quote_checked'] += 1
        if not evidence_ok(text, quote):
            stats['relation_quote'] += 1
            continue
        stats['relation_quote_ok'] += 1
        if (source, target, label) in seen:
            stats['relation_dup'] += 1
            continue
        seen.add((source, target, label))
        stats['relations_kept'] += 1
        kept.append({'source': source, 'target': target, 'label': label, 'quote': quote})
    return kept, stats


# ---- 인물 기억 글 ----

def doc_lines(doc: dict) -> list[str]:
    """인물 문서의 줄: [정체]·[성격]·[말투](대사 예시)·[목표]·[행적]. 빈 칸은 뺀다(행적 칸이 없던 옛 기록도 읽는다)."""
    speech = ' '.join(x for x in (doc.get('speech', ''), f"(예: {doc['speech_quote']})" if doc.get('speech_quote') else '') if x)
    lines = [('[정체]', doc.get('identity', '')), ('[성격]', doc.get('personality', '')), ('[말투]', speech), ('[목표]', doc.get('goal', '')), ('[행적]', doc.get('activity', ''))]
    return [f'{label} {text}' for label, text in lines if text]


def _fit(lines) -> list[str]:
    """같은 줄은 한 번만, 한 칸 한도(DOC_LIMIT) 안에서 앞 줄부터 쌓는다. 줄은 자르지 않고 넘치는 줄부터 뺀다."""
    kept, size = [], -1
    for line in dict.fromkeys(lines):
        size += len(line) + 1
        if size > DOC_LIMIT:
            break
        kept.append(line)
    return kept


def memory_text(docs: list[dict], lived: list[dict], heard: list[dict]) -> str:
    """한 회차의 인물 기억: 그 회차 인물 문서 줄 다음에 그 회차에 겪은 사건·전해 들은 사건(제목: 설명)."""
    lines = [line for doc in docs for line in doc_lines(doc)]
    lines += [f"[겪은 일] {e['title']}: {plain(e['detail'])}" for e in lived]
    lines += [f"[들은 일] {e['title']}: {plain(e['detail'])}" for e in heard]
    return '\n'.join(_fit(lines))


# ---- 작품 합치기 ----

def _contained(short: str, long: str) -> bool:
    """짧은 이름(2자 이상)이 긴 이름의 끝부분이거나 공백으로 나뉜 낱말로 들어 있다(성을 뗀 이름·직함이 붙은 이름·표기 변형의 앞부분)."""
    return len(short) >= 2 and short != long and (long.endswith(short) or f' {short} ' in f' {long} ')


def merge_candidates(records: list[dict], texts: dict[int, str], cap: int = 60) -> list[dict]:
    """합치기 후보 쌍(코드가 고른다, 모델은 확정·거부만): 이름이 다른 기본 묶음(_base)끼리 한쪽 이름이 다른 쪽 이름에 들어 있거나(contained) 한쪽 소개에 다른 쪽 이름이 나오면 후보다.
    포함 관계가 앞서고 최대 cap쌍. 항목 = {left, right: 묶음의 ref, names: [왼쪽 이름들, 오른쪽 이름들], together: 두 묶음이 같은 회차 인물 목록에 함께 나온 회차 수,
    evidence: 두 이름이 모두 든 본문 문장(8~160자) 최대 둘, at: 그 문장의 회차(모델에는 보내지 않는다)}."""
    groups: dict[str, dict] = {}
    for r in records:
        for i, (name, info) in enumerate(r['characters'].items(), 1):
            g = groups.setdefault(_base(name), {'ref': f"{r['episode']}:{i}", 'names': [], 'episodes': set(), 'intro': ''})
            g['names'] += [name] * (name not in g['names'])
            g['episodes'].add(r['episode'])
            g['intro'] = g['intro'] or info['intro']
    pairs = []
    for a, b in combinations(groups.values(), 2):
        contained = any(_contained(x, y) or _contained(y, x) for x in a['names'] for y in b['names'])
        named = any(len(x) >= 2 and x in b['intro'] for x in a['names']) or any(len(y) >= 2 and y in a['intro'] for y in b['names'])
        if contained or named:
            pairs.append((not contained, a, b))
    out = []
    for _, a, b in sorted(pairs, key=lambda p: p[0])[:cap]:   # 포함 관계가 앞서고 정렬은 안정적이라 같은 종류 안에서는 묶음이 처음 나온 순서
        evidence, at = [], []
        for n in sorted(a['episodes'] | b['episodes']):
            for s in (s.strip() for s in SPLIT.split(texts.get(n, ''))):
                if len(evidence) < 2 and 8 <= len(s) <= 160 and any(x in s for x in a['names']) and any(y in s for y in b['names']):
                    evidence.append(s)
                    at.append(n)
        out.append({'left': a['ref'], 'right': b['ref'], 'names': [a['names'], b['names']], 'together': len(a['episodes'] & b['episodes']), 'evidence': evidence, 'at': at})
    return out


def merge_input(records: list[dict], texts: dict[int, str] | None = None) -> tuple[dict[str, tuple[int, int, str]], dict, dict[str, list[int]]]:
    """합치기 호출의 입력. people = ref('회차:번호') → (회차, 번호, 이름), data = 모델에 보낼 {overview: 이름이 같거나 호칭 변형인 기본 묶음마다 한 줄, episodes: 회차별 인물·인용 목록,
    candidates: texts(회차 번호 → 본문)를 주었을 때만, merge_candidates의 후보 쌍과 증거 문장}, quotes = 정규화한 인용 → 그 인용이 든 회차들(검증된 사건·관계 인용과 후보의 증거 문장)."""
    people, data, quotes, groups = {}, [], {}, {}
    for r in records:
        n, rows = r['episode'], []
        for i, (name, info) in enumerate(r['characters'].items(), 1):
            ref = f'{n}:{i}'
            people[ref] = (n, i, name)
            rows.append({'ref': ref, 'name': name, 'intro': info['intro']})
            group = groups.setdefault(_base(name), {'ref': ref, 'names': Counter(), 'episodes': set(), 'intro': ''})
            group['names'][name] += 1
            group['episodes'].add(n)
            group['intro'] = group['intro'] or info['intro']
        found = sorted({e['quote'] for e in r['events']} | {x['quote'] for x in r['relations']})
        for quote in found:
            quotes.setdefault(squash(quote), []).append(n)
        data.append({'number': n, 'mentions': rows, 'quotes': found})
    overview = [{'ref': g['ref'], 'names': [name for name, _ in g['names'].most_common()], 'episodes': sorted(g['episodes']), 'intro': g['intro']} for g in groups.values()]
    out = {'overview': overview, 'episodes': data}
    if texts is not None:
        found = merge_candidates(records, texts)
        out['candidates'] = [{k: v for k, v in c.items() if k != 'at'} for c in found]
        for c in found:
            for sentence, n in zip(c['evidence'], c['at']):
                quotes.setdefault(squash(sentence), []).append(n)
    return people, out, quotes


def verify_links(out: Links | None, people: dict, quotes: dict) -> tuple[list[dict], Counter]:
    """합치기 출력 재검증: 두 ref가 입력에 있고, same·distinct는 인용이 입력 인용 중 하나여야 한다. 이름이 서로 겹치지 않는 별칭과 숨겨진 정체(same + hidden: 동일 인물 관계를 만든다)는 두 이름이 모두 든 인용이어야 하고
    (한쪽 이름만 든 인용으로는 같은 인물이라 할 수 없다), 숨겨진 정체는 근거 회차(인용이 든 회차)가 두 이름이 처음 나온 회차보다 앞서면 안 된다(뒤늦게 밝혀진 정체를 첫 등장 회차로 당기지 않는다).
    한쪽 이름이 다른 쪽 이름에 들어 있는 호칭 변형(성을 뗀 이름·직함이 붙은 이름)과 distinct는 두 이름 중 하나라도 든 인용이면 되고 회차 순서는 묻지 않는다. 호칭 변형의 same(숨기지 않음)은 이름 포함을 프로그램이 확인했으므로 인용이 틀려도 받는다
    (근거 회차 = 두 이름이 모두 나온 뒤, merge_quote_waived로 센다). uncertain은 근거를 묻지 않는다. 같은 쌍은 먼저 온 것만 쓴다."""
    stats: Counter = Counter()
    kept, seen = [], set()
    if out is None:
        return kept, stats
    first: dict[str, int] = {}
    for n, _, name in people.values():
        first[_base(name)] = min(n, first.get(_base(name), n))
    for l in out.links:
        stats['merge_links_proposed'] += 1
        a, b, quote = people.get(l.left), people.get(l.right), _flat(l.quote)
        if a is None or b is None or l.left == l.right:
            stats['merge_ref'] += 1
            continue
        if frozenset((l.left, l.right)) in seen:
            stats['merge_dup'] += 1
            continue
        episode = None
        if l.verdict != 'uncertain':
            when = quotes.get(squash(quote))
            named = [squash(a[2]) in squash(quote), squash(b[2]) in squash(quote)]
            hidden = l.verdict == 'same' and l.hidden
            variant = squash(a[2]) in squash(b[2]) or squash(b[2]) in squash(a[2])
            if l.verdict == 'same' and not hidden and variant and (when is None or not any(named)):   # 이름 포함은 프로그램이 이미 확인했다: 같은 인물 판정만 받고 인용 근거는 묻지 않는다(모델이 인용을 줄여 쓰면 주인공이 둘로 갈렸다)
                stats['merge_quote_waived'] += 1
                episode = max(first[_base(a[2])], first[_base(b[2])])
            else:
                if when is None:
                    stats['merge_quote'] += 1
                    continue
                if not (all(named) if hidden or (l.verdict == 'same' and not variant) else any(named)):
                    stats['merge_names'] += 1
                    continue
                episode = next((n for n in when if n >= (max(first[_base(a[2])], first[_base(b[2])]) if hidden else 0)), None)
                if episode is None:
                    stats['merge_early'] += 1
                    continue
        seen.add(frozenset((l.left, l.right)))
        kept.append({'left': l.left, 'right': l.right, 'verdict': l.verdict, 'hidden': l.hidden, 'episode': episode, 'quote': quote})
    return kept, stats


def apart_pairs(records: list[dict]) -> set[frozenset]:
    """서로 다른 사람이라고 데이터가 보여 주는 인물 ref 쌍: 같은 사건에 함께 나온 인물(어느 역할이든)과 서로 관계가 있는 인물. 같은 이름의 변형(_base가 같음)은 갈리지 않는다.
    한 사람이 같은 사건에 두 이름으로 따로 나오지 않고 자기 자신과 관계를 맺지 않으므로, 합치기 호출이 이런 두 이름을 같다고 해도(어머니와 아들·아버지와 아들을 한 카드로 합치는 오류) 합치지 않는 근거가 된다."""
    pairs: set[frozenset] = set()
    for r in records:
        ref = {name: f"{r['episode']}:{i}" for i, name in enumerate(r['characters'], 1)}
        groups = [[m['name'] for m in e['mentions'] if m['kind'] == 'character' and m['name'] in ref] for e in r['events']]
        groups += [[x['source'], x['target']] for x in r['relations'] if x['source'] in ref and x['target'] in ref]
        for names in groups:
            pairs.update(frozenset((ref[a], ref[b])) for a, b in combinations(names, 2) if _base(a) != _base(b))
    return pairs


def resolve_groups(people: dict[str, tuple[int, int, str]], links: list[dict], apart=()) -> tuple[dict[str, int], list[dict], Counter]:
    """인물 ref → 카드 번호와 동일 인물 관계 후보. 기본값은 이름이 같거나 호칭 변형(_base)이 같으면 한 카드이고, 앞 카드가 하나뿐이고 distinct로 갈리지 않았을 때만 합친다
    (앞 카드가 둘 이상이거나 distinct로 막히면 어느 쪽인지 몰라 따로 둔다). apart(apart_pairs: 같은 사건에 함께 나왔거나 서로 관계가 있는 쌍)도 distinct와 같게 막는다. same(숨기지 않은 단순 호칭 차이)은 카드를 합치되 distinct·apart로 갈린 쌍은 합치지 않고(merge_conflict),
    same(숨겨진 정체)은 카드를 따로 둔 채 별칭(right) → 본체(left)의 동일 인물 관계 후보를 근거 회차와 함께 낸다(DEC-53 저장 규칙대로 가면 하나에 본체 하나, 한 카드가 가면이면서 본체일 수 없고,
    어기는 링크는 먼저 온 것만 남긴다 merge_identity_rule). uncertain은 세기만 한다."""
    stats: Counter = Counter()
    distinct = {frozenset((l['left'], l['right'])) for l in links if l['verdict'] == 'distinct'}
    stats['distinct'], stats['uncertain'] = len(distinct), sum(l['verdict'] == 'uncertain' for l in links)
    distinct |= set(apart)   # 모델의 distinct에 더해 데이터가 다른 사람이라고 보여 주는 쌍(apart_pairs)도 합치지 않는다
    group, members, by_key = {}, {}, {}
    for ref in sorted(people, key=lambda r: people[r][:2]):
        key = _base(people[ref][2])
        near = by_key.get(key, [])
        free = [g for g in near if not any(frozenset((ref, m)) in distinct for m in members[g])]
        if len(near) == 1 and free:
            g = near[0]
        else:
            g = len(members)
            members[g] = []
            by_key.setdefault(key, []).append(g)
        group[ref] = g
        members[g].append(ref)
    parent = {g: g for g in members}

    def find(g: int) -> int:
        while parent[g] != g:
            g = parent[g]
        return g

    sames = sorted((l for l in links if l['verdict'] == 'same'), key=lambda l: (l['episode'], l['left'], l['right']))
    for l in (l for l in sames if not l['hidden']):
        a, b = find(group[l['left']]), find(group[l['right']])
        if a == b:
            continue
        if any(frozenset((x, y)) in distinct for x in members[a] for y in members[b]):
            stats['merge_conflict'] += 1
            continue
        parent[b] = a
        members[a] += members.pop(b)
        stats['same_merged'] += 1
    identity, masks, bodies = [], {}, set()   # 가면 카드 → 본체 카드, 본체 카드들
    for l in (l for l in sames if l['hidden']):
        main, alias = find(group[l['left']]), find(group[l['right']])
        if main == alias:
            stats['merge_same_group'] += 1
        elif masks.get(alias) == main:
            continue   # 같은 쌍은 먼저 온 것만
        elif alias in masks or alias in bodies or main in masks:
            stats['merge_identity_rule'] += 1   # DEC-53 저장 규칙: 한 카드는 가면이거나 본체이고 가면의 본체는 하나(사슬·순환 없음)
        else:
            masks[alias] = main
            bodies.add(main)
            identity.append({'main': main, 'alias': alias, 'episode': l['episode'], 'quote': l['quote']})
            stats['same_hidden'] += 1
    return {ref: find(g) for ref, g in group.items()}, identity, stats


def _title(names, text: str) -> str:
    """카드 제목: 본문에 가장 자주 나오는 형태(동률이면 짧은 쪽)."""
    return min(names, key=lambda n: (-text.count(n), len(n), n))


def build_world2(wid: str, records: list[dict], links: list[dict], text: str, learned=()) -> tuple[dict, dict]:
    """검증된 회차별 기록과 합치기 결과로 평가용 세계관(kt_world.build_world와 같은 모양 + 평가용 덧붙임)과 통계를 만든다. 규칙은 모듈 설명.

    records는 회차 기록(characters·events·relations), links는 verify_links의 결과, text는 작품 전체 글(카드 제목을 고를 때 이름이 나온 횟수를 센다),
    learned는 verify_learned의 결과(뒤 회차에 앞 사건을 전해 들음: 그 회차에 사건 카드로 '들음'을 잇고 듣는 인물의 그 회차 기억에 사건을 싣는다. 이미 겪었거나 같은 회차에 들은 인물·없는 사건·카드가 없는 인물은 건너뛴다).
    """
    people = {f"{r['episode']}:{i}": (r['episode'], i, name) for r in records for i, name in enumerate(r['characters'], 1)}
    group, identity, merge = resolve_groups(people, links, apart_pairs(records))
    by_episode = {r['episode']: r for r in records}
    members: dict[int, list[str]] = {}
    for ref, g in group.items():
        members.setdefault(g, []).append(ref)
    first = {g: min(people[r][0] for r in refs) for g, refs in members.items()}
    names = {g: {people[r][2] for r in refs} for g, refs in members.items()}
    title = {g: _title(names[g], text) for g in members}
    order = sorted(members, key=lambda g: (first[g], title[g]))
    char_id = {g: f'c{k:03d}' for k, g in enumerate(order, 1)}
    card_of = {(people[r][0], people[r][2]): char_id[g] for r, g in group.items()}   # (회차, 이름) → 인물 카드 id
    entities: dict[tuple[str, str], dict] = {}
    for r in records:
        for e in r['events']:
            for m in e['mentions']:
                if m['kind'] != 'character':
                    d = entities.setdefault((m['kind'], _base(m['name'])), {'names': set(), 'first': r['episode']})
                    d['names'].add(m['name'])
                    d['first'] = min(d['first'], r['episode'])
    entity_order = sorted(entities, key=lambda k: (entities[k]['first'], k[0], _title(entities[k]['names'], text)))
    entity_id = {k: f'x{i:03d}' for i, k in enumerate(entity_order, 1)}

    lived: dict[tuple[str, int], list[dict]] = {}
    heard: dict[tuple[str, int], list[dict]] = {}
    for r in records:
        for e in r['events']:
            for m in e['mentions']:
                shelf = {'experienced': lived, 'heard': heard}.get(m['role']) if m['kind'] == 'character' else None
                if shelf is not None and (r['episode'], m['name']) in card_of:
                    shelf.setdefault((card_of[r['episode'], m['name']], r['episode']), []).append(e)
    event_of = {event_id(r['episode'], i): e for r in records for i, e in enumerate(r['events'], 1)}
    knew = {event_id(r['episode'], i): {card_of[r['episode'], m['name']] for m in e['mentions'] if m['kind'] == 'character' and m['role'] != 'mentioned' and (r['episode'], m['name']) in card_of}
            for r in records for i, e in enumerate(r['events'], 1)}   # 사건 카드 id → 그 사건을 겪었거나 같은 회차에 들은 인물 카드
    later: dict[tuple[str, str], int] = {}   # (사건 카드 id, 인물 카드 id) → 뒤 회차에 처음 들은 회차
    for item in sorted(learned, key=lambda x: x['episode']):
        cid = card_of.get((item['episode'], item['learner']))
        if cid is not None and item['event'] in knew and cid not in knew[item['event']]:
            later.setdefault((item['event'], cid), item['episode'])
    for (eid, cid), n in later.items():
        heard.setdefault((cid, n), []).append(event_of[eid])
    cards = []
    for g in order:
        refs = sorted(members[g], key=lambda r: people[r][:2])
        docs: dict[int, list[dict]] = {}
        for ref in refs:
            n, _, name = people[ref]
            if doc := by_episode[n]['characters'][name]['doc']:
                docs.setdefault(n, []).append(doc)
        head = [by_episode[first[g]]['characters'][people[r][2]] for r in refs if people[r][0] == first[g]]
        body = next((info['doc']['identity'] for info in head if info['doc'].get('identity')), None) or next((info['intro'] for info in head if info['intro']), '')
        episodes = {}
        for n in sorted({people[r][0] for r in refs}):
            memory = memory_text(docs.get(n, []), lived.get((char_id[g], n), []), heard.get((char_id[g], n), []))
            if memory:
                episodes[n] = memory
        cards.append(Card(id=char_id[g], cardType='character', title=title[g], text=body, revealFromEpisode=first[g], episodes=episodes))
    for key in entity_order:
        d = entities[key]
        name = _title(d['names'], text)
        cards.append(Card(id=entity_id[key], cardType=key[0], title=name, text=name, revealFromEpisode=d['first']))

    relations, when, seen, kinds = [], {}, set(), Counter()

    def add(rid: str, source: str, target: str, label: str, n: int, kind: str, category=None) -> None:
        if (source, target, label) not in seen:
            seen.add((source, target, label))
            relations.append(Relation(id=rid, source=source, target=target, label=label, category=category, direction='directed'))
            when[rid] = n
            kinds[kind] += 1

    events_meta = {}
    for r in records:
        n = r['episode']
        for i, e in enumerate(r['events'], 1):
            eid = event_id(n, i)
            cards.append(Card(id=eid, cardType='event', title=e['title'], text=plain(e['detail']), revealFromEpisode=n))
            meta = events_meta[eid] = {'episode': n, 'title': e['title'], 'quote': e['quote'], 'experienced': {}, 'heard': {}, 'mentioned': []}
            for m in e['mentions']:
                if m['kind'] != 'character':
                    xid = entity_id[m['kind'], _base(m['name'])]
                    add(f'a-{eid}-{xid}', xid, eid, '관련', n, '관련')
                    continue
                cid = card_of[n, m['name']]
                if m['role'] == 'mentioned':
                    meta['mentioned'].append(cid)   # 이름만 나온 인물은 그 사건을 모른다: 관계를 만들지 않는다
                else:
                    label, key = ('겪음', 'experienced') if m['role'] == 'experienced' else ('들음', 'heard')
                    meta[key][cid] = n
                    add(f'{key[0]}-{eid}-{cid}', cid, eid, label, n, label)
        for i, x in enumerate(r['relations'], 1):
            source, target = card_of[n, x['source']], card_of[n, x['target']]
            if source != target:
                add(f'r{n:02d}-{i}', source, target, x['label'], n, '인물 관계')
    for (eid, cid), n in later.items():
        events_meta[eid]['heard'][cid] = n
        add(f'h-{eid}-{cid}', cid, eid, '들음', n, '들음')
    identity_out = []
    for k, link in enumerate(sorted(identity, key=lambda l: (l['episode'], l['alias'], l['main'])), 1):
        source, target = char_id[link['alias']], char_id[link['main']]
        add(f'i{k:02d}', source, target, '동일 인물', link['episode'], '동일 인물', category='identity')
        identity_out.append({'source': source, 'target': target, 'episode': link['episode'], 'quote': link['quote']})
    character_id: dict[str, str] = {}
    for g in order:
        for name in sorted(names[g], key=lambda n: (n != title[g], n)):
            character_id.setdefault(name, char_id[g])   # 동명이인의 같은 이름은 먼저 생긴 카드로 이어진다
    world = {'series': wid, 'cards': cards, 'relations': relations, 'when': when, 'character_id': character_id, 'title': {c.id: c.title for c in cards},
             'events': events_meta, 'aliases': {char_id[g]: sorted(names[g] - {title[g]}) for g in order if names[g] - {title[g]}}, 'identity': identity_out,
             'entity_names': {entity_id[k]: sorted(entities[k]['names']) for k in entity_order}}   # 비인물 카드의 원문 표기(이름·호칭 변형): ⑦이 원문에서 이름을 글자 그대로 찾는다
    merge.update(character_names=len({people[r][2] for r in people}), character_cards=len(order))
    return world, {'cards': dict(Counter(c.cardType for c in cards)), 'relations': dict(kinds), 'merge': dict(merge)}


# ---- ⑦ 카드 다듬기(순수 함수) ----

@lru_cache(maxsize=256)
def _folded(text: str) -> tuple[tuple[str, str], ...]:
    """회차 원문의 문장들 (문장, 공백 없이 접은 글). 카드마다 되풀이해 찾으므로 한 번만 가른다."""
    return tuple((s, squash(s)) for s in (part.strip() for part in SPLIT.split(text)) if s)


def _cut(sentence: str, size: int) -> str:
    return sentence if len(sentence) <= size else sentence[:size] + '…'


def mention_blocks(text: str, names: list[str], cap: int = SPOT_MAX, cut: int = SPOT_CUT) -> list[str]:
    """회차 원문에서 names 중 하나가 글자 그대로(공백 차이 무시, MIN_NAME자 이상인 이름만) 나온 문장과 그 앞뒤 한 문장을 모은다. 맞닿거나 겹치는 곳은 하나로 잇는다.
    곳(이름이 나온 문장)이 cap보다 많으면 글 전체에 고르게 퍼뜨려 cap곳만 고르고, 문장 하나가 cut자보다 길면 자른다('…'). 한 덩어리는 문장들을 공백으로 이은 글이다."""
    sentences = _folded(text)
    keys = [k for k in (squash(n) for n in names) if len(k) >= MIN_NAME]
    hits = [i for i, (_, folded) in enumerate(sentences) if any(k in folded for k in keys)]
    if len(hits) > cap:
        hits = [hits[k * len(hits) // cap] for k in range(cap)]
    spans: list[list[int]] = []
    for i in hits:
        lo, hi = max(0, i - 1), min(len(sentences) - 1, i + 1)
        if spans and lo <= spans[-1][1] + 1:
            spans[-1][1] = max(spans[-1][1], hi)
        else:
            spans.append([lo, hi])
    return [' '.join(_cut(s, cut) for s, _ in sentences[lo:hi + 1]) for lo, hi in spans]


def entity_materials(world: dict, texts: dict[int, str]) -> dict[str, dict]:
    """인물이 아닌 카드(장소·조직·능력·사물·규칙·이름 붙은 사건)마다 모델이 볼 원문 자료: {카드 id: {'first': 처음 나온 회차, 'names': 이름들, 'events': [사건 글], 'episodes': {회차: {'spots': [원문 덩어리], 'quotes': [사건 인용]}}}}.

    처음 나온 회차 = 카드의 공개 회차(그 카드가 '관련'으로 이어진 가장 이른 사건의 회차)이고 그 앞 회차의 글은 쓰지 않는다. events = 그 처음 나온 회차의 관련 사건 제목·설명(본문 검사용, 모델에 주지 않는다). 회차마다 spots = 카드 이름(합쳐진 호칭 포함)이 글자 그대로 나온 문장과 앞뒤 문장(mention_blocks),
    quotes = 그 카드가 '관련'으로 이어진 그 회차 사건의 인용 가운데 spots 안에 없는 것(verify_events가 원문과 대조한 인용). 둘 다 비면 그 회차는 없다."""
    cards = {c.id: c for c in world['cards']}
    related: dict[str, set[tuple[int, int, str]]] = {}
    for r in world['relations']:
        if r.label == '관련' and r.target in world['events'] and cards[r.source].cardType != 'character':
            related.setdefault(r.source, set()).add((world['events'][r.target]['episode'], int(r.target.rpartition('-')[2]), r.target))
    out = {}
    for xid, items in related.items():
        ordered = sorted(items)
        first = ordered[0][0]
        names = sorted(world.get('entity_names', {}).get(xid) or [cards[xid].title])
        episodes = {}
        for n in sorted({*texts, *(m for m, _, _ in ordered)}):
            if n < first:
                continue
            spots = mention_blocks(texts.get(n, ''), names)
            folded = [squash(s) for s in spots]
            quotes = [q for q in dict.fromkeys(world['events'][eid]['quote'] for m, _, eid in ordered if m == n) if not any(squash(q) in s for s in folded)]
            if spots or quotes:
                episodes[n] = {'spots': spots, 'quotes': quotes}
        out[xid] = {'first': first, 'names': names, 'events': [f"{world['events'][eid]['title']} {cards[eid].text}" for m, _, eid in ordered if m == first], 'episodes': episodes}
    return out


def describe_batches(material: dict, chars: int = BATCH_CHARS, limit: int = BATCH_EPISODES) -> list[list[int]]:
    """호출 하나가 볼 회차 묶음들: 회차 순서대로 입력 글자 수가 chars를 넘거나 회차가 limit개를 넘기 전까지 한 묶음(한 회차는 넘쳐도 한 묶음에 든다). 처음 나온 회차는 첫 묶음에 든다."""
    batches: list[list[int]] = []
    size = 0
    for n, episode in sorted(material['episodes'].items()):
        length = sum(len(s) for s in episode['spots'] + episode['quotes'])
        if not batches or size + length > chars or len(batches[-1]) >= limit:
            batches.append([])
            size = 0
        batches[-1].append(n)
        size += length
    return batches


def describe_input(card: Card, material: dict, batch: list[int]) -> str:
    """⑦(A) 호출 입력: 카드 종류·이름·처음 나온 회차, 이번 호출이 본문을 쓰는지, 묶음의 회차별 원문 덩어리와 사건 인용."""
    first = material['first'] in batch
    lines = [f"[카드] {KIND_LABEL.get(card.cardType, card.cardType)} · {card.title}", f"[처음 나온 회차] {material['first']}화",
             '[이번 호출] ' + ('처음 나온 회차를 포함한다: body와 cells를 쓴다.' if first else '뒤 회차 묶음이다: body는 비우고 cells만 쓴다.')]
    for n in batch:
        episode = material['episodes'][n]
        lines += ['', f"[{n}화 자료]" + (' (처음 나온 회차)' if n == material['first'] else '')]
        lines += [f'- 원문: {s}' for s in episode['spots']] + [f'- 사건 인용: {q}' for q in episode['quotes']]
    return '\n'.join(lines)


def _backed(sentences: list, allowed: list[str], stats: Counter, title: str = '') -> list[tuple[str, object]]:
    """근거 대조: 문장마다 quote가 allowed(입력 인용들)의 어느 하나에 글자 그대로(공백 없이 접어, MIN_QUOTE자 이상) 들어 있어야 한다. 없다는 말만 하는 문장·이름만 되풀이한 문장도 뺀다.
    버린 문장은 코드별로 센다. 남은 문장은 (다듬은 글, 원래 문장)이다."""
    pool = [squash(q) for q in allowed]
    kept = []
    for s in sentences:
        stats['proposed'] += 1
        text, quote = _flat(s.text), squash(s.quote)
        if not text:
            stats['blank'] += 1
        elif len(quote) < MIN_QUOTE or not any(quote in q for q in pool):
            stats['quote'] += 1
        elif NEGATION.search(text):
            stats['negation'] += 1
        elif title and squash(text).rstrip('.') == squash(title):
            stats['trivial'] += 1
        else:
            kept.append((text, s))
    return kept


def _shares_event(text: str, own: list[str], events: list[str]) -> bool:
    """문장이 사건 글(처음 나온 회차의 관련 사건 제목·설명)과 카드 자신의 이름을 뺀 뒤에도 EVENT_OVERLAP자 이상 이어서 같은가(사건에서 온 사실이 정의로 둔갑한 문장). 이름 자리는 구분자로 바꿔 이어붙이지 않는다."""
    keys = sorted({squash(n) for n in own if n}, key=len, reverse=True)

    def grams(s: str) -> set[str]:
        folded = squash(s)
        for key in keys:
            folded = folded.replace(key, '|')
        return {g for g in (folded[i:i + EVENT_OVERLAP] for i in range(len(folded) - EVENT_OVERLAP + 1)) if '|' not in g}

    mine = grams(text)
    return any(mine & grams(e) for e in events)


def verify_described(out: Described, material: dict, batch: list[int], title: str = '', names: tuple[str, ...] = ()) -> tuple[dict, Counter]:
    """⑦(A) 호출 하나(회차 묶음 batch)의 출력 재검증. 문장마다 근거 인용(quote)이 그 문장의 회차에 모아 보여 준 자료(원문 덩어리·사건 인용) 안에 글자 그대로(공백 없이 접어, MIN_QUOTE자 이상) 있어야 한다 —
    본문은 처음 나온 회차 자료, 회차 칸은 그 회차 자료. 없다는 말만 하는 문장·이름만 되풀이한 문장도 뺀다.
    본문은 글에 대한 말(META)·과거 동작으로 끝나는 문장(PAST)·인물 이름(names)이 든 문장·처음 나온 회차의 관련 사건 글과 카드 자신의 이름을 뺀 뒤에도 EVENT_OVERLAP자 이상 같은 문장(event)이 아닌 것만이다
    (누가 한 일·사건에서 온 사실이 '정의'로 둔갑해 그 사건을 모르는 인물에게 보이는 일을 막는다) — 나머지는 버리지 않고 처음 나온 회차의 회차 칸(작가용, 인물에게 안 보인다) 앞에 옮긴다. 처음 나온 회차가 이 묶음에 없으면 본문은 받지 않고, 묶음에 없는 회차의 칸은 버린다.
    본문 DEFINE_MAX·칸 CELL_MAX문장을 넘는 문장은 버린다. 돌려주는 것: {'body': [글], 'cells': {회차: [글]}, 'quotes': {회차: [근거 인용, 칸의 글과 같은 순서]}}와 통계."""
    stats: Counter = Counter()
    first = material['first']
    pool = {n: material['episodes'][n]['spots'] + material['episodes'][n]['quotes'] for n in batch}
    body: list[str] = []
    moved: list[str] = []
    moved_quotes: list[str] = []
    if first in batch:
        for text, s in _backed(out.body, pool[first], stats, title):
            ban = (next((code for code, pattern in (('meta', META), ('past', PAST)) if pattern.search(text)), None) or ('name' if any(n in text.replace(title, '') for n in names) else None)
                   or ('event' if _shares_event(text, [title, *material['names']], material.get('events', [])) else None))
            if ban:
                moved.append(text)
                moved_quotes.append(_flat(s.quote))
                stats['moved_' + ban] += 1
            else:
                body.append(text)
        stats['extra'] += max(0, len(body) - DEFINE_MAX)
        body = body[:DEFINE_MAX]
    else:
        stats['proposed'] += len(out.body)
        stats['body_ignored'] += len(out.body)
    cells: dict[int, list[str]] = {}
    quotes: dict[int, list[str]] = {}
    for c in out.cells:
        if c.episode not in pool:
            stats['proposed'] += len(c.sentences)
            stats['episode'] += len(c.sentences)
            continue
        for text, s in _backed(c.sentences, pool[c.episode], stats, title):
            cells.setdefault(c.episode, []).append(text)
            quotes.setdefault(c.episode, []).append(_flat(s.quote))
    if moved:
        cells[first] = moved + cells.get(first, [])
        quotes[first] = moved_quotes + quotes.get(first, [])
    for n in cells:
        stats['extra'] += max(0, len(cells[n]) - CELL_MAX)
        cells[n], quotes[n] = cells[n][:CELL_MAX], quotes[n][:CELL_MAX]
    stats['kept'] += len(body) + sum(len(sentences) for sentences in cells.values())
    return {'body': body, 'cells': cells, 'quotes': quotes}, stats


def join_described(parts: list[dict]) -> tuple[dict, Counter]:
    """한 카드의 묶음별 결과(verify_described의 첫째 값, 회차 순서)를 합친다: 본문은 첫 묶음 것(정의는 처음 나온 회차 묶음에서만 나온다), 회차 칸은 회차 순서대로.
    앞 문장(본문·앞 회차 칸)과 3글자 조각이 REPEAT 이상 같은 문장은 되풀이라 버리고(repeat) 통과 수(kept)에서 뺀다. 비게 된 칸은 없앤다."""
    stats: Counter = Counter()
    body = parts[0]['body']
    seen: set[str] = set().union(*(_grams(t) for t in body)) if body else set()
    cells: dict[int, list[str]] = {}
    quotes: dict[int, list[str]] = {}
    pairs: dict[int, list[tuple[str, str]]] = {}
    for part in parts:
        for n, sentences in part['cells'].items():
            pairs.setdefault(n, []).extend(zip(sentences, part['quotes'][n]))
    for n in sorted(pairs):
        for text, quote in pairs[n]:
            grams = _grams(text)
            if grams and len(grams & seen) / len(grams) >= REPEAT:
                stats['repeat'] += 1
                stats['kept'] -= 1
                continue
            seen |= grams
            cells.setdefault(n, []).append(text)
            quotes.setdefault(n, []).append(quote)
    return {'body': body, 'cells': cells, 'quotes': quotes}, stats


def summary_materials(world: dict, limit: int = SUMMARY_MIN_CHARS) -> dict[str, dict]:
    """⑦(B) 작가용 종합 소개의 대상: 회차 칸이 있는 인물 카드 중 합쳐진 이름(aliases)이 있거나 전체 글자 수(본문 + 모든 회차 칸)가 limit자를 넘는 카드.
    {카드 id: {'aliases': 합쳐진 다른 호칭, 'episodes': {회차: 칸}}}."""
    return {c.id: {'aliases': world['aliases'].get(c.id, []), 'episodes': dict(sorted(c.episodes.items()))} for c in world['cards']
            if c.cardType == 'character' and c.episodes and (c.id in world['aliases'] or len(c.text) + sum(len(t) for t in c.episodes.values()) > limit)}


def _clip(text: str, limit: int) -> str:
    """줄 단위로 limit자까지만(첫 줄은 늘 남긴다)."""
    kept, size = [], 0
    for line in text.split('\n'):
        if kept and size + len(line) > limit:
            break
        kept.append(line)
        size += len(line) + 1
    return '\n'.join(kept)


def summary_input(card: Card, material: dict, cap: int = SUMMARY_INPUT) -> str:
    """⑦(B) 호출 입력: 인물 이름·다른 호칭, 회차별 기억(전체가 cap자를 넘으면 칸마다 cap을 칸 수로 나눈 만큼(최소 600자)씩 줄 단위로 자른다)."""
    each = max(600, cap // max(1, len(material['episodes'])))
    lines = [f'[인물] {card.title}'] + ([f"[호칭] {', '.join(material['aliases'])}"] if material['aliases'] else [])
    for n, text in material['episodes'].items():
        lines += ['', f'[{n}화 기억]', _clip(text, each)]
    return '\n'.join(lines)


def verify_summary(out: Summarized, material: dict) -> tuple[str, Counter]:
    """⑦(B) 종합 소개 재검증: 문장마다 근거 회차 번호가 있어야 하고 모두 그 인물의 회차 칸이 실제로 있는 회차여야 한다(그 밖의 내용 대조는 하지 않는다). 없다는 말만 하는 문장도 뺀다. 상한 SUMMARY_MAX문장."""
    stats: Counter = Counter()
    kept = []
    for s in out.sentences:
        stats['summary_proposed'] += 1
        text = _flat(s.text)
        if not text:
            stats['summary_blank'] += 1
        elif not s.episodes or any(n not in material['episodes'] for n in s.episodes):
            stats['summary_episode'] += 1
        elif NEGATION.search(text):
            stats['summary_negation'] += 1
        else:
            kept.append(text)
    stats['summary_extra'] += max(0, len(kept) - SUMMARY_MAX)
    kept = kept[:SUMMARY_MAX]
    stats['summary_kept'] += len(kept)
    return ' '.join(kept), stats


def dedup_sections(episodes: dict[int, str]) -> tuple[dict[int, str], int]:
    """인물 회차 칸에서 앞 회차 칸과 글자 그대로 같은 [정체]·[성격]·[말투]·[목표] 줄을 뺀다(회차 순서 기준, 앞 칸이 남아 있어 그 인물의 기억은 줄지 않는다). 비게 된 칸은 없앤다. (칸들, 뺀 줄 수)."""
    seen: set[str] = set()
    kept, removed = {}, 0
    for n in sorted(episodes):
        lines = []
        for line in episodes[n].split('\n'):
            if line.startswith(REPEATABLE) and line in seen:
                removed += 1
                continue
            if line.startswith(REPEATABLE):
                seen.add(line)
            lines.append(line)
        if lines:
            kept[n] = '\n'.join(lines)
    return kept, removed


def long_sections(episodes: dict[int, str], limit: int = SECTION_LIMIT) -> list[int]:
    """limit자보다 긴 회차 칸의 회차 번호(오름차순)."""
    return sorted(n for n, text in episodes.items() if len(text) > limit)


def _grams(text: str) -> set[str]:
    folded = squash(text)
    return {folded[i:i + 3] for i in range(len(folded) - 2)}


def verify_section(original: str, out: Tightened) -> tuple[str | None, Counter]:
    """⑦(C) 긴 회차 칸 줄이기 재검증. 항목 표지가 없는 줄과 입력 칸에 없는 내용의 줄(3글자 조각의 GROUNDED 미만이 입력에 있음)은 버리고, 지워진 [겪은 일]·[들은 일] 줄(제목이 어느 줄에도 없음)은 원래 줄로 되살린다.
    모델 줄이 하나도 안 남거나 결과가 원래보다 짧지 않으면 None(원래 칸을 둔다)."""
    stats: Counter = Counter()
    pool, lines = _grams(original), []
    for line in (ln.strip() for ln in out.text.split('\n') if ln.strip() and not ECHO.match(ln.strip())):
        label = next((x for x in LABELS if line.startswith(x)), None)
        if label is None:
            stats['label'] += 1
        elif (grams := _grams(line[len(label):])) and len(grams & pool) / len(grams) < GROUNDED:
            stats['grounded'] += 1
        else:
            lines.append(line)
    if not lines:
        stats['empty'] += 1
        return None, stats
    for line in original.split('\n'):
        label = next((x for x in EVENT_LABELS if line.startswith(x)), None)
        if label and not any(kept.startswith(label) and line[len(label):].strip().partition(': ')[0] in kept for kept in lines):
            lines.append(line)
            stats['restored'] += 1
    text = '\n'.join(lines)
    if len(text) >= len(original):
        stats['longer'] += 1
        return None, stats
    return text, stats


def identity_materials(world: dict, records: list[dict]) -> dict[str, dict]:
    """⑦(C) 병합 인물의 소개 자료: 합쳐진 이름(aliases가 있는 카드) 중 카드의 첫 등장 회차에 합쳐진 이름이 둘 이상 나오는 카드만(하나뿐이면 현재 IDENTITY가 이미 그 회차의 한 사람 소개다).
    자료는 그 회차 것뿐이다: 이름별 소개·문서, 그 이름이 겪었거나 들은 사건(제목·설명·인용), 그 이름이 끝점인 관계, 말투 대사. 근거 인용(quotes)이 없으면 검증할 수 없어 뺀다.
    뒤 회차에 처음 나오는 호칭은 넣지 않는다(칭호 변화가 공개 회차에 새지 않게). {카드 id: {first, entries, events, relations, quotes}}."""
    by_episode = {r['episode']: r for r in records}
    cards = {c.id: c for c in world['cards']}
    out = {}
    for cid, aliases in world['aliases'].items():
        card = cards[cid]
        record = by_episode.get(card.revealFromEpisode)
        if card.cardType != 'character' or record is None:
            continue
        names = [n for n in sorted({card.title, *aliases}) if n in record['characters'] and world['character_id'].get(n) == cid]
        if len(names) < 2:
            continue
        events = [e for e in record['events'] if any(m['kind'] == 'character' and m['name'] in names and m['role'] in ('experienced', 'heard') for m in e['mentions'])]
        relations = [dict(r) for r in record['relations'] if r['source'] in names or r['target'] in names]
        entries = [{'name': n, 'intro': record['characters'][n]['intro'], 'doc': record['characters'][n]['doc']} for n in names]
        quotes = [e['quote'] for e in events] + [r['quote'] for r in relations] + [x['doc']['speech_quote'] for x in entries if x['doc'].get('speech_quote')]
        if quotes:
            out[cid] = {'first': card.revealFromEpisode, 'entries': entries, 'relations': relations, 'quotes': quotes,
                        'events': [{'title': e['title'], 'detail': plain(e['detail']), 'quote': e['quote']} for e in events]}
    return out


def identity_input(card: Card, material: dict) -> str:
    """⑦(C) 호출 입력: 합쳐진 이름들, 이름별 소개·문서 줄, 그 회차의 사건·관계와 인용."""
    lines = [f"[이름] {', '.join(e['name'] for e in material['entries'])}", f"[처음 나온 회차] {material['first']}화"]
    for e in material['entries']:
        lines += [f"[{e['name']}]" + (f" 소개: {e['intro']}" if e['intro'] else '')] + [f'  {line}' for line in doc_lines(e['doc'])]
    for e in material['events']:
        lines += [f"[사건] {e['title']} — {e['detail']}", f"  인용: {e['quote']}"]
    for r in material['relations']:
        lines += [f"[관계] {r['source']} → {r['target']} 「{r['label']}」", f"  인용: {r['quote']}"]
    return '\n'.join(lines)


def verify_identity(out: Introduced, material: dict) -> tuple[str, Counter]:
    """⑦(C) 소개 재검증: 문장마다 근거 인용이 입력 인용(사건·관계·말투 대사) 중 하나여야 한다. 상한 BODY_MAX문장, 하나도 안 남으면 빈 글."""
    stats: Counter = Counter()
    kept = []
    for text, _ in _backed(out.sentences, material['quotes'], stats):
        if META.search(text):
            stats['meta'] += 1
        else:
            kept.append(text)
    stats['extra'] += max(0, len(kept) - BODY_MAX)
    kept = kept[:BODY_MAX]
    stats['kept'] += len(kept)
    return ' '.join(kept), stats


def refine_plan(world: dict, records: list[dict], texts: dict[int, str], tighten: bool = False, summary_limit: int = SUMMARY_MIN_CHARS) -> dict:
    """⑦이 할 일: 'entity' = 비인물 카드 자료(+ batches = 호출 하나가 보는 회차 묶음들), 'summary' = 인물 종합 소개 자료(texts = 회차 번호 → 원문).
    tighten이면 직전 판의 인물 경로도 더한다: 'identity' = 병합 인물 소개 자료, 'sections' = 인물 카드별 {episodes: 중복 줄을 뺀 회차 칸, removed: 뺀 줄 수, long: 모델로 줄일 회차}."""
    entity = entity_materials(world, texts)
    for material in entity.values():
        material['batches'] = describe_batches(material)
    plan = {'entity': entity, 'summary': summary_materials(world, summary_limit), 'identity': {}, 'sections': {}}
    if tighten:
        for c in world['cards']:
            if c.cardType == 'character' and c.episodes:
                kept, removed = dedup_sections(c.episodes)
                plan['sections'][c.id] = {'episodes': kept, 'removed': removed, 'long': long_sections(kept)}
        plan['identity'] = identity_materials(world, records)
    return plan


def refine_tasks(plan: dict) -> list[tuple]:
    """호출 하나씩: ('card', 카드 id, 묶음 번호) · ('summary', 카드 id) · ('identity', 카드 id) · ('section', 카드 id, 회차)."""
    return ([('card', cid, k) for cid, m in plan['entity'].items() for k in range(len(m['batches']))] + [('summary', cid) for cid in plan['summary']]
            + [('identity', cid) for cid in plan['identity']] + [('section', cid, n) for cid, info in plan['sections'].items() for n in info['long']])


def settle(world: dict, plan: dict, outs: dict) -> tuple[dict, Counter]:
    """모델 출력(outs: 호출 → 출력, 실패하거나 없으면 None)을 재검증해 카드 갱신 {카드 id: {'text', 'episodes', 'quotes'(칸 문장의 근거 인용), 'summary'(종합 소개)}}과 통계를 만든다. 실패한 호출은 원래 카드를 그대로 두고 센다."""
    stats: Counter = Counter()
    updates: dict[str, dict] = {}
    titles = {c.id: c.title for c in world['cards']}
    names = tuple(n for n in world['character_id'] if len(n) >= 2)   # 인물 카드의 이름·별칭: 본문에 인물 이름이 든 문장은 그 인물이 한 일의 흔적이라 회차 칸으로 보낸다
    for cid, material in plan['entity'].items():
        parts = []
        for k, batch in enumerate(material['batches']):
            out = outs.get(('card', cid, k))
            if out is None:
                stats['entity_failed'] += 1
                continue
            part, counted = verify_described(out, material, batch, titles[cid], names)
            stats.update(counted)
            parts.append(part)
        if not parts:
            continue
        got, counted = join_described(parts)
        stats.update(counted)
        update = {}
        if got['body']:
            update['text'] = ' '.join(got['body'])
            stats['entity_cards'] += 1
        else:
            stats['entity_empty'] += 1
        if got['cells']:
            update['episodes'] = {n: ' '.join(sentences) for n, sentences in sorted(got['cells'].items())}
            update['quotes'] = {n: got['quotes'][n] for n in sorted(got['cells'])}
            update['sentences'] = {n: got['cells'][n] for n in sorted(got['cells'])}
            stats['entity_notes'] += 1
            stats['entity_cells'] += len(got['cells'])
        if update:
            updates[cid] = update
    stats['merged_cards'] = len(world['aliases'].keys() & {c.id for c in world['cards'] if c.cardType == 'character'})
    for cid, material in plan['summary'].items():
        out = outs.get(('summary', cid))
        if out is None:
            stats['summary_failed'] += 1
            continue
        text, counted = verify_summary(out, material)
        stats.update(counted)
        if text:
            updates.setdefault(cid, {})['summary'] = text
            stats['summary_cards'] += 1
        else:
            stats['summary_empty'] += 1
    texts = {c.id: c.text for c in world['cards']}
    for cid, material in plan['identity'].items():
        out = outs.get(('identity', cid))
        if out is None:
            stats['identity_failed'] += 1
            continue
        text, counted = verify_identity(out, material)
        stats.update(counted)
        if not text:
            stats['identity_empty'] += 1
        elif len(text) < len(texts[cid]):   # 근거 인용이 달린 문장만 남은 소개가 지금 IDENTITY(문서의 정체 글)보다 짧으면 정보를 잃으므로 지금 것을 둔다
            stats['identity_shorter'] += 1
        else:
            updates.setdefault(cid, {})['text'] = text
            stats['identity_rewritten'] += 1
    for cid, info in plan['sections'].items():
        episodes, changed = dict(info['episodes']), bool(info['removed'])
        stats['dedup_lines'] += info['removed']
        for n in info['long']:
            out = outs.get(('section', cid, n))
            if out is None:
                stats['sections_failed'] += 1
                continue
            text, counted = verify_section(episodes[n], out)
            stats.update(counted)
            if text is None:
                stats['sections_kept'] += 1
                continue
            episodes[n], changed = text, True
            stats['sections_tightened'] += 1
        if changed:
            updates.setdefault(cid, {})['episodes'] = episodes
    return updates, stats


def apply_refine(world: dict, updates: dict[str, dict]) -> dict:
    """갱신({카드 id: {'text', 'episodes', 'quotes', 'sentences', 'summary'}})을 입힌 새 세계관: text·episodes는 카드에, 칸 문장(cell_sentences)과 그 근거 인용(cell_quotes, 같은 순서)·작가용 종합 소개(summary)는
    세계관의 평가용 덧붙임 칸에 {카드 id: …}로 둔다(NovelBrain은 읽지 않는다). 갱신에 없는 카드와 관계는 그대로, 원래 세계관은 바뀌지 않는다."""
    fields = ('text', 'episodes')
    cards = [c.model_copy(update={k: v for k, v in updates[c.id].items() if k in fields}) if c.id in updates else c for c in world['cards']]
    extra = {name: {cid: u[key] for cid, u in updates.items() if key in u} for name, key in (('summary', 'summary'), ('cell_quotes', 'quotes'), ('cell_sentences', 'sentences'))}
    return {**world, 'cards': cards, **{name: found for name, found in extra.items() if found}}


# ---- 통계 ----

def is_count(key: str) -> bool:
    """통계 칸이 버린 항목의 코드가 아니라 제안·통과 개수나 참고 수치인가."""
    return key.endswith(COUNT_SUFFIXES) or key in INFO


def summarize(records: list[dict]) -> dict:
    """회차 기록의 통계를 더한다: 회차 수·호출 수(단계별·합계)·영구 실패 수·버린 항목의 코드별 건수(dropped)와 제안·통과 건수(counts)."""
    total: Counter = Counter()
    calls = Counter({step: 0 for step in STEPS})
    failed = Counter({step: 0 for step in calls})
    for r in records:
        total.update(r['stats'])
        calls.update(r['calls'])
        failed.update({step: int(value) for step, value in r['failed'].items()})
    return {'episodes': len(records), 'calls': dict(calls), 'calls_total': sum(calls.values()), 'failed': dict(failed),
            'dropped': {k: v for k, v in sorted(total.items()) if not is_count(k)}, 'counts': {k: v for k, v in sorted(total.items()) if is_count(k)}}


def total_stats(per_work: dict[str, dict]) -> dict:
    """작품별 통계(finish가 만든 모양)를 더해 전체 통계로: 숫자 칸은 더하고 중첩된 칸은 칸마다 더한다(어느 한쪽에만 있는 칸도 남긴다)."""
    def add(a: dict, b: dict) -> dict:
        out = {}
        for k in a.keys() | b.keys():
            x, y = a.get(k, 0), b.get(k, 0)
            out[k] = add(x if isinstance(x, dict) else {}, y if isinstance(y, dict) else {}) if isinstance(x, dict) or isinstance(y, dict) else x + y
        return out

    total: dict = {}
    for stats in per_work.values():
        total = add(total, stats)
    return {'works': len(per_work), **total}


# ---- 실행(모델 호출) ----

def people_lines(people: dict[str, str]) -> str:
    return '\n'.join(f'- {name}: {intro}' if intro else f'- {name}' for name, intro in people.items())


def doc_input(name: str, intro: str, text: str) -> str:
    return f'인물: {name}\n소개: {intro}\n\n[본문]\n{text}'


def events_input(people: dict[str, str], text: str) -> str:
    return f'[이 회차의 인물]\n{people_lines(people)}\n\n[본문]\n{text}'


def presence_input(people: dict[str, str], events: list[dict], text: str) -> str:
    lines = '\n'.join(f"{i}. {e['title']}: {plain(e['detail'])}" for i, e in enumerate(events, 1))
    return f'[이 회차의 인물]\n{people_lines(people)}\n\n[이 회차의 사건]\n{lines}\n\n[본문]\n{text}'


def learn_input(earlier: list[dict], people: dict[str, str], text: str) -> str:
    lines = '\n'.join(f"{e['id']} ({e['episode']}화) {e['title']}: {e['detail']}" for e in earlier)
    return f'[앞 회차의 사건]\n{lines}\n\n[이 회차의 인물]\n{people_lines(people)}\n\n[본문]\n{text}'


def rels_input(people: dict[str, str], events: list[dict], text: str) -> str:
    lines = '\n'.join(f"- {e['title']}: {plain(e['detail'])}" for e in events)
    return f'[이 회차의 인물]\n{people_lines(people)}\n\n[이 회차의 사건]\n{lines}\n\n[본문]\n{text}'


def extractor(works: dict):
    """run_rounds용 work(task, llm). task = (작품 id, 회차 번호). 라운드 1 = 인물, 2 = 인물 문서(인물마다)와 사건(둘은 서로 독립), 3 = 인물 사이 관계(사건이 입력)."""
    texts = {wid: {e['number']: e['text'] for e in work['episodes']} for wid, work in works.items()}

    def work(task, llm):
        wid, n = task
        text = texts[wid][n]
        step = Round()
        chars, chars_failed = step.get(lambda: llm.ask('chars', CHARS_INSTRUCTIONS, text, schema=Persons, max_output_tokens=limit('chars', CHARS_TOKENS)))
        step.done()
        people, stats = verify_people(text, chars) if chars else ({}, Counter())
        events_out, events_failed = step.get(lambda: llm.ask('events', EVENTS_INSTRUCTIONS, events_input(people, text), schema=Events,
                                                             max_output_tokens=limit('events', EVENTS_TOKENS))) if people else (None, False)
        docs = {name: step.get(lambda name=name, intro=intro: llm.ask('doc', DOC_INSTRUCTIONS, doc_input(name, intro, text), schema=CharDoc, max_output_tokens=limit('doc', DOC_TOKENS)))
                for name, intro in people.items()}   # 문서는 인물 목록의 모두에게 부른다(사건에 안 이어진 인물도 그 회차에 한 일이 있으면 행적에 남는다), 사건과 서로 독립이라 같은 라운드
        step.done()
        events, events_stats = verify_events(text, events_out, people) if events_out else ([], Counter())
        stats.update(events_stats)
        rels_out, rels_failed = step.get(lambda: llm.ask('rels', RELS_INSTRUCTIONS, rels_input(people, events, text), schema=Rels,
                                                         max_output_tokens=limit('rels', RELS_TOKENS))) if people else (None, False)
        presence_out, presence_failed = step.get(lambda: llm.ask('presence', PRESENCE_INSTRUCTIONS, presence_input(people, events, text), schema=Presences,
                                                                 max_output_tokens=limit('presence', PRESENCE_TOKENS))) if events else (None, False)
        step.done()
        relations, rels_stats = verify_relations(text, rels_out, people) if rels_out else ([], Counter())
        stats.update(rels_stats)
        if presence_out:
            links, presence_stats = verify_presence(presence_out, people, len(events))
            events, applied = apply_presence(events, links, text, PRESENCE_WINDOW)
            stats.update(presence_stats)
            stats.update(applied)
        characters = {}
        for name, intro in people.items():
            out, _ = docs.get(name, (None, False))
            doc, doc_stats = verify_doc(text, out) if out else ({}, Counter())
            stats.update(doc_stats)
            characters[name] = {'intro': intro, 'doc': doc}
        return {'work': wid, 'episode': n, 'characters': characters, 'events': events, 'relations': relations, 'stats': dict(stats),
                'calls': {'chars': 1, 'doc': len(docs), 'events': int(bool(people)), 'presence': int(bool(events)), 'rels': int(bool(people))},
                'failed': {'chars': chars_failed, 'doc': sum(failed for _, failed in docs.values()), 'events': events_failed, 'presence': presence_failed, 'rels': rels_failed}}
    return work


def learner(works: dict, records_by_work: dict[str, list[dict]]):
    """run_rounds용 work(task, llm). task = (작품 id, 회차 번호): 앞 회차 사건 목록과 이 회차 본문으로 앞 회차 사건을 이 회차에서 처음 전해 듣는 인물을 묻는다(앞 회차 사건이나 인물이 없으면 부르지 않는다)."""
    texts = {wid: {e['number']: e['text'] for e in work['episodes']} for wid, work in works.items()}

    def work(task, llm):
        wid, n = task
        mine = next(r for r in records_by_work[wid] if r['episode'] == n)
        people = {name: info['intro'] for name, info in mine['characters'].items()}
        earlier = earlier_events([r for r in records_by_work[wid] if r['episode'] < n])
        if not people or not earlier:
            return {'work': wid, 'episode': n, 'learned': [], 'stats': {}, 'called': False, 'failed': False}
        text = texts[wid][n]
        step = Round()
        out, failed = step.get(lambda: llm.ask('learn', LEARN_INSTRUCTIONS, learn_input(earlier, people, text), schema=Learned, max_output_tokens=limit('learn', LEARN_TOKENS)))
        step.done()
        learned, stats = verify_learned(text, out, earlier, people, n) if out else ([], Counter())
        return {'work': wid, 'episode': n, 'learned': learned, 'stats': dict(stats), 'called': True, 'failed': failed}
    return work


def merger(records_by_work: dict[str, list[dict]], texts: dict[str, dict[int, str]] | None = None):
    """run_rounds용 work(wid, llm): 작품당 한 번 합치기 호출(인물이 둘 미만이면 부르지 않는다). texts(작품 id → 회차 번호 → 본문)를 주면 후보 쌍과 증거 문장도 입력에 넣는다. 검증된 링크·통계·실패·모델 원출력을 돌려준다."""
    def work(wid, llm):
        people, data, quotes = merge_input(records_by_work[wid], texts[wid] if texts else None)
        if len(people) < 2:
            return {'links': [], 'stats': {}, 'failed': False, 'called': False, 'raw': None}
        step = Round()
        out, failed = step.get(lambda: llm.ask('merge', MERGE_INSTRUCTIONS, json.dumps(data, ensure_ascii=False), schema=Links, max_output_tokens=limit('merge', MERGE_TOKENS)))
        step.done()
        links, stats = verify_links(out, people, quotes)
        return {'links': links, 'stats': dict(stats), 'failed': failed, 'called': True, 'raw': out.model_dump() if out else None}
    return work


def refiner(worlds: dict[str, dict], plans: dict[str, dict]):
    """run_rounds용 work(task, llm). task = (작품 id, 'card'|'summary'|'identity'|'section', 카드 id[, 묶음 번호·회차]): 카드 하나의 회차 묶음 하나(또는 인물 종합 소개·병합 인물 소개·긴 회차 칸 하나)의 호출. 서로 독립이라 한 라운드."""
    cards = {wid: {c.id: c for c in world['cards']} for wid, world in worlds.items()}

    def work(task, llm):
        wid, kind, cid, *rest = task
        card, plan = cards[wid][cid], plans[wid]
        step = Round()
        if kind == 'card':
            material = plan['entity'][cid]
            out, failed = step.get(lambda: llm.ask('refine_card', REFINE_CARD_INSTRUCTIONS, describe_input(card, material, material['batches'][rest[0]]), schema=Described,
                                                   max_output_tokens=limit('refine_card', CARD_TOKENS)))
        elif kind == 'summary':
            out, failed = step.get(lambda: llm.ask('refine_summary', REFINE_SUMMARY_INSTRUCTIONS, summary_input(card, plan['summary'][cid]), schema=Summarized,
                                                   max_output_tokens=limit('refine_summary', SUMMARY_TOKENS)))
        elif kind == 'identity':
            out, failed = step.get(lambda: llm.ask('refine_identity', REFINE_IDENTITY_INSTRUCTIONS, identity_input(card, plan['identity'][cid]), schema=Introduced,
                                                   max_output_tokens=limit('refine_identity', IDENTITY_TOKENS)))
        else:
            text = f"[인물] {card.title}\n[{rest[0]}화 기억]\n{plan['sections'][cid]['episodes'][rest[0]]}\n\n[목표 길이] {SECTION_LIMIT:,}자 이하"
            out, failed = step.get(lambda: llm.ask('refine_section', REFINE_SECTION_INSTRUCTIONS, text, schema=Tightened, max_output_tokens=limit('refine_section', SECTION_TOKENS)))
        step.done()
        return {'out': out, 'failed': failed}
    return work


def refine_works(works: dict, records: list[dict], merged: dict[str, dict], learned: dict[str, dict] | None, llm, executor, tighten: bool = False) -> dict[str, dict]:
    """⑦ 카드 다듬기: 작품마다 기존 기록(회차 기록·합치기·들음)으로 기본 세계관을 조립하고(호출 없음) 모든 작품의 다듬기 호출을 한 라운드로 낸 뒤 재검증한다(tighten이면 직전 판의 인물 경로도).
    {작품 id: {'updates': 카드 갱신, 'stats': 검증 통계, 'calls': 종류별 호출 수, 'failed': 종류별 실패 수, 'raw': 모델 원출력}}."""
    worlds, plans = {}, {}
    for wid, work in works.items():
        mine = sorted((r for r in records if r['work'] == wid), key=lambda r: r['episode'])
        worlds[wid] = build_world2(wid, mine, merged[wid]['links'], '\n'.join(e['text'] for e in work['episodes']), ((learned or {}).get(wid) or {'items': []})['items'])[0]
        plans[wid] = refine_plan(worlds[wid], mine, {e['number']: e['text'] for e in work['episodes']}, tighten)
    tasks = [(wid, *task) for wid, plan in plans.items() for task in refine_tasks(plan)]
    done = run_rounds(tasks, refiner(worlds, plans), llm, executor) if tasks else []
    outs: dict[str, dict] = {wid: {} for wid in works}
    calls: dict[str, Counter] = {wid: Counter() for wid in works}
    failed: dict[str, Counter] = {wid: Counter() for wid in works}
    raw: dict[str, dict] = {wid: {} for wid in works}
    for task, result in zip(tasks, done):
        wid, kind, key = task[0], task[1], task[2:]
        outs[wid][(kind, *key)] = result['out']
        calls[wid][kind] += 1
        failed[wid][kind] += int(result['failed'])
        raw[wid][':'.join(map(str, (kind, *key)))] = result['out'].model_dump() if result['out'] else None
    result = {}
    for wid in works:
        updates, stats = settle(worlds[wid], plans[wid], outs[wid])
        result[wid] = {'updates': updates, 'stats': dict(sorted(stats.items())), 'calls': dict(calls[wid]), 'failed': dict(failed[wid]), 'raw': raw[wid]}
    return result


def finish(works: dict, records: list[dict], merged: dict[str, dict], name: str, root: Path, total_path: Path, learned: dict[str, dict] | None = None,
           refined: dict[str, dict] | None = None) -> dict[str, dict]:
    """작품마다 회차별 기록·합치기 결과·들음 결과(learned = 작품 id → {items, calls, failed, stats})·세계관·통계를 root/<작품 id>/ 아래에 쓰고(통계는 전체 합계를 total_path에도), 작품별 통계를 돌려준다.
    refined(refine_works의 결과)를 주면 세계관에 ⑦ 다듬기를 입히고 refine.json(갱신·원출력)·통계의 refine 칸을 더한다."""
    per_work = {}
    for wid, work in works.items():
        mine = sorted((r for r in records if r['work'] == wid), key=lambda r: r['episode'])
        folder = root / wid / name
        (folder / 'episodes').mkdir(parents=True, exist_ok=True)
        for r in mine:
            (folder / 'episodes' / f"{r['episode']:02d}.json").write_text(json.dumps(r, ensure_ascii=False))
        done = merged[wid]
        learn = (learned or {}).get(wid, {'items': [], 'calls': 0, 'failed': 0, 'stats': {}})
        (folder / 'merge.json').write_text(json.dumps({k: done[k] for k in ('raw', 'links', 'stats', 'failed', 'called')}, ensure_ascii=False))
        if learned is not None:
            (folder / 'learned.json').write_text(json.dumps(learn, ensure_ascii=False))
        world, built = build_world2(wid, mine, done['links'], '\n'.join(e['text'] for e in work['episodes']), learn['items'])
        refine = (refined or {}).get(wid)
        if refine is not None:
            world = apply_refine(world, refine['updates'])
            (folder / 'refine.json').write_text(json.dumps(refine, ensure_ascii=False))
        save_world(root / wid / f'{name}.json', world)
        summary = summarize(mine)
        per_work[wid] = {**summary, 'cards': built['cards'], 'relations': built['relations'],
                         'merge': {**built['merge'], 'called': int(done['called']), 'failed': int(done['failed']), 'links_kept': len(done['links'])},
                         'merge_dropped': done['stats'], 'learn': {'calls': learn['calls'], 'failed': learn['failed'], 'kept': len(learn['items'])},
                         'learn_dropped': {k: v for k, v in sorted(learn['stats'].items()) if not is_count(k)},
                         'calls_all': summary['calls_total'] + int(done['called']) + learn['calls'] + (sum(refine['calls'].values()) if refine else 0),   # 회차별 호출 + 합치기 + 들음 + 다듬기
                         **({'refine': {'calls': refine['calls'], 'failed': refine['failed'], 'stats': refine['stats']}} if refine else {})}
        (root / wid / f'{name}_stats.json').write_text(json.dumps(per_work[wid], ensure_ascii=False, indent=2, sort_keys=True))
    total_path.write_text(json.dumps({'works': per_work, 'total': total_stats(per_work)}, ensure_ascii=False, indent=2, sort_keys=True))
    return per_work


def setup(gen_model: str, gen_effort: str | None, name: str, limit_usd: float, step_llms: tuple[str, ...]):
    """결과 이름·단계별 모델·강도로 Llm과 실행기를 만든다(run·refine 공용). 상한이 없거나 단가표 밖의 모델이면 폴더·장부를 만들기 전에 멈춘다."""
    check_name(name)
    routes = parse_routes(list(step_llms))
    FACTORS.clear()
    FACTORS.update({kind: FACTOR[(routes[kind][1] if kind in routes else gen_effort) or 'low'] for kind in KINDS})   # 호출 종류마다 그 호출의 강도에 맞춰 출력 한도를 늘린다
    llm = make_gen_llm(gen_model, name, limit_usd, gen_effort)
    route(llm, {kind: make_gen_llm(model, name, limit_usd, effort) for kind, (model, effort) in routes.items()})
    return llm, make_executor(llm, 'sync')


def run(ids: list[str], *, gen_model: str, gen_effort: str | None, name: str, limit_usd: float, step_llms: tuple[str, ...] = (), refine: bool = True, tighten: bool = False) -> None:
    """고른 작품(없으면 전부)의 회차마다 ①~④를 돌리고(회차끼리 병렬) 작품마다 합치고 ⑦ 카드 다듬기(refine=False면 건너뜀)까지 한 뒤 세계관·통계를 쓴다. 응답 캐시 KT/cache-<name>·장부 KT/cost-<name>.jsonl, 금액 상한 필수."""
    llm, executor = setup(gen_model, gen_effort, name, limit_usd, step_llms)
    works = load_works(ids or None)
    tasks = [(wid, e['number']) for wid, work in works.items() for e in work['episodes']]
    print(f"작품 {len(works)}편 · 회차 {len(tasks)}개 · 응답 {llm.model} · 장부 $" f"{llm.cost.spent():.3f}", flush=True)
    started = time.time()
    records = run_rounds(tasks, extractor(works), llm, executor)
    by_work = {wid: sorted((r for r in records if r['work'] == wid), key=lambda r: r['episode']) for wid in works}
    texts = {wid: {e['number']: e['text'] for e in work['episodes']} for wid, work in works.items()}
    merge_work, learn_work = merger(by_work, texts), learner(works, by_work)
    final = [('merge', wid) for wid in works] + [('learn', wid, e['number']) for wid, work in works.items() for e in work['episodes'] if e['number'] > 1]   # 합치기와 들음은 서로 독립이라 한 패스
    done = run_rounds(final, lambda task, llm: merge_work(task[1], llm) if task[0] == 'merge' else learn_work(task[1:], llm), llm, executor)
    merged = {task[1]: result for task, result in zip(final, done) if task[0] == 'merge'}
    learned = {wid: {'items': [], 'calls': 0, 'failed': 0, 'stats': Counter()} for wid in works}
    for task, result in zip(final, done):
        if task[0] == 'learn':
            mine = learned[task[1]]
            mine['items'] += result['learned']
            mine['calls'] += int(result['called'])
            mine['failed'] += int(result['failed'])
            mine['stats'].update(result['stats'])
    refined = refine_works(works, records, merged, learned, llm, executor, tighten) if refine else None   # ⑦ 카드 다듬기: 합치기·들음 결과까지 나온 뒤 카드마다(카드끼리 병렬)
    per_work = finish(works, records, merged, name, KT / 'works', KT / f'{name}_stats.json', learned, refined)
    report(per_work, started, llm)


def report(per_work: dict[str, dict], started: float, llm) -> None:
    """작품마다 한 줄 요약(회차·호출·카드·관계·버림·합치기, 다듬기가 있으면 호출·통과 문장), 경과 시간, 장부."""
    for wid, stats in per_work.items():
        print(f"{wid} 회차 {stats['episodes']} · 호출 {stats['calls_all']}(실패 {sum(stats['failed'].values())}) · 카드 {stats['cards']} · 관계 {stats['relations']} · "
              f"버림 {sum(stats['dropped'].values())} · 합치기 {stats['merge']}", flush=True)
        if 'refine' in stats:
            counted = stats['refine']['stats']
            print(f"  다듬기 호출 {stats['refine']['calls']}(실패 {stats['refine']['failed']}) · 문장 통과 {counted.get('kept', 0)}/{counted.get('proposed', 0)} · "
                  f"본문 {counted.get('entity_cards', 0)}·회차 칸 카드 {counted.get('entity_notes', 0)}(칸 {counted.get('entity_cells', 0)}) · 종합 소개 {counted.get('summary_cards', 0)} · "
                  f"인물 소개 {counted.get('identity_rewritten', 0)} · 줄인 칸 {counted.get('sections_tightened', 0)}", flush=True)
    print(f'경과 {time.time() - started:.0f}초')
    cost_report(llm)


def refine_from(ids: list[str], *, base: str, gen_model: str, gen_effort: str | None, name: str, limit_usd: float, step_llms: tuple[str, ...] = (), refine: bool = True, tighten: bool = False) -> None:
    """앞 단계 결과(KT/works/<작품 id>/<base>/의 회차 기록·합치기·들음)는 그대로 읽고 ⑦ 카드 다듬기만 새로 부른다(앞 단계 호출 없음, 새 이름 name으로 따로 쓴다).
    refine=False면 같은 기록으로 기본 세계관만 다시 조립해 쓴다(전후 비교의 '전')."""
    if name == base:
        raise SystemExit('--name은 --from과 달라야 한다(앞 단계 결과를 덮어쓰지 않는다).')
    llm, executor = setup(gen_model, gen_effort, name, limit_usd, step_llms)
    works = load_works(ids or None)
    records, merged, learned = [], {}, {}
    for wid in works:
        folder = KT / 'works' / wid / base
        records += [json.loads(p.read_text()) for p in sorted((folder / 'episodes').glob('*.json'))]
        merged[wid] = json.loads((folder / 'merge.json').read_text())
        learned[wid] = json.loads((folder / 'learned.json').read_text()) if (folder / 'learned.json').exists() else {'items': [], 'calls': 0, 'failed': 0, 'stats': {}}
    print(f"작품 {len(works)}편 · 기록 {base} · 응답 {llm.model} · 장부 $" f"{llm.cost.spent():.3f}", flush=True)
    started = time.time()
    refined = refine_works(works, records, merged, learned, llm, executor, tighten) if refine else None
    report(finish(works, records, merged, name, KT / 'works', KT / f'{name}_stats.json', learned, refined), started, llm)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, allow_abbrev=False)
    sub = parser.add_subparsers(dest='command', required=True)
    run_ = sub.add_parser('run', help='회차별 추출·합치기·세계관 만들기(모델 호출)', allow_abbrev=False)   # 철자 틀린 옵션이 조용히 무시돼 엉뚱한 모델로 도는 일을 막는다
    run_.add_argument('works', nargs='*', help='작품 id(없으면 KT/works 전체)')
    run_.add_argument('--gen-model', required=True, help='게이트웨이 모델 id(단가표 kt_exec.GEN_RATES에 있는 모델)')
    run_.add_argument('--gen-effort', choices=EFFORTS, help='호출의 reasoning.effort(응답 캐시 열쇠와 장부 모델 이름에 들어간다)')
    run_.add_argument('--name', required=True, help='결과 이름: 응답 캐시 cache-<name>·장부 cost-<name>.jsonl·works/<id>/<name>.json')
    run_.add_argument('--limit-usd', type=float, required=True, help='장부 금액 상한(달러, 구독 경로 모델은 정가 환산 금액)')
    run_.add_argument('--step-llm', action='append', default=[], help="단계별 모델·강도: 'kind=모델[@강도]'(kind = chars·doc·events·presence·rels·learn·merge·refine_card·refine_identity·refine_section, 여러 번 줄 수 있다)")
    run_.add_argument('--no-refine', action='store_true', help='⑦ 카드 다듬기를 건너뛴다')
    run_.add_argument('--tighten', action='store_true', help='⑦에 직전 판의 인물 경로(병합 인물 소개 다시 쓰기·긴 회차 칸 줄이기)도 더한다(기본 끔: 알아야 하는 쪽 점수를 깎는다)')
    refine_ = sub.add_parser('refine', help='앞 단계 결과 위에서 ⑦ 카드 다듬기만 새로 부르기(모델 호출)', allow_abbrev=False)
    refine_.add_argument('works', nargs='*', help='작품 id(없으면 KT/works 전체)')
    refine_.add_argument('--from', dest='base', required=True, help='읽을 앞 단계 결과 이름(works/<id>/<base>/에 episodes·merge.json이 있어야 한다)')
    refine_.add_argument('--gen-model', required=True, help='게이트웨이 모델 id(단가표 kt_exec.GEN_RATES에 있는 모델)')
    refine_.add_argument('--gen-effort', choices=EFFORTS, help='호출의 reasoning.effort')
    refine_.add_argument('--name', required=True, help='새 결과 이름(--from과 달라야 한다)')
    refine_.add_argument('--limit-usd', type=float, required=True, help='장부 금액 상한(달러)')
    refine_.add_argument('--step-llm', action='append', default=[], help="종류별 모델·강도 'kind=모델[@강도]'(refine_card·refine_identity·refine_section)")
    refine_.add_argument('--no-refine', action='store_true', help='호출 없이 같은 기록으로 기본 세계관만 다시 조립한다(전후 비교의 전)')
    refine_.add_argument('--tighten', action='store_true', help='직전 판의 인물 경로(병합 인물 소개 다시 쓰기·긴 회차 칸 줄이기)도 더한다(기본 끔)')
    args = parser.parse_args(argv)
    if args.command == 'refine':
        refine_from(args.works, base=args.base, gen_model=args.gen_model, gen_effort=args.gen_effort, name=args.name, limit_usd=args.limit_usd, step_llms=tuple(args.step_llm), refine=not args.no_refine, tighten=args.tighten)
    else:
        run(args.works, gen_model=args.gen_model, gen_effort=args.gen_effort, name=args.name, limit_usd=args.limit_usd, step_llms=tuple(args.step_llm), refine=not args.no_refine, tighten=args.tighten)


if __name__ == '__main__':
    main()
