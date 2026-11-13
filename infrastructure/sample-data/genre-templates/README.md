# 장르 예시와 신화·고전 전승 자료

## 두 종류의 자료

- 기존 **창작 장르 11종**은 주인공·갈등·도입 장면을 바꾸어 쓰는 예시입니다. 원문과 기존 세계관·카드 ID를 유지합니다.
- **신화·고전 15종**은 실제 전승 또는 고전 작품의 서사와 그로부터 추출한 세계관 자료입니다. 15종 모두 단일 작품의 한국어 번역 전문으로 교체했습니다. 수메르는 결락과 미해독을 표시한 현존 저본 전체입니다. 새로 지은 작품명·주인공·도입 원고를 넣지 않습니다. 서로 다른 전승과 이설을 한 설정으로 확정하지 않습니다.

신화 자료는 전승 하나를 단위로 다룹니다. **전승 서사 작성 → 그 서사에서 세계관 추출**의 두 단계로 구성합니다. 각 전승은 독립된 원고와 세계관이며 다른 지역·시대의 이야기를 하나의 정본 연대표로 합치지 않습니다. 대표 범위를 다루며 백과사전 전체를 대체하지 않습니다. 살아 있는 종교·문화의 다양한 전통을 단일 규칙으로 설명하지 않습니다. [표시 안내](TEMPLATE_GUIDE.md)를 함께 참고하세요.

## 창작 장르 11종

[무협](wuxia/README.md), [로맨스 판타지](romance_fantasy/README.md), [현대 판타지](modern_fantasy/README.md),
[SF](science_fiction/README.md), [대체역사](alternate_history/README.md), [게임 판타지](game_fantasy/README.md),
[퓨전 판타지](fusion_fantasy/README.md), [영지물](territory_management/README.md), [아포칼립스](apocalypse/README.md),
[스포츠 판타지](sports_fantasy/README.md), [연예계물](entertainment/README.md). 기존 카드 248장을 그대로 유지합니다.

## 신화·고전 전승 15종

각 장르는 아래 한 작품의 수록 본문과 그 본문에 근거한 파생 카드로 구성합니다.

| 자료 | 카드 수 | 범위 |
|---|---:|---|
| [그리스·로마](greco_roman_mythology/README.md) | 73 | 《신통기》 한 작품 한국어 완역과 세계관 |
| [북유럽](norse_mythology/README.md) | 53 | 「볼루스파」 한 작품 한국어 완역과 세계관 |
| [크툴루](cthulhu_mythos/README.md) | 38 | 《크툴루의 부름》 한 작품 한국어 완역과 세계관 |
| [서유기](journey_to_the_west/README.md) | 76 | 《서유기》 현행 위키문헌 백회본 100회 한국어 완역과 세계관 |
| [수메르](sumerian_mythology/README.md) | 53 | 구데아 원통 A·B 한 작품의 현존 저본 전체 중역 |
| [게르만 설화](germanic_folklore/README.md) | 14 | 「홀레 부인」 한 작품 한국어 완역과 세계관 |
| [중국](chinese_folklore/README.md) | 50 | 《천문》 한 작품 한국어 완역과 세계관 |
| [일본](japanese_mythology/README.md) | 75 | 《고사기》 서문·상중하권 한 작품 한국어 중역 전문과 세계관 |
| [한국](korean_mythology_fables/README.md) | 41 | 「동명왕편」 한 작품 한국어 완역과 세계관 |
| [이집트](egyptian_mythology/README.md) | 15 | 「라와 이시스의 전설」 한 작품 한국어 완역과 세계관 |
| [인도](indian_mythology/README.md) | 68 | 《바가바드기타》18장 한 작품 한국어 중역 전문과 세계관 |
| [켈트](celtic_mythology/README.md) | 25 | 「브란의 항해」 한 작품 한국어 완역과 세계관 |
| [슬라브](slavic_mythology/README.md) | 30 | 「마리야 모레브나」 한 작품 한국어 완역과 세계관 |
| [마야](maya_mythology/README.md) | 68 | 《포폴 부》 한 작품 한국어 중역 전문과 세계관 |
| [아즈텍](aztec_mythology/README.md) | 72 | 《그림으로 전하는 멕시코인의 역사》 한 작품 한국어 전문과 세계관 |

총 **26개 세계관·999장 카드**이며, 신화·고전 자료는 751장입니다. 인물·사건·장소·신물·규칙·계보군을 본문 전 범위에서 검토했습니다. 모든 세부 사실이나 계보 인물이 독립 카드로 분리되었다는 뜻은 아닙니다.

## 원문·출전·저작권

기존 11종의 `source/original.md`는 기존 창작 원문의 보관본입니다.
신화·고전 15종 모두 **단일 작품의 한국어 번역 전문**을 수록합니다. 수메르는 결락·1905년 미해독을 보존한 현존 저본 전체 중역이며 완전한 원작 복원이 아닙니다. 서유기는 진광예 삽입 회차가 포함된 현행 위키문헌 백회본이며 특정 명대 초간본의 복원이라고 주장하지 않습니다. 고사기·바가바드기타·포폴 부 등 중역 작품은 각 원고에 저본·범위·한계를 명시했습니다. 각 자료의 실제 수록 범위는 해당 README와 원고 안내에서 확인합니다.

- `source/tradition-cards.json`: 신화별 범위, 출전 목록, 안정된 항목 key, 카드 유형과 본문. `narrative`는 먼저 작성한 `original.md`를 가리키며, 각 카드의 `narrative_refs`에는 근거 절과 그 절의 정확한 문장을 기록합니다.
- `source/template.json`: 표시용 구조화 문서. `content_markdown`은 카드 모음이 아닌 전승 서사이며, `setting_bible`은 그 서사에서 추출한 세계관입니다. `setting_bible.sections`가 카드와 대응하며 `template_part`는 전승 자료입니다.
- 각 카드 본문에 출전을 표시합니다. 단일 문헌의 주장·화자의 추론·후대 전승을 구분합니다.
- 크툴루는 러브크래프트 원작 범위에 한정합니다. 후대 작가나 Chaosium TRPG의 위계·수치·고유 설정을 넣지 않습니다.
- 신·존재는 `character`, 장소는 `location`, 집단은 `organization`, 권능은 `ability`, 신물은 `object`, 규칙은 `rule`, 사건은 `event`입니다. 사건의 area는 `history`, 나머지는 `basic`입니다.
- PR #287의 결말 선택지 등 창작 카드와 잘못된 장소 분류는 전승 자료로 교체되어 적재 목록에 남지 않습니다.

## 적재와 보존

`GenreTemplateSeeder`가 서버 시작 시 기존 `WorldStudioService`의 create → edit → save로 적재합니다.
DB·작품·회차·Fork 생성 스크립트를 새로 추가하지 않습니다.

- `genre-templates-v1.json`에는 이미 배포된 창작 장르 **11종만** 남깁니다. 해당 데이터는 변경하지 않습니다.
- 기존 11종의 v1 최초 요청과 v2 보완 흐름은 유지합니다. 초기 상태와 일치할 때만 보완하며 사용자 편집·관계는 덮어쓰지 않습니다.
- 아직 배포되지 않은 신화·고전은 `genre-templates.json`의 **최종 데이터로 직접** 적재합니다. 중간 v1/v2/v3 동결본이나 불필요한 보완 버전을 만들지 않습니다.
- 새 카드도 처음부터 메타데이터와 `studio.templateOrder`를 포함합니다.
- 이미 저장된 세계관은 재시작으로 덮어쓰지 않습니다. 실제 배포 이후 내용 변경은 별도 이관 검토가 필요합니다.
- 운영 관리자의 임시 소유 정책과 타 사용자 미노출은 그대로입니다. 공개 목록·개인 계정으로 복사하는 기능은 구현하지 않았습니다.

## 데이터 재생성·검증

저장소 루트에서 실행합니다. 로컬 JSON만 다루며 서버·DB에 연결하지 않습니다.

```sh
python infrastructure/sample-data/genre-templates/build_traditions.py
python infrastructure/sample-data/genre-templates/build_traditions.py --check
python -m unittest discover -s infrastructure/sample-data/genre-templates -p test_traditions.py -v
```

생성기는 기존 11종을 유지하고 신화 카드만 갱신합니다. 새 항목의 key는 UUID 생성 기준이므로 순서를 바꾸어도 변경하지 마세요.
현재 신화 14종의 세계관 ID는 유지하고, 전혀 다른 내용이 된 카드에는 전승 항목별 ID를 사용합니다. 서유기는 별도 세계관입니다.
검증은 원본 11종 보존, v1 제한, 생성 재현성, 유형·출전·길이·ID, 원문과 구조화 자료의 일치를 검사합니다.

## 한계와 운영 주의

- 소유자는 Core auth V8의 임시 운영 관리자입니다. V8 샘플 계정의 공개 비밀번호와 소유자 UUID 불일치 가능성은 해소하지 않았습니다.
- 타 사용자에게 공개하거나 복사하는 기능, 운영 소유자 이관은 후속 작업입니다.
- 소유자 불일치나 PostgreSQL·Neo4j 상태 불일치는 강제 초기화하지 않습니다. 데이터 삭제는 별도 승인이 필요합니다.
- 로컬 단위·데이터 검사는 실제 DB 적재, 브라우저 동작, 최신 커밋의 Required CI 검증을 대신하지 않습니다.

설계: [WorldStudio 독립 스키마](../../../docs/design/worldstudio-independent-schema.md#플랫폼-장르-템플릿-세계관).

## 서사 우선 자료 검증

각 전승의 `source/original.md`를 먼저 읽고 `source/template.json`의 세계관 항목을 근거 절과 대조합니다. [그리스 전승](greco_roman_mythology/source/original.md)과 [세계관](greco_roman_mythology/source/template.json)이 한 예입니다. `build_traditions.py`는 모든 전승에 원고가 연결되어 있는지, 모든 카드에 근거가 있는지, 절 ID와 인용 문장이 현재 원고에 실제로 존재하는지 검사합니다. 단위 테스트는 같은 본문을 여러 카드에 반복하거나 근거 문단을 카드 본문으로 그대로 복제한 경우도 검출합니다. `narrative_refs.evidence`에는 원고 문단을 정확히 보관하되 카드 본문은 인물·장소·신물·사건별로 필요한 설정을 따로 추출합니다. 이 검사는 출처 추적과 형식 검사이지 문장의 모든 의미가 논리적으로 입증되었다는 자동 판정이 아니므로 편집 검토를 함께 합니다. 원고 전문은 현재 앱의 카드 적재 대상이 아니며, DB나 UI에서 원고 표시를 연결한 변경은 아닙니다.
