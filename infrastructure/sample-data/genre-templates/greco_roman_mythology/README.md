# 그리스·로마 신화와 전승 설정집

헤시오도스 《신통기》 한국어 중역과 그 작품에서 추출한 카드 73개를 보존하고, 그리스·로마 원전에서 선별한 전승 카드 30개를 덧붙였다. 신들의 계보와 티탄, 올림포스, 영웅, 트로이 전쟁, 귀향, 명계, 신물, 제사와 의례를 다룬다. 서로 다른 저자와 시대의 이야기를 하나의 고정된 정본으로 합치지 않으며 모든 그리스·로마 전승을 망라한다고 주장하지 않는다.

## 읽는 순서

1. [한국어 전문](source/original.md): 헤시오도스 《신통기》 1–1022행과 저본에 수록된 별도 이문 929a–929t. 휴 G. 에벌린화이트의 1914년 영어 번역을 저본으로 새로 옮긴 중역이다. 판본·권리·교정 범위는 이 파일에 기록했다.
2. [세계관 템플릿](source/template.json): `content_markdown`은 위 《신통기》 전문 그대로다. 설정집에는 전문 추출 카드 다음에 보충 전승 카드가 이어진다.
3. [카드 원천](source/tradition-cards.json): 각 카드의 해설과 출전, `narrative_refs`를 확인한다. 기존 카드는 《신통기》의 한국어 전문을, 보충 카드는 아래 문서를 가리킨다.
4. [보충 전승의 원어 근거](source/supplementary.md): 카드별 앵커, 원전의 권·절·행, 짧은 고대 그리스어·라틴어 인용과 판본 링크를 수록한다. 요약은 한국어로 새로 작성했다.

## 출전과 판본

기존 전문의 [영어 저본](https://www.gutenberg.org/files/348/348-h/348-h.htm#chap26)은 휴 G. 에벌린화이트 번역, 1914년이다. 보충 카드는 아래 공개 원어 판본을 직접 확인했다. 각 자료는 Perseus Digital Library의 디지털 판본으로 제공된다. 그리스어 판본 파일에는 CC BY-SA 4.0 표시가 있으며 라틴어 파일에는 별도 라이선스 표시가 없다. 출처별 본문과 인용 위치는 보충 문서에서 확인할 수 있다.

- 호메로스, [《일리아스》](https://github.com/PerseusDL/canonical-greekLit/blob/master/data/tlg0012/tlg001/tlg0012.tlg001.perseus-grc2.xml), D. B. Monro·T. W. Allen 편, Oxford, 1908–1920.
- 호메로스, [《오디세이아》](https://github.com/PerseusDL/canonical-greekLit/blob/master/data/tlg0012/tlg002/tlg0012.tlg002.perseus-grc2.xml), A. T. Murray 편, 1919.
- [《데메테르에게 바치는 호메로스 찬가》](https://github.com/PerseusDL/canonical-greekLit/blob/master/data/tlg0013/tlg002/tlg0013.tlg002.perseus-grc2.xml), H. G. Evelyn-White 편, 1914.
- 아폴로도로스로 전해지는 [《도서관》](https://github.com/PerseusDL/canonical-greekLit/blob/master/data/tlg0548/tlg001/tlg0548.tlg001.perseus-grc2.xml)과 [《요약》](https://github.com/PerseusDL/canonical-greekLit/blob/master/data/tlg0548/tlg002/tlg0548.tlg002.perseus-grc2.xml), J. G. Frazer 편, 1921.
- 베르길리우스, [《아이네이스》](https://github.com/PerseusDL/canonical-latinLit/blob/master/data/phi0690/phi003/phi0690.phi003.perseus-lat2.xml), J. B. Greenough 편, 1881.

헬레네의 이집트 이설, 케르베로스의 머리 수, 라오콘의 죽음, 크레타 황소의 출신 등은 해당 출전을 구분해 기록했다. 《일리아스》가 트로이 함락으로 끝난다고 하거나, 《신통기》에 석류를 먹은 페르세포네의 귀환 조건이 있다고 덧붙이지 않는다. 입문 의례의 비밀처럼 원전이 밝히지 않은 내용은 재구성하지 않는다.

## 데이터와 검증 범위

- 기존 카드의 키·본문·순서와 템플릿 섹션, `original.md`와 템플릿 전문을 보존한다. 보충 카드의 고유 키와 새 섹션은 기존 순서 뒤에 추가한다.
- 새 카드의 근거는 `supplementary.md`의 고유 앵커 아래에 실린 짧은 원어 문자열이다. 카드와 템플릿 섹션의 본문·유형·참조를 일치시켰다. 인용 하나가 카드 전체의 의미를 자동으로 증명하지는 않으므로 연결된 원전의 해당 구간도 읽어야 한다.
- 이 폴더의 원천 자료만 수정한다. 런타임 JSON과 데이터베이스 반영 및 공통 생성기의 보충 문서 지원은 별도 통합 작업이다. 따라서 기존 생성기·런타임 동기화 검사는 이 원천 상태와 일치하지 않을 수 있다.
