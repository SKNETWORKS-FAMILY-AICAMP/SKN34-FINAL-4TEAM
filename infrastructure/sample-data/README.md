# CSV 개발 샘플의 정본 이관

사용자 요청에 따라 **샘플 데이터는 SQL 파일이 아니라 테이블별 UTF-8 CSV 파일**로 제공한다. 이 디렉터리는 저장소의 데모 텍스트를 정규 테이블에 옮기는 오프라인 자료이며 앱 시작·Flyway·배포에서 자동 실행하지 않는다. 운영 seed, 실제 저자 인증·저작권 확인·이용 실적의 증거가 아니다.

**현재 상태:** CSV round-trip·본문 hash·선택 순수 단위 검사를 수행했다. 별도 격리 로컬 PostgreSQL(`storyfork_samples`, 기존 DB 아님)에 Core V1–V6·Content V1–V10(작품 검색·랭킹 병합 전 번호, 병합 후 Content는 V1–V14)을 적용하고 Core→Content CSV 적재, 동일 재실행, 변경 행 충돌 거절을 실제로 확인했다. 병합 후 번호의 재적재는 하지 않았다. 공유/운영 DB 적용·백업/복원, hosted Required CI, React/HTTP 통합·브라우저 수용은 별도 검증 대기다. 아래 안내는 적용 승인이 아니다.

## 정본 입력과 불변 증거

- **이관 입력 정본은 [core/auth_member.csv](core/auth_member.csv)와 [content/work.csv](content/work.csv)를 포함한 `core/*.csv`, `content/*.csv` 31개다.** 한 CSV는 한 DB 테이블, header는 실제 공급 column이다. 행·하위 테이블로 정규화하며 aggregate JSON/SQL을 CSV 확장자로 감추지 않는다. 이 대상 테이블의 공급 column에는 JSON column이 없어 JSON cell도 사용하지 않는다. 빈 하위 테이블도 header-only CSV를 둔다.
- 파일은 UTF-8/BOM 없음, comma 구분, Python `csv` 호환 double-quote와 multiline quoting을 사용한다. `\N` cell은 SQL NULL, 빈 cell은 빈 문자열이다. 문자 그대로의 `\N` 또는 `\`로 시작하는 문자열은 선행 `\`를 하나 더 붙인다. 원고의 줄바꿈·따옴표·문단을 보존한다.
- [source-inventory.json](source-inventory.json)은 기준 `2510152acee463df00c77c8a82bb1ba41d8e5d5d`의 원문·문단·표시 정보·기준 회차·소유 subject·결정적 UUID·기존 migration SHA-256을 고정한 **수정하지 않는 provenance 증거**다. 런타임/이관 입력이 아니고 CSV와 경쟁하는 편집용 정본으로 쓰지 않는다.
- [generate.py](generate.py)는 그 불변 증거에서 CSV를 **별도 빈 출력 디렉터리로 재현**하여 정본 CSV와 비교하는 도구다. DB·네트워크에 접근하지 않고 정본 디렉터리 덮어쓰기를 거절한다. CSV 변경이 필요하면 변경 근거를 검토하고 재현 계약도 함께 갱신하되 inventory 원문은 바꾸지 않는다.
- [load.py](load.py)는 CSV만 읽는 작은 stdlib + 기존 `psql` importer다. inventory/Frontend fixture를 읽지 않고 샘플 SQL 파일을 생성·사용하지 않는다. 새 production 의존성·서비스·ETL 프레임워크는 없다.
- [test_import.py](test_import.py)는 CSV 재현 일치·타입/header/키 검증·본문 hash·wiki 정규화·상속 버전·inventory에 고정된 migration 바이트·COPY 프로토콜 안전성의 오프라인 순수 단위다. 별도 오프라인 검증에서 baseline의 기존 migration 19개 전체 바이트도 직접 대조했다. 실제 PostgreSQL 실행 검증을 대신하지 않는다.
- 스키마만 변경하는 [V14__reading_metadata.sql](../../backend/content-service/src/main/resources/db/migration/work/V14__reading_metadata.sql)은 **SQL로 유지**한다. 샘플 이관 당시 V10이었고 develop의 V10~V13(계획·`work_view`) 뒤로 번호만 옮겼으며 내용은 같다. 샘플/계정 행이 없고 기존 Auth·Content V1~V9·첨부·WorldStudio migration 19개의 바이트/이력은 보존한다. 이번 nullable 공개 epoch는 아직 적용하지 않은 추가 V14에만 반영했다.

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

## 적용 전에 승인할 것

1. **정확한 대상:** Core/Content 각각 host/port 또는 socket, DB, schema, 계정, 서비스 소유 history, 현재 revision/보존 범위를 별도 승인 기록에 고정한다. [Content migration 안내](../../backend/content-service/README.md#같은-db와-fresh-콘텐츠-migration)를 따른다. 이 loader의 DB/schema 비교와 `approved-development` gate는 운영 환경 자동 판별이 아니다. 같은 DB 이름의 다른 host는 운영자가 직접 구분해야 한다.
2. **일관된 백업·복구:** Auth, Content, 같은 DB의 첨부·WorldStudio와 각 migration history를 포함할 범위, 백업 식별자/hash, 격리 복원 검증을 승인한다. 이 변경은 백업을 생성/검증하지 않는다. 별도 coordinator 승인 기록을 이 문서로 대체하지 않는다.
3. **writer 중단:** 서비스별 transaction 안에서 대상 테이블을 `SHARE ROW EXCLUSIVE`로 잠근다. table lock 5초, statement/idle-in-transaction 60초, psql 전체 프로세스 120초, advisory lock 경합은 즉시 실패한다. 온라인/대량 이관 도구가 아니며 timeout을 해제해 경합을 우회하지 않는다.
4. **정상 migration 선행:** Core Auth의 보존된 V4가 만드는 기존 일반 개발 작가 identity가 필요하다. 새 DB라도 정상 Auth migration을 먼저 적용한다. Content는 현행 V1~V14를 정상 적용한다. 다른 checksum/history면 중단하며 `repair`, `clean`, baseline/reset/drop/volume 삭제를 하지 않는다.
5. **최소 자격·연결:** `python3`, 기존 `psql`과 승인된 libpq service/연결 환경을 사용한다. 비밀번호 URI/명령줄/보고서, 루트 `.env` 출력/source/덮어쓰기는 금지한다. Core/Content는 각각 별도 연결/transaction이고 분산 transaction·자동 보상은 없다. 서비스명은 영숫자/`_`/`-`, DB/schema는 영문/숫자/`_`의 단순 PostgreSQL 식별자로 제한한다.

승인된 소유 연결에서 다음 **읽기 전용** 정보와 history의 version/checksum/success를 대조한다. Auth 행/password hash·개인 원고를 로그에 출력하지 않는다.

```sql
SELECT current_database(), current_schema(), current_user,
       inet_server_addr(), inet_server_port(), pg_is_in_recovery();
SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank;
SELECT version, checksum, success FROM content_schema_history ORDER BY installed_rank;
```

두 history가 다른 schema/DB면 각 소유 연결에서 해당 쿼리만 수행한다. 없는 history를 만들거나 search_path를 넓혀 우회하지 않는다.

## 승인 후 실행: Core 다음 Content

저장소 루트에서 운영자가 승인한 비밀 아닌 service/DB/schema 값으로 실행한다. 다음은 승인된 대상용 안내이며, 이 변경 작업에서는 격리 로컬 DB에만 같은 스크립트를 적용했다.

```sh
python3 -I infrastructure/sample-data/load.py --service core \
  --connection-service '<승인된-Core-service>' --database '<승인된-Core-DB>' \
  --schema '<승인된-Core-schema>' --approval approved-development

# Core 성공 확인 후 별도 Content 연결/transaction
python3 -I infrastructure/sample-data/load.py --service content \
  --connection-service '<승인된-Content-service>' --database '<승인된-Content-DB>' \
  --schema '<승인된-Content-schema>' --approval approved-development
```

`--connection-service`를 생략하면 운영자가 미리 승인한 `PGHOST/PGPORT/PGDATABASE/PGUSER`와 libpq 인증 설정을 사용한다. `--database`는 접속할 DB를 바꾸는 옵션이 아니라 **실제 접속 DB와 비교할 승인 대상**이다. schema는 transaction의 정확한 search_path로 고정한다. loader는 `psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1`을 shell 없이 실행하고 연결 비밀·CSV 값·원시 psql 오류를 출력하지 않는다.

모든 CSV의 정확한 테이블 집합/header·필드 수·타입·NULL·중복 PK를 **접속 전** 검증한다. DB에서는 잠금/기존 작가 identity/스키마 guard 후 임시 테이블로 `COPY FROM STDIN`하고 모든 기존 PK의 공급 필드를 `IS DISTINCT FROM`으로 비교한다. 마지막에만 FK 순서로 `INSERT ... SELECT ... ON CONFLICT (PK) DO NOTHING`한다. CSV 값을 SQL literal/식별자로 보간하지 않는다. 검증된 CSV를 COPY text 프로토콜로 변환하며 backslash/tab/CR/LF를 escape하여 multiline 값·`\.`·psql metacommand가 명령이 되지 않게 한다. SQL 제어문은 고정 템플릿이고 샘플 SQL 파일/벌크 INSERT fixture는 없다.

- **동일 재실행:** 공급 필드가 정확히 같은 행만 건너뛴다. 격리 로컬 DB에서 replay 무변경을 확인했다.
- **수정된 기존 PK/secondary unique 충돌:** 덮어쓰지 않고 서비스 transaction 전체 실패/연결 종료 rollback. UPDATE/DELETE/repair/강제 옵션은 없다.
- **Core 성공 뒤 Content 실패:** 비활성 Core subject가 남을 수 있으며 전체 성공으로 보고하지 않는다. 승인 범위에서 원인을 확인하고 재시도한다. 자동 DELETE/전체 restore는 하지 않는다.
- **오류 정보:** 고정된 PK conflict 안내 또는 비밀 없는 공통 실패만 제공한다. 프로세스 timeout/통신 단절로 COMMIT 응답이 불명확하면 성공이나 rollback으로 단정하지 않고 승인 대상의 실제 상태를 확인한 뒤 동일 CSV 재실행을 판단한다. 제약 충돌 상세 진단은 별도 승인된 소유 DB 확인으로 수행하고 계정/원고 값을 로그에 남기지 않는다.
- **복구:** 승인된 import 전 백업/보존 범위에 따른 별도 절차다. 불변 trigger 해제나 이관 행 역방향 삭제 SQL을 제공하지 않는다.

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

CI용 [ContentMigrationTest](../../backend/content-service/src/test/kotlin/ai/storyfork/content/regression/ContentMigrationTest.kt)와 [SampleImportPostgresTest](../../backend/core-api/src/test/kotlin/ai/storyfork/core/auth/SampleImportPostgresTest.kt)는 실제 `load.py`와 정본 CSV를 실행하도록 바꾸고 동일 replay·정확한 대상/승인·identity·PK/secondary unique 충돌·무덮어쓰기/rollback 검사를 유지했다. CI runner의 `python3`·`psql`이 필요하며 없으면 skip/success로 숨기지 않고 실패한다. [AuthContentIntegrationTest](../../backend/content-service/src/test/kotlin/ai/storyfork/content/regression/AuthContentIntegrationTest.kt)의 HTTP 경계도 CI 대상으로 유지했다. 이 통합 테스트는 로컬 실행하지 않았다.

로컬 Spring/HTTP/DB·React·system/E2E·브라우저·서버/컨테이너·전체 suite/build·Frontend typecheck·설치는 하지 않았다. Graphify는 시작에 그래프가 없어 scoped source/call-chain fallback으로 분석했다. 이후 금지된 전체 생성으로 확장된 `graphify update .`를 실수로 실행했고 생성물을 승인 scratch로 옮겨 worktree에서 제외했다. 해당 실행의 한계·정리 증거는 별도 작업 보고서에 남겼으며 설치·외부 업로드·API 호출은 없었다. 외부 업로드가 필요한 CodeRabbit 리뷰는 승인 없이 실행하지 않고 동일 세션 correctness/Ponytail 리뷰로 한정했다. 최신 head Required CI/병합 확인이 없어 [기능표](../../docs/feature-roadmap.md)의 관련 행은 ❌를 유지한다.
