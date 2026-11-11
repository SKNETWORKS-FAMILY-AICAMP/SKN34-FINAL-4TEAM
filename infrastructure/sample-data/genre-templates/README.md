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

## 신화·설화 예시 추가분

기존 11종과 독립된 14종입니다. 각 문화권의 모티프를 활용한 창작 예시이며, 서로 다른 세계관을 자동으로 합쳐 적용하지 않습니다. 이집트는 기존 채팅 개요 원문, 나머지는 후속 설정집 원문을 사용합니다.

- [수메르 신화](./sumerian_mythology/README.md): 《일곱 문 아래, 지워진 이름》 (52장)
- [크툴루 신화](./cthulhu_mythos/README.md): 《조수 없는 항구의 기록관》 (69장)
- [북유럽 신화](./norse_mythology/README.md): 《세계수의 마지막 배달부》 (65장)
- [그리스·로마 신화](./greco_roman_mythology/README.md): 《신탁에서 누락된 열세 번째 영웅》 (60장)
- [게르만 설화](./germanic_folklore/README.md): 《검은 숲의 계약 수선공》 (64장)
- [중국 설화](./chinese_folklore/README.md): 《천상 호적에 없는 사람》 (65장)
- [일본 신화](./japanese_mythology/README.md): 《경계의 신사는 이름을 받지 않는다》 (63장)
- [한국 신화 및 우화](./korean_mythology_fables/README.md): 《저승행 반송 우편》 (64장)
- [이집트 신화](./egyptian_mythology/README.md): 《심장보다 무거운 이름》 (10장)
- [인도 신화](./indian_mythology/README.md): 《세 번째 새벽에 끝나는 맹세》 (14장)
- [켈트 신화](./celtic_mythology/README.md): 《여름을 빌린 왕의 마지막 손님》 (14장)
- [슬라브 신화](./slavic_mythology/README.md): 《닭다리 집의 마지막 제자》 (14장)
- [마야 신화](./maya_mythology/README.md): 《해가 뜨기 전의 공놀이》 (14장)
- [아즈텍 신화](./aztec_mythology/README.md): 《태양이 쉬는 날》 (14장)

신화 추가분의 `basic_template.content_markdown`은 기본 템플릿 전체를 담습니다. `setting_bible.sections`의 `template_part`는 `기본 템플릿`, `확장 설정`, `도입 예시` 중 하나이며, 기본형 본문과 항목별 데이터를 중복 사용하지 않습니다. 원문의 안내와 모든 본문은 보존합니다. 카드 제목에도 영역을 표시하지만 WorldStudio의 카드 area는 사건이 `history`, 나머지가 `basic`입니다.

## 적재 방식

Content 서버가 시작될 때 `GenreTemplateSeeder`가 [`genre-templates.json`](../../../backend/content-service/src/main/resources/genre-templates.json)을 읽어 **기존 운영 관리자 계정이 소유한 WorldStudio 세계관 25개(카드 830장)** 를 만듭니다. 기존 `WorldStudioService`의 create → edit → save를 그대로 호출하며, 세계관 ID와 key(`genre-template-<장르>`)가 고정이라 시작할 때마다 다시 시도해도 안전합니다. 한 장르가 실패(Neo4j 장애 등)해도 장르별 오류 로그만 남기고 서버는 계속 뜨며, 다음 시작 때 다시 시도합니다. `genre-templates.json`을 읽지 못해도 오류 로그만 남기고 기동합니다. 최초 적재는 동결된 `genre-templates-v1.json`으로 재시도 입력을 보존하고, 이어서 `genre-templates.json`의 보완본을 적용합니다. 아래 v2 갱신 조건을 따릅니다.

- 소유 계정(임시 할당): Core `auth/V8__member_admin_operations.sql`의 운영 관리자 `admin@example.test`(`operator=true`), 회원 UUID `5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01`. 새 계정은 만들지 않으며, 운영자로 로그인하면 세계관 목록에서 보입니다.
- 카드: 기존 11종 248장과 신화·설화 14종 582장입니다. 본문은 원문 항목을 보존하며, 긴 항목은 3,000자 이내의 연속 카드로 나눕니다. 신화 추가분은 인물→`character`, 장소→`location`, 조직→`organization`, 능력→`ability`, 사물→`object`, 규칙→`rule`, 사건→`event`, 그 외 및 도입 원고→`other`로 분리합니다. 영역은 사건 카드가 `history`, 나머지가 `basic`이며 “전체 원문” 보관본은 별도 카드로 중복 적재하지 않습니다.
- 작품·회차·체크포인트·Fork는 만들지 않습니다. 기존 11종의 세계관·카드 데이터는 유지하고 추가분에 새 고정 ID를 부여했습니다.

## 현재 한계

- 소유자는 임시로 할당한 운영 관리자 계정입니다. V8 샘플 관리자 비밀번호가 마이그레이션 주석에 공개되어 있어, 그 계정으로 로그인하면 누구나 템플릿을 수정·삭제할 수 있습니다. 실제 운영 계정·공개 템플릿 조회가 생기면 소유자를 바꿉니다.
- V8은 `ON CONFLICT (email) DO NOTHING`이라 기존 DB에 `admin@example.test`가 다른 id로 있으면 템플릿 소유자가 실제 로그인 계정과 다를 수 있습니다.
- 세계관 목록은 소유자 전용이라 다른 사용자에게는 여전히 보이지 않습니다.
- 사용자가 템플릿을 가져오는 기능, 공개/비공개 설정, Fork 연계는 후속 작업입니다.
- 소유자를 바꿔도 이미 적재된 세계관은 새 소유자로 옮겨지지 않습니다. 고정 worldId의 create가 소유자 불일치로 거절되어 장르별 오류 로그만 남으므로, 소유자 변경 때는 기존 세계관(PostgreSQL·Neo4j)을 승인 하에 정리해야 합니다.
- PostgreSQL만 초기화하고 Neo4j 데이터가 남으면 고정 worldId의 create가 graph mismatch(`RELATIONSHIP_VERSION_MISMATCH`)로 실패해 해당 장르가 재시작마다 오류 로그만 남기고 적재되지 않습니다. 둘을 함께 초기화해야 합니다. CI처럼 여러 PostgreSQL이 Neo4j 하나를 공유하면 컨텍스트마다 오류 로그가 나오지만 테스트는 깨지지 않습니다.

## 내용을 바꿀 때

### v2 보완과 기존 데이터 반영

Content 서버를 재시작하면 `GenreTemplateRepair`가 기존 세계관·카드 ID를 유지하며 프런트 메타데이터, 원문 순서, 분류, 표시 안내를 보완합니다. 별도 SQL·Python 적재나 DB 초기화는 필요 없습니다. 새 세계관도 v1 최초 저장 뒤 v2 저장을 수행하며 기존 불변 저장 버전은 남습니다.

- v1 기준 리소스는 재시도 hash와 비교 기준이므로 수정하지 않습니다. `source/original.md` 및 `content_markdown`도 그대로 보존합니다.
- 자동 보완 대상은 이름·설명·카드 전체가 v1과 같고 관계가 없는 최초 저장 상태(draft revision 2)뿐입니다. 사용자 수정·추가·삭제·관계가 있으면 건너뛰고 경고 로그를 남깁니다. 소유자 불일치도 강제 변경하지 않습니다.
- 보완 key는 `genre-template-<장르>-repair-v2`, expected draft revision은 2로 고정합니다. 편집 후 저장 전에 중단되면 같은 요청을 재시도하고 revision 3을 저장합니다. 미완료 그래프 작업도 같은 key/hash일 때만 이어갑니다. 다른 동시 편집은 충돌로 거절합니다.
- 보완 저장 완료 상태(revision 4)는 재시작해도 다시 저장하지 않습니다. 이 동작은 v2 전용 보완이며 향후 임의의 JSON 변경을 자동 동기화하는 기능이 아닙니다. 배포한 v2 입력도 고정하고 후속 보완은 별도 버전으로 설계합니다.
- 이미 사용자가 바꾼 카드의 빈 메타데이터는 프런트가 검증된 정본 필드로 읽고 다음 사용자 저장 때 기록합니다. 본문·분류를 자동 덮어쓰지는 않습니다. 손상된 studio 메타데이터는 오류로 유지합니다.
- `studio.templateOrder`는 원문 읽기 순서입니다. 프런트가 UUID 반환 순서와 무관하게 정렬하고 다음 저장에도 보존합니다.
- 5종 묶음의 대화형 문구·번호는 서비스 표시 카드에서만 제거합니다. 구조화 원문의 `display_introduction_markdown`이 표시용이고 `introduction_markdown`은 보관용입니다.

운영 확인은 관리자 세계관 상세의 카드 표시, 보완 오류·건너뜀 로그, 재시작 후 저장 버전 증가 여부를 확인하세요. 사용자 수정으로 제외된 세계관은 자동 재설정하지 말고 변경 내용을 검토해 수동 반영해야 합니다.

설계: [WorldStudio 독립 스키마 — 플랫폼 장르 템플릿 세계관](../../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관)
