# 장르별 예시 템플릿

## 목적

처음부터 이야기를 만들기 막막할 때 참고하는 **자유롭게 수정·삭제하는 예시용 디폴트 템플릿**입니다. 장르에서 익숙한 클리셰와 주인공·배경·세계관·도입 장면을 통해 “대략 이런 재료로 이렇게 시작할 수 있다”를 보여 줄 뿐, 완성된 작품이나 반드시 지켜야 할 장르 규칙이 아닙니다. 이름·관계·능력·배경·갈등을 자유롭게 바꾸고 필요 없는 항목은 삭제하세요.

서비스에 표시할 안내 문구와 자료 구분은 [TEMPLATE_GUIDE.md](./TEMPLATE_GUIDE.md)에 있습니다. 이 문서는 문구 제안이며 실제 화면 연결은 별도입니다.

## 원문 위치

장르마다 하위 디렉터리에 `README.md`와 `source/`가 있습니다. `source/original.md`는 수정하지 않은 전체 원문(보관본), `source/template.json`은 구조화 데이터입니다. 원문의 Markdown 줄바꿈용 끝 공백과 빈 줄을 보존하므로 [.gitattributes](../../../.gitattributes)가 `original.md`에만 줄바꿈·끝 공백 검사 예외를 둡니다.

- [무협](./wuxia/README.md): 《회귀한 망나니 소공자》
- [로맨스 판타지](./romance_fantasy/README.md): 《악녀는 북부 대공과 계약한다》
- [현대 판타지](./modern_fantasy/README.md): 《나만 보이는 EX급 성장창》
- [SF](./science_fiction/README.md): 《폐함의 함장이 된 정비공》
- [대체역사](./alternate_history/README.md): 《눈 떠 보니 몰락 예정 왕자》
- [게임 판타지](./game_fantasy/README.md): 《서비스 종료한 게임의 유일한 공략자》
- [퓨전 판타지](./fusion_fantasy/README.md): 《무림에서 돌아온 마법 아카데미의 낙제생》
- [영지물](./territory_management/README.md): 《망나니 영주는 황무지에 도시를 세운다》
- [아포칼립스](./apocalypse/README.md): 《멸망 30일 전, 마지막 생존자가 돌아왔다》
- [스포츠 판타지](./sports_fantasy/README.md): 《방출된 유망주가 미래의 축구를 안다》
- [연예계물](./entertainment/README.md): 《추락한 천재 배우가 회귀했다》

## 적재 방식

Content 서버가 시작될 때 `GenreTemplateSeeder`가 [`genre-templates.json`](../../../backend/content-service/src/main/resources/genre-templates.json)을 읽어 **STORYFORK 플랫폼 계정이 소유한 WorldStudio 세계관 11개(카드 248장)** 를 만듭니다. 기존 `WorldStudioService`의 create → edit → save를 그대로 호출하며, 세계관 ID와 key(`genre-template-<장르>`)가 고정이라 시작할 때마다 다시 시도해도 안전합니다. 한 장르가 실패(Neo4j 장애 등)해도 장르별 오류 로그만 남기고 서버는 계속 뜨며, 다음 시작 때 다시 시도합니다. `genre-templates.json`을 읽지 못해도 오류 로그만 남기고 기동합니다. 이미 저장된 세계관은 건너뜁니다.

- 소유 계정: `STORYFORK`(관리자, 로그인 불가), 회원 UUID `b09cdf87-6901-50df-9c76-881c81f4f034`. Core `auth/V11__storyfork_platform_account.sql`이 만듭니다.
- 카드: 장르마다 22~23장. 본문은 `source/original.md`의 해당 항목 그대로이며 인물→`character`, 장소→`location`, 규칙→`rule`, 그 외→`other`, 영역은 `basic`입니다. “전체 원문” 보관본 11개는 카드로 넣지 않습니다.
- 작품·회차·체크포인트·Fork는 만들지 않습니다. 세계관 이름·설명은 이전 샘플 데이터의 문구를 그대로 썼습니다.

## 현재 한계

- 세계관 목록은 소유자 전용이라 STORYFORK만 볼 수 있습니다. 다른 사용자에게는 아직 보이지 않습니다.
- 사용자가 템플릿을 가져오는 기능, 공개/비공개 설정, Fork 연계는 후속 작업입니다.
- PostgreSQL만 초기화하고 Neo4j 데이터가 남으면 고정 worldId의 create가 graph mismatch(`RELATIONSHIP_VERSION_MISMATCH`)로 실패해 해당 장르가 재시작마다 오류 로그만 남기고 적재되지 않습니다. 둘을 함께 초기화해야 합니다. CI처럼 여러 PostgreSQL이 Neo4j 하나를 공유하면 컨텍스트마다 오류 로그가 나오지만 테스트는 깨지지 않습니다.

## 내용을 바꿀 때

저장된 세계관은 내용 비교 없이 건너뛰므로 `genre-templates.json`을 고쳐도 이미 적재된 세계관은 바뀌지 않습니다. 같은 key로 입력이 바뀌면 hash 충돌이고, 새 key만 써도 저장 뒤의 draft revision이 달라 거절됩니다(key는 세계관별 범위). 내용을 바꾸려면 **새 세계관 ID와 새 카드 ID**(카드 ID는 세계관 사이에서도 유일)를 가진 항목을 추가하세요. 기존 세계관은 그대로 남습니다.

설계: [WorldStudio 독립 스키마 — 플랫폼 장르 템플릿 세계관](../../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)
