# Flyway 선택 적용

이 패키지는 Python 변환 없이 사용할 수 있는 버전 SQL을 제공합니다. 실제 DB에 적용하지 않았으며, 선택한 장르만 적용합니다. 기존 서비스는 명시적인 classpath migration 경로를 사용하므로 이 폴더를 자동으로 읽지는 않습니다.

## 적용 순서

1. 기존 Core V1~V9 및 Content V1~V16 스키마가 준비되어 있어야 합니다. WorldStudio·첨부의 별도 이력과 혼합하지 않습니다.
2. 공통 `migrations/core/V10__genre_template_owner.sql`을 Core의 `backend/core-api/src/main/resources/db/migration/sample/`에 배치합니다. 로그인 비활성 샘플 소유자 하나만 추가합니다. Core의 기존 `flyway_schema_history`를 사용합니다.
3. Content의 `backend/content-service/src/main/resources/db/migration/world/V17__setting_category_other.sql`이 기타 카테고리를 추가합니다. 이번 변경에 포함되어 있으며 패키지 common SQL은 같은 파일의 배포 사본입니다. 둘을 중복 등록하지 않습니다. Content의 기존 `content_schema_history`를 사용합니다.
4. genre-index.json에서 원하는 장르의 content_migration 하나를 골라 Content의 `backend/content-service/src/main/resources/db/migration/sample/`에 배치합니다. 기존 Content migration 실행 경로가 이를 읽습니다. 루트 전체를 재귀 스캔하거나 다른 서비스의 SQL을 한 이력에 넣지 않습니다.
5. 각 서비스의 기존 Flyway 실행 경로로 적용합니다. 사용자 소유 작품 생성과 화면 연결은 별도이며, 샘플 적재만으로 로그인 사용자에게 보이지 않습니다.

현재 저장소 기준 공통 Core V10, Content V17, 장르별 Content V18~V28로 이름을 부여했습니다. 적용 직전 대상 브랜치·DB의 전체 이력을 확인하세요. 이미 같은 버전이 사용되었거나 더 높은 버전까지 적용했다면 아직 미적용인 준비 파일만 다음 빈 버전으로 바꿔 배치합니다. 이후 다른 장르를 추가할 때도 이 원칙을 따르며, outOfOrder·repair·clean으로 우회하지 않습니다.

## 변경과 보존

적용한 Flyway SQL은 불변입니다. 이후 샘플 수정은 새 버전으로 추가합니다. 이번 패키지는 아직 적재하지 않은 초기 템플릿용이며, 이전 준비본을 이미 적재했다면 별도의 버전 이관이 필요합니다. ON CONFLICT DO NOTHING은 기존 설정 버전의 카테고리를 갱신하지 않습니다. 불변 setting_version을 UPDATE하지 않습니다.

CSV는 검토용 데이터 스냅샷입니다. 수정 시 미적용 SQL과 대응표도 함께 맞춰야 하며 기존 Python 로더는 패키지에서 제거했습니다. 부모 sample-data의 기존 generate.py/load.py와 V9/V16은 기존 샘플용이므로 변경하거나 실행하지 않습니다.

## 기타 카테고리 지원

Content의 일반 설정 검증과 frontend의 settingCategories에 기타를 추가했습니다. DB 카테고리만 추가하고 검증을 그대로 두면 기타 설정을 편집·확정할 수 없으므로 세 곳을 함께 반영합니다. 별도 WorldStudio의 카드 종류는 이 일반 설정 카테고리와 다른 모델이며 이번 작업에서 변경하지 않습니다.
