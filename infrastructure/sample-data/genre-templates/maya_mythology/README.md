# 마야 전승: 키체의 포폴 부

한 작품인 《포폴 부》의 한국어 전문을 수록한다. 브라쇠르 드 부르부르의 1861년 프랑스어 번역을 저본으로 한 중역이며, 키체어 직접 번역이나 현대 번역의 전재가 아니다.

## 수록 범위와 권리

- 작품 머리말, 제1부 9장, 제2부 14장, 제3부 10장, 제4부 12장, 카베크·니하이브·아하우 키체 왕가 계보와 맺음말을 빠짐없이 포함한다.
- 총 45장과 세 왕가 계보, 본문 943문단이다. 부별 문단은 머리말 포함 제1부 208, 제2부 331, 제3부 160, 제4부와 계보 244개다.
- 저본 번역자 브라쇠르(1814–1874)의 1861년 프랑스어판은 저작재산권 보호기간이 만료되었다. 이번 한국어 문장은 그 판본에서 새로 옮겼다.
- 근대 역자의 학술 서론·각주·색인과 키체어 병행문은 제외했다. 작품 자체의 역사부와 계보는 제외하지 않았다.
- HTML 쪽경계와 누락 의심 지점을 영인으로 대조했다. 제2부 제10장 첫 문단의 원전 인쇄 결락 한 곳은 본문에 표시했다. 세대수 불일치와 저본의 생략점도 임의로 메우지 않았다.

## 서사와 카드

- source/original.md는 요약·재서술이 아닌 위 저본 작품의 한국어 전문이다. 문단별 앵커로 근거를 찾을 수 있다.
- source/tradition-cards.json의 68개 카드는 이 전문에서 추출했다. 기존 12개 대상 key를 유지하고 역사·왕권·계보 카드 등을 더했다.
- narrative_refs는 실제 본문 문단과 정확히 일치한다. source/template.json의 content_markdown은 original.md와 같고 setting_bible.sections도 카드와 동기화한다.
- 기존 템플릿 ID maya_mythology_default, genre_id, order 24를 보존했다.
- 이 변경은 이 폴더의 README와 source 세 파일만 대상으로 하며 런타임 JSON과 배포 동결본을 변경하지 않는다.

## 저본

- [1861년판 목차와 본문](https://levigilant.com/Popol_Vuh_html/popolvuhlelivres00bras.html)
- [1861년판 영인 PDF](https://upload.wikimedia.org/wikipedia/commons/0/04/Popol_vuh_-_le_livre_sacr%C3%A9_et_les_mythes_de_l%27antiquit%C3%A9_am%C3%A9ricaine%2C_avec_les_livres_h%C3%A9ro%C3%AFques_et_historiques_des_Quich%C3%A9s_..._%28IA_popolvuhlelivres00bras_0%29.pdf)

부별 HTML 링크와 판본의 특이점은 original.md 앞부분에 기록했다.

## 전문 기반 파생 설정 확장

기존 36개 카드의 key와 순서를 보존하고 32개를 더한 68개 카드다. 본문의 49개 장·절·열 단위를 주요 서사·계보군에 연결했다. 개별 인물의 모든 자손과 모든 지명을 독립 카드로 만들지는 않으며 자세한 목록은 원문 근거에서 확인한다.

본문 인용 앵커는 기존 158/943에서 확장 후 913/943로 늘었다. 이는 근거 추적 가능성의 수치이며, 카드 설명에 원문의 모든 사실이 재현되었다는 뜻은 아니다. 관계와 사건은 본문에서 확인되는 범위만 설명한다. exact evidence와 UTF-16 본문 길이(최대 474)를 검증했다.

설정 카드와 전문은 별개다. template의 content_markdown에는 기존 전문 전체를 그대로 유지하고, setting_bible.sections에 확장 카드를 반영한다.
