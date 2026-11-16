# 역사 연구 샘플: 출처와 사용 한계

이 7종은 근거·권리 확인이 완료되지 않은 역사 연구 샘플이다. 각 카드와 근거의 원저 귀속, 공개·감수 한계 및 미확인 사항을 그대로 유지한다. 원문에 어떤 주장이 있다는 것은 그 내용이 역사적 사실로 독립 승인되었다는 뜻이 아니다. 기존 연구 자료의 연구 전용 허용 상태를 변경하지 않으며 실제 역사 감수나 서비스 공개 승인도 아니다. 원저, 개별 번역, 각 관할 및 제3자 자료의 법적 상태는 별도 검토가 필요하다.

`*.world.json`과 `*.evidence.json`은 [고정 연구 커밋 49c623798a01a678531ab0c2891b523400d79526의 world-cards-research](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/tree/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/world-cards-research)에서 가져왔다. 원본 카드의 키·내용·순서와 근거를 유지하고 인물 카드에만 작가용 `soul` 후보를 추가했다. SOUL은 원저의 서술과 별도의 창작 문체 제안을 구분하며 인물의 실제 말투나 발언을 재현하지 않는다. 기존 evidence 안의 `world_json_sha256` 등 생성 당시 검증값은 원본에 대한 기록으로, SOUL이 추가된 현재 파일의 해시가 아니다. DEC-47의 문서 후보이며 역사적 승인이나 정본 확정은 아니다.

`studio/*.world.json`은 위 자료를 앱 설정 카드로 나눈 검토용 후보이며 원본과 evidence를 변경하지 않는다. 미국 후보에도 아래 저작 표시·장별 기여자 및 CC BY-SA 4.0 조건이 적용된다. 서버 런타임 시드는 역사 7종을 제외하므로 빈 DB에도 기존 역사 카드와 이 후보가 자동 적재되지 않는다. 이미 DB에 있는 역사 세계관은 삭제하지 않으며 중단된 역사 시드 요청도 자동 복구하지 않는다. 후보 확인과 DB 반영은 별도이며 사용자 승인과 안전성 검증이 필요하다. 후보 인물의 SOUL은 선택 사항이고 제공된 값은 유효해야 하며 GOAL은 필수가 아니다. `build_traditions.py --check-studio`는 완성된 일곱 파일의 구조와 ID를 검사하지만 역사·권리를 검증하지 않는다.

프랑스·잉글랜드 원문은 현재 브랜치의 작업 트리에서 revert로 제거되었다. PR #424는 아직 병합되지 않아 이 상태를 develop과 구분해야 한다. 이탈리아·일본·한국·중국 원문은 작업 트리에 없다. 프랑스·잉글랜드를 포함한 여섯 나라의 원문은 이전 고정 Git 오브젝트에서 `git show 49c623798a01a678531ab0c2891b523400d79526:<경로>`로 읽을 수 있다. 해당 커밋이 로컬 또는 원격에 있어야 한다. 미국의 `docs/research/history-textbooks/usa/original-text/` 장별 파일과 일부 HTML 등은 고정 커밋에도 없어 evidence의 로컬 파일 경로와 해시만으로 현재 접근할 수 없다. 해당 발췌 및 장별 링크는 `usa.evidence.json`에 보존되어 있으며 현재 접근 가능한 공식 원전은 아래와 같다. 이 디렉터리에 원문이나 번역 전문을 추가하지 않았다.

| 나라 | 고정 원문 경로 (Git 오브젝트) | 공식 원전·서지 |
| --- | --- | --- |
| 프랑스 | [france/source-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt) | [Project Gutenberg 17287](https://www.gutenberg.org/ebooks/17287) |
| 잉글랜드 | [england/oman-1904/source-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/england/oman-1904/source-en.txt) | [Project Gutenberg 47753](https://www.gutenberg.org/ebooks/47753) |
| 이탈리아 | [italy/hunt/source-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/italy/hunt/source-en.txt), [다른 스캔 추출본](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/italy/hunt/source-toronto-1883-extracted.txt) | [Internet Archive 스캔과 OCR](https://archive.org/details/historyitaly00huntgoog) |
| 일본 | [japan/source-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/japan/source-en.txt) | [Project Gutenberg 29798](https://www.gutenberg.org/ebooks/29798) |
| 한국 | [korea/hulbert-1905/source-vol1-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/korea/hulbert-1905/source-vol1-en.txt), [2권](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/korea/hulbert-1905/source-vol2-en.txt) | [Project Gutenberg 52127](https://www.gutenberg.org/ebooks/52127), [52749](https://www.gutenberg.org/ebooks/52749) |
| 중국 | [china/source-en.txt](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/china/source-en.txt) | [Project Gutenberg 6708](https://www.gutenberg.org/ebooks/6708) |
| 미국 | 장별 원문 파일은 해당 고정 커밋에 없음. [고정 evidence와 장별 출처·기여자](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/world-cards-research/usa.evidence.json) | [The American Yawp](https://www.americanyawp.com/) |

## 미국 자료 저작 표시

The American Yawp, Joseph L. Locke와 Ben Wright 및 이용한 각 장의 편집자·기여자에게 저작을 표시한다. 장별 이름과 원전 링크는 `usa.evidence.json`의 `chapter_credits`와 `sources`에 보존한다. 원전은 [The American Yawp](https://www.americanyawp.com/)이며 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 조건을 따른다. 연구 원본은 내용을 선택해 한국어로 바꾸어 카드로 배열했고 이 복사본은 인물 SOUL 후보를 추가했다. 미국사 카드·근거·이 설명 문서는 동일 조건으로 제공한다. 원저자의 보증을 뜻하지 않으며 다른 나라 자료, 저장소 전체 및 제3자 콘텐츠의 권리를 변경하지 않는다.

## 범위 인용 보완

- 프랑스 source-status의 표제면 49–59행은 범위 자체를 입증하지 못한다. 같은 고정 원문의 [2668–2690행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/france/source-en.txt#L2668-L2690)은 1870년 전쟁, 저자가 서술한 1871년 사건과 이야기의 끝을 보여 준다. 사건 서술의 정확성은 독립 감수 대기다.
- 이탈리아 범위 카드의 283–339행에는 1874년 종점이 없다. 같은 고정 OCR 원문의 [11253–11262행](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/italy/hunt/source-en.txt#L11253-L11262)은 저자가 당시를 1874년으로 지칭하고 글을 맺는 대목을 보여 준다. OCR이며 스캔 이미지와의 새로운 전수 대조는 하지 않았다.

원래 인용과 카드 본문은 수정하지 않았다. 위 보완은 원전 서술의 범위에 관한 것이며 사건의 정확성, 현행 권리 또는 공개 가능성에 대한 전수 감수가 아니다.

미국 출처 카드에 언급된 `usa.world.ko.md` 역시 현재 작업 트리에는 없으며 [고정 연구 커밋](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/blob/49c623798a01a678531ab0c2891b523400d79526/docs/research/history-textbooks/world-cards-research/usa.world.ko.md)에서 읽을 수 있다. 장별 기여자 목록은 이 디렉터리의 evidence에도 남아 있다.

## 로컬 구조 검사

저장소 루트에서 아래 Python 표준 라이브러리 검사만 실행했다. 원본 7종과 비교하여 SOUL을 제거한 카드가 완전히 동일한지, evidence 바이트와 카드 ID가 1:1인지, SOUL 길이와 미국 저작 표시가 남았는지 확인한다.

```sh
python3 - <<'PY'
import json, subprocess
from pathlib import Path
rev = '49c623798a01a678531ab0c2891b523400d79526'
source = 'docs/research/history-textbooks/world-cards-research/'
target = Path('infrastructure/sample-data/genre-templates/history')
total = chars = 0
lengths = []
for name in ('france', 'england', 'italy', 'japan', 'korea', 'china', 'usa'):
    def original(kind):
        return subprocess.check_output(['git', 'show', f'{rev}:{source}{name}.{kind}.json'])
    before = json.loads(original('world'))
    after = json.loads((target / f'{name}.world.json').read_text())
    evidence_bytes = (target / f'{name}.evidence.json').read_bytes()
    assert evidence_bytes == original('evidence')
    evidence = json.loads(evidence_bytes)
    assert list(after) == ['genre', 'worldId', 'name', 'description', 'cards']
    count = 0
    for card in after['cards']:
        if card['cardType'] == 'character':
            soul = card.pop('soul')
            assert isinstance(soul, str) and 0 < len(soul) <= 3000
            assert '실제 말투는 미확인' in soul and '창작 문체 제안' in soul
            lengths.append(len(soul))
            count += 1
        else:
            assert 'soul' not in card
    assert after == before
    ids = [card['id'] for card in before['cards']]
    refs = [card.get('card_id', card.get('cardId', card.get('id'))) for card in evidence['cards']]
    assert len(ids) == len(set(ids)) == len(refs) == len(set(refs)) and set(ids) == set(refs)
    print(f'{name}: cards={len(ids)}, characters={count}, evidence byte-identical and 1:1')
    total += len(ids)
    chars += count
assert (total, chars) == (158, 26)
usa = json.loads((target / 'usa.evidence.json').read_text())
license = usa['license']
assert license['id'] == 'CC-BY-SA-4.0' and license['changes'] and usa['chapter_credits']
assert 'Joseph L. Locke' in license['attribution'] and 'Ben Wright' in license['attribution']
readme = (target / 'README.md').read_text()
assert all(text in readme for text in ('CC BY-SA 4.0', 'Joseph L. Locke', 'Ben Wright', 'chapter_credits', 'SOUL', '동일 조건', rev))
print(f'PASS: worlds=7 cards={total} characters={chars} SOUL length={min(lengths)}–{max(lengths)}; USA attribution, changes, license and chapter credits retained')
PY
```

결과: 7개 세계관·158개 카드·26개 인물, SOUL 165–220자, evidence 7개 바이트 일치 및 카드 ID 1:1, 미국 저작 표시 확인. 구조 검사이며 역사 사실이나 권리의 전수 감수는 아니다.
