# 장르별 독립 샘플 패키지

**장르를 하나 선택한 뒤 그 하위 디렉터리의 CSV/SQL만 사용합니다. 장르의 설정을 하나의 작품 또는 세계관으로 병합하지 않습니다.**

루트에는 일괄 적재용 core/content/sql을 두지 않습니다. 기존 일괄 준비본은 이 디렉터리에서 제외했습니다. 각 하위 폴더는 기존 sample-data 스키마와 호환되는 CSV 32개, 단일 작품·세계관, 비공개 설정, 미발행 1화와 원문을 포함합니다.

샘플 소유 계정만 공통이며 작품·세계관·설정·회차는 장르별로 별도 ID를 가집니다. 작품·세계관 ID와 원문을 유지하며, 서비스가 계산하는 회차·설정·태그 ID는 실제 계산 규칙에 맞췄습니다. 변경 전후 ID는 각 source-inventory.json의 id_corrections에 기록했습니다. 공통 안내는 이야기 설정으로 적재하지 않습니다.

## 장르 선택

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

## 적용 경계

부모 sample-data/load.py를 그대로 실행하면 기존 샘플 migration을 대상으로 하므로 사용하지 않습니다. 선택한 장르의 `sql/core.sql`과 `sql/content.sql`만 검토해 서비스별 새 migration으로 적용하는 별도 작업이 필요합니다. 이 준비 작업에서는 실제 DB·기존 migration·공개 화면을 변경하지 않았습니다.

다른 장르를 선택할 때 기존 작품의 world_id에 내용을 덧붙이지 말고 그 장르 고유의 work_id/world_id를 유지하세요. LLM 입력에도 선택한 장르의 문서만 전달하세요.

## 저장 흐름과 SQL 재생성

[저장 흐름 검증 및 한계](./SAVE_FLOW.md)를 확인하세요. 추가된 episode_draft를 지원하는 이 폴더의 load.py를 사용합니다. 예: `python load.py wuxia`. 지정한 장르의 준비 SQL만 갱신하며 DB나 migration에는 접근하지 않습니다. 부모 loader는 테이블 31개만 허용하므로 이 32개 패키지에 직접 사용하지 않습니다.

검증 재실행: `python -B test_saved_flow.py -v` (오프라인 단위 검증).
