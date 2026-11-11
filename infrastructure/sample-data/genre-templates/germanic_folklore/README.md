# 게르만 설화: 그림 형제 수록 동화

그림 형제가 편집한 독일어권 민담의 선택본이다. 고대 게르만 종교 전체나 북유럽 신화의 동일 세계관이 아니다. 각 이야기는 독립적이며 판본별 결말·문구 차이를 보존한다.

## 서사 우선 자료 구조

- source/original.md가 먼저 작성한 한국어 전승 재서술이다. 새로운 주인공이나 도입 사건을 만든 창작 소설이 아니며, 문헌·지역·판본의 차이를 본문에서 구분한다.
- source/tradition-cards.json의 12장 카드는 완성된 서사에서 추출했다. narrative는 original.md를 가리키고 narrative_refs는 절 앵커와 실제 근거 문단을 보존한다.
- source/template.json의 content_markdown은 서사 전문이며 setting_bible.sections는 카드 본문·유형·근거를 그대로 반영한다. 기존 식별자와 카드 순서는 유지한다.
- 각 절과 카드에 출전을 표시했다. 현대 번역문을 전재하지 않았으며 독립된 설화를 하나의 가상 세계로 합치지 않는다.
- 미배포 신화 자료이므로 v1 동결본은 변경하지 않는다.

## 출전

- [Grimm's Fairy Stories: Mother Holle, Rumpelstiltskin, The Frog Prince 등](https://www.gutenberg.org/cache/epub/11027/pg11027-images.html)
