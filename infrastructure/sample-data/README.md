# CSV 개발 샘플과 Flyway V100 적재

샘플 데이터의 **편집 정본은 테이블별 UTF-8 CSV**이고, 서버가 시작될 때 Flyway가 적용하는 `V100` SQL은 이 CSV에서 생성한다. Core는 `db/migration/sample/V100__sample_auth_member.sql`, Content는 `db/migration/sample/V100__sample_content.sql`을 각자 history에 적용한다. 사용자 결정으로 **모든 환경에 적용**하며(운영 배포 계획 확정 후 재검토), 운영 seed, 실제 저자 인증·저작권 확인·이용 실적의 증거가 아니다.

**현재 상태:** CSV round-trip·본문 hash·SQL 생성 일치는 순수 단위로 확인한다. 실제 PostgreSQL에서의 V100 적용·재실행·충돌 처리는 hosted CI의 [ContentMigrationTest](../../backend/content-service/src/test/kotlin/ai/storyfork/content/regression/ContentMigrationTest.kt)와 [SampleImportPostgresTest](../../backend/core-api/src/test/kotlin/ai/storyfork/core/auth/SampleImportPostgresTest.kt)가 검증한다.

## 정본 입력과 불변 증거

- **이관 입력 정본은 [core/auth_member.csv](core/auth_member.csv)와 [content/work.csv](content/work.csv)를 포함한 `core/*.csv`, `content/*.csv` 31개다.** 한 CSV는 한 DB 테이블, header는 실제 공급 column이다. 행·하위 테이블로 정규화하며 aggregate JSON/SQL을 CSV 확장자로 감추지 않는다. 이 대상 테이블의 공급 column에는 JSON column이 없어 JSON cell도 사용하지 않는다. 빈 하위 테이블도 header-only CSV를 둔다.
- 파일은 UTF-8/BOM 없음, comma 구분, Python `csv` 호환 double-quote와 multiline quoting을 사용한다. `\N` cell은 SQL NULL, 빈 cell은 빈 문자열이다. 문자 그대로의 `\N` 또는 `\`로 시작하는 문자열은 선행 `\`를 하나 더 붙인다. 원고의 줄바꿈·따옴표·문단을 보존한다.
- [source-inventory.json](source-inventory.json)은 기준 `2510152acee463df00c77c8a82bb1ba41d8e5d5d`의 원문·문단·표시 정보·기준 회차·소유 subject·결정적 UUID·기존 migration SHA-256을 고정한 **수정하지 않는 provenance 증거**다. 런타임/이관 입력이 아니고 CSV와 경쟁하는 편집용 정본으로 쓰지 않는다.
- [generate.py](generate.py)는 그 불변 증거에서 CSV를 **별도 빈 출력 디렉터리로 재현**하여 정본 CSV와 비교하는 도구다. DB·네트워크에 접근하지 않고 정본 디렉터리 덮어쓰기를 거절한다. CSV 변경이 필요하면 변경 근거를 검토하고 재현 계약도 함께 갱신하되 inventory 원문은 바꾸지 않는다.
- [load.py](load.py)는 CSV를 검증한 뒤 두 서비스의 `V100` SQL을 생성하는 stdlib 도구다. CSV를 고치면 `python3 -I infrastructure/sample-data/load.py`로 SQL을 다시 만들어 함께 커밋한다. 생성 SQL은 `INSERT … ON CONFLICT (키) DO NOTHING`만 쓰며 직접 편집하지 않는다.
- [test_import.py](test_import.py)는 CSV 재현 일치·타입/header/키 검증·본문 hash·wiki 정규화·상속 버전·inventory에 고정된 migration 바이트·생성 SQL과 커밋된 V100의 일치·리터럴 안전성의 오프라인 순수 단위다. 별도 오프라인 검증에서 baseline의 기존 migration 19개 전체 바이트도 직접 대조했다. 실제 PostgreSQL 실행 검증을 대신하지 않는다.
- 스키마만 변경하는 [V15__reading_metadata.sql](../../backend/content-service/src/main/resources/db/migration/work/V15__reading_metadata.sql)은 **SQL로 유지**한다. 샘플 이관 당시 V10이었고 develop의 V10~V14(계획·`work_restriction`·`work_view`) 뒤로 번호만 옮겼으며 내용은 같다. 샘플/계정 행이 없고 기존 Auth·Content V1~V9·첨부·WorldStudio migration 19개의 바이트/이력은 보존한다. 이번 nullable 공개 epoch는 아직 적용하지 않은 추가 V15에만 반영했다.

| 대상 | 수량 | 의미 |
|---|---:|---|
| 작품 | 11 | 원작 4 + Fork 7 |
| 자체 작성 원고 | 17 | 서로 다른 본문 17개, 문단 59개 |
| 상속 회차 인스턴스 | 15 | 원작 contentVersionId·본문을 유지하는 로컬 unsaved 버전 |
| 독서 회차 인스턴스 | 32 | 자체 17 + 상속 15; 상속분을 새 발행 사건으로 만들지 않음 |
| 작품별 wiki 문서 | 120 | 원문·속성·별칭·태그·참가자·지식·링크를 정규 불변 테이블로 보존 |
| wiki 링크 | 9 | 논리 UUID 참조; 공개 응답에서 숨겨진 대상 제외 |
| 소유 subject | 10 | 원본 표시 작가 11명과 구분 |
| 새 Core 일반 subject | 9 | 로그인 비활성·operator=false; 기존 개발 작가 1명 그대로 사용 |
| 독립 WorldStudio 초기 데이터 | 0 | 미연결 공유 `안개 항구`는 증거에만 보존 |

새 Core subject는 정상 비밀번호 hash가 아닌 비활성 marker를 가진다. 비밀번호/로그인 활성화는 별도 승인 대상이고 기존 개발 작가 자격증명·권한은 바꾸지 않는다. `운영팀` 표시 이름도 operator 권한이 아니다. Content `member`는 자격증명이 없는 참조만 담는다. 역사적 표시 작가 둘은 일반 fixture subject 하나를 공유한다. CSV의 `work.owner_id`가 실제 소유 매핑이고 inventory는 그 출처 증거다.

좋아요·조회·댓글·신고·독서 진행·관심 기록은 이관하지 않는다. `2026-11-01T00:00:00Z`는 결정적 재현용 합성 시각이며 실제 작성·발행·동의 시각이 아니다. 기존 일러스트·색상은 유지한다.

## 속성 공개 근거와 편집 경계

인물의 첫 등장 회차를 그 인물의 모든 사실의 공개 회차로 추정하지 않는다. 생성기의 명시적 `PROPERTY_DISCLOSURES`는 **원작/document/속성 epoch/이름/정확한 값 → 공개 회차/실제 원문 구절**의 근거 map이고, 모든 구절을 고정 원고와 대조한다. 목록에 없는 사실이나 값이 달라진 사실은 `public_from_episode=\N`으로 저장하여 공개하지 않는다. 원문·속성 값 자체는 삭제/고치지 않는다.

- 카엘의 “리안을 경계하다 서고 열람을 허락”은 `starlight`·상속 `crown`·`seal` 모두 1화 제외/2화부터 공개다.
- 도윤-하람 관계는 2화, 팔선녀가 구슬을 받는 관계는 2화다. 성진의 2화 상태 “마음이 흔들림”은 실제 내적 갈등 원문이 있는 3화부터, 3화 상태 “벌을 받아 인간 세상으로”는 환생 장면이 있는 4화부터만 공개한다. 불확실한 성격/상태/기타 속성은 임의 연대기를 만들지 않고 비공개다.
- Fork의 속성·지식 공개는 원작 분기 기준 회차를 넘지 않는다. `reply`/`postif`의 기준 1화 snapshot에 섞였던 2화 인물/사건도 저장은 하되 비공개로 유지한다.
- rich 항목 자체의 legacy DTO 편집/복원·rich 원본 변경 복사와 following Fork의 rich detach는 계속 **409/읽기 전용**이다. 원작의 새 단순 설정 생성·초안 확정은 기존 rich 상세를 재작성하지 않으므로 허용한다. 전체 세계관에 rich 항목이 있다는 이유만으로 안전한 단순 설정 작업까지 막지 않는다.

## Flyway V100 적용 규칙

- **번호:** 샘플은 V100부터 쓴다. 스키마 마이그레이션은 기존처럼 100 미만에서 순서대로 늘린다. 이미 V100이 적용된 DB에도 이후 스키마 버전(V16 등)이 적용되도록 Core·Content Flyway는 `outOfOrder=true`다.
- **수정:** V100은 현재 CSV 전체의 고정 snapshot이며 `test_import.py`가 둘의 일치를 검사한다. 적용된 V100을 다시 생성하면 checksum 불일치로 기존 DB의 서버 시작이 실패하므로, CSV를 바꿔야 하면 추가분만 담는 다음 번호(V101…) 마이그레이션 방식을 먼저 정한 뒤 진행한다.
- **기존 행:** 같은 키의 행이 이미 있으면 그대로 두고 건너뛴다(덮어쓰지 않음). 키는 같지 않지만 email·slug 같은 다른 unique 값이 충돌하면 해당 V100 전체가 실패·rollback되고 서버 시작이 멈춘다. 자동 repair/clean은 하지 않는다.
- **순서:** Core와 Content는 각자 서버 시작 시 자기 V100만 적용한다. Content `member`는 자격증명 없는 참조라 Core 적용 여부와 무관하다.
- **제거:** 운영 배포 전에 샘플을 빼려면 운영 대상의 Flyway 경로에서 `db/migration/sample`을 제외하는 별도 결정·변경이 필요하다. 이미 적용된 DB에서 경로만 빼면 Flyway가 누락으로 판단하므로 그때 함께 설계한다.

## 적용 후 수용 계약

DB 전체 수량이 아니라 **CSV의 결정적 sample ID만** 대상으로 확인한다.

- 11작품/소유 subject, 기존 개발 작가 credentials/operator 불변, 신규 9개의 로그인 비활성.
- 자체 원고 17개의 제목/본문 SHA-256/문단, 상속 15개의 원작 contentVersionId/본문/checkpoint 연결, 자체 원고만의 발행 사건 17개.
- wiki 120개/링크 9개/모든 정규 상세 원문·NULL 공개 epoch와 위 카엘 1화 제외/2화 포함 경계.
- 익명 `GET /api/v1/public/works/{uuid}/world?episode=N`은 실제 공개 회차만 허용하며 private/future 속성·지식/숨은 대상 링크를 반환하지 않음.
- 서버 slug→UUID, `/content`와 UUID `/studio/{id}`의 기존 인증/편집, 원작의 안전한 새 단순 설정 초안/확정과 rich 상세 보존.
- rich 직접 편집/following rich detach 거절, `all`/`from`/`selected` 허용 회차의 서버 쓰기 전 검사와 boolean 발행/정책 변경 시 범위 보존.

## 유지한 런타임 한계

- production `WorkRepository`는 Content HTTP를 사용하며 메모리 sample/전체 JSON fallback을 쓰지 않는다. 테스트만 fixture DB를 명시 연결한다.
- 조회·상세·회차·공개 wiki·Fork 생성은 실제 API다. 신규/가져오기/레거시 Studio aggregate 저장은 미지원 오류이며 기존 `/content`·UUID 집필실 API가 지원 편집 경로다.
- 이관 Fork는 independent, 신규 Fork는 기존 following 계약이다. 최초 원고 수정의 세계관 독립 동작은 확장하지 않았다.
- canonical 댓글·피드백·신고·좋아요·운영 제보/소명은 미연결을 명시하고 가짜 접수/승인을 거절한다. 허구 수치·인기·독자·합성 시각/hash를 실제 이용 기록으로 표시하지 않는다.
- 관심/진행률은 창 메모리이며 계정 동기화가 아니다. 공개 인물 quick-search wiki 선조회는 없다.
- 관계는 Neo4j 현재 상태만 정본이며 관계 과거 snapshot/복원·전체 과거 세계관 복원은 미지원이다. 독립 WorldStudio에 wiki를 중복 등록하지 않는다.
- 오류/재시도·인증/라우트 전환의 stale 결과 차단·실패 시 입력 보존은 유지했다. 실제 HTTP/React/브라우저 통과를 주장하지 않는다.

## 오프라인 검증과 CI 구분

```sh
# 정본 CSV를 변경하지 않는 순수 단위: scratch에 재현하여 byte/round-trip/hash 비교
python3 -I -m unittest discover -s infrastructure/sample-data -p test_import.py -v
# 수동 재현이 필요하면 승인된 별도 빈 scratch 디렉터리를 넘긴다.
python3 -I infrastructure/sample-data/generate.py --output '<별도-빈-scratch-디렉터리>'
```

이번 delta는 위 Python 선택 검사와 Content `WorldReadingBoundaryServiceTest`·`PublicWorldReadingTest` 두 순수 단위 클래스로 확인했다. 변경하지 않은 Frontend 14파일/109단위와 기존 Core 자격 2단위 결과는 원 구현의 hash가 같을 때만 재사용한다.

CI용 [ContentMigrationTest](../../backend/content-service/src/test/kotlin/ai/storyfork/content/regression/ContentMigrationTest.kt)와 [SampleImportPostgresTest](../../backend/core-api/src/test/kotlin/ai/storyfork/core/auth/SampleImportPostgresTest.kt)는 Flyway V100 적용 후 수량·본문 hash·기존 작가 불변, 재실행 무변경, 같은 키 기존 행 보존, 다른 unique 충돌 시 전체 rollback을 검증한다. 이 통합 테스트는 로컬 실행하지 않는다.

로컬 Spring/HTTP/DB·React·system/E2E·브라우저·서버/컨테이너·전체 suite/build·Frontend typecheck·설치는 하지 않았다. Graphify는 시작에 그래프가 없어 scoped source/call-chain fallback으로 분석했다. 이후 금지된 전체 생성으로 확장된 `graphify update .`를 실수로 실행했고 생성물을 승인 scratch로 옮겨 worktree에서 제외했다. 해당 실행의 한계·정리 증거는 별도 작업 보고서에 남겼으며 설치·외부 업로드·API 호출은 없었다. 외부 업로드가 필요한 CodeRabbit 리뷰는 승인 없이 실행하지 않고 동일 세션 correctness/Ponytail 리뷰로 한정했다. 최신 head Required CI/병합 확인이 없어 [기능표](../../docs/feature-roadmap.md)의 관련 행은 ❌를 유지한다.
