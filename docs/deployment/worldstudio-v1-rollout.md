# 독립 WorldStudio V1 배포

## develop CD 실행 계약

기본 Auth Flyway는 `classpath:db/migration/auth`, Content는 `ContentConfig`에서 별도 migrate를 실행한다.
WorldStudio는 독립 EntityManager의 Hibernate `validate`만 수행했으므로 #97 병합과 일반 Core 시작만으로 V1이 실행되지 않았다.

이번 연동은 `.github/workflows/publish-images.yml`의 기존 develop CD에 실행 단계를 추가한다.
CI 성공 → 세 이미지 게시 → 개발 서버 pull·이미지 revision 일치 확인 → **일회성 WorldStudio migrate·validate·pending=0·12개 테이블 확인** → 새 Core `up --wait` 순서다.
마이그레이션은 기존 Core 이미지의 `WorldStudioMigration` main을 Boot `PropertiesLauncher`로 실행한다.
Compose의 `worldstudio-migration` profile은 `run --rm --no-deps worldstudio-migrate`에서만 실행되며 상시 서버·DB를 추가하지 않는다.
일반 `java -jar` 시작에는 이 명령이 실행되지 않는다. Auth/Content Spring context도 마이그레이션 명령에서 시작하지 않는다.

실행 범위는 `worldstudio` schema, `classpath:db/migration/worldstudio`, `worldstudio.world_studio_schema_history`다.
V1 SQL SHA-256은 아래 보존 값과 같다. baseline·repair·clean은 실행하지 않는다.
이미 적용된 V1은 validate 후 추가 적용 0건으로 종료한다. 기존 Auth/Content history는 읽기 검사 외 변경하지 않는다.
과거 확장형 WorldStudio 차단은 script·version·checksum·type·success 전체가 일치할 때만 적용한다.
일반 Auth/Content의 동명 V1/V2는 차단하지 않는다. 불명확한 history 형식·조회 권한 부족도 실행 실패로 처리한다.

WorldStudioConfig는 활성화된 경우에만 EntityScan/Repository 등록을 추가하고 Service도 동일 조건을 따른다.
기존 Auth EntityScan과 합쳐 하나의 Core 기본 persistence unit을 사용한다. 비활성 배포는 WorldStudio 테이블 없이 기존 Auth만 validate한다.
Service의 소유권·잠금·초안 충돌·멱등 저장·확정/복원 규칙은 유지하고 전체 외부 작업을 기본 `@Transactional`로 묶는다. 잠금 조회도 readOnly로 바꾸지 않는다.

### 최초 활성화 전 배포 담당자 확인

**현재 실제 개발 DB 식별·백업 복원 증거는 미확인이다. 이 작업에서 GitHub 변수를 활성화하거나 공용 DB에 적용하지 않는다.**

1. 개발 서버 루트 `.env`에 기존 `CORE_DATABASE_URL`, `CORE_DATABASE_USER`, `CORE_DATABASE_PASSWORD`를 설정한다. 비밀번호·실제 주소를 커밋하거나 출력하지 않는다.
2. 개발 DB임을 배포 설정·담당자 확인으로 확정한다. 운영 DB는 금지한다. SQL은 URL 문자열만으로 개발/운영을 판별할 수 없다.
3. 최초 적용 직전 기존 DB 전체와 모든 Flyway 이력을 백업한다. 격리 DB에 복원하여 데이터·이력 조회 성공을 확인하고, 백업 위치·시각·복원 결과·복구 담당자를 팀 내부 기록에 남긴다. 백업 실패 시 활성화하지 않는다.
4. 기존 WorldStudio schema/history와 과거 확장 SQL 이력을 읽기 전용으로 검토한다. 모호하면 중단한다. 이미 독립 V1을 적용했다면 체크섬·이력 정합성 확인 후 재실행 0건을 기대한다.
5. 마이그레이션 계정에 DB `CREATE`, 기존 worldstudio schema 사용·DDL 및 history 조회 권한이 있는지 확인한다. 현재 Core 런타임과 마이그레이션은 같은 기존 Core 계정을 사용한다. 새 계정·DB·풀은 추가하지 않는다.
6. GitHub **develop-cd environment variables**에 다음을 등록한다. URL·계정은 서버 `.env`와 독립적으로 개발 DB임을 확인한 값이어야 한다.

| 변수 | 값/역할 |
| --- | --- |
| `WORLDSTUDIO_EXPECTED_DATABASE_URL` | 승인한 JDBC URL 전체와 정확히 일치해야 함(비밀번호 금지) |
| `WORLDSTUDIO_EXPECTED_DATABASE_USER` | 승인한 접속 계정과 정확히 일치해야 함 |
| `WORLDSTUDIO_BACKUP_RESTORE_REFERENCE` | 팀 내부 백업·복원 검증 기록 참조(비밀값 금지) |
| `WORLDSTUDIO_CD_MIGRATION_ENABLED` | 위 조건 충족 후 마지막에 `true`. 기본 미설정/`false` |

이 변수들은 SSH stdin으로 전달하고 로그로 출력하지 않는다. DB 자격증명은 기존 Core 설정을 재사용하고 서버 `.env`에서 migration 컨테이너에 필요한 값만 전달한다.
명령은 URL allowlist·계정·실제 current_database/current_user·DB CREATE 권한을 DDL 전에 확인한다.
백업 참조는 **담당자의 확인 기록**이며 프로그램이 백업 파일이나 복원 성공을 자체 검증하는 것은 아니다.
환경 승인자·백업/복구 담당자·활성화 시점은 팀이 결정해야 한다. `develop-cd` 보호 규칙을 적절히 설정하는 것도 담당자 책임이다.

### 실행과 실패 처리

CD가 활성화된 develop 배포에서 opt-in이 `true`이면 migration 성공 후에만 `APP_WORLDSTUDIO_ENABLED=true`를 Core에 전달한다.
이 값은 WorldStudio Entity/Repository/Service를 Core 기본 EntityManager/TransactionManager에 등록하고 Hibernate validate를 수행한다.
미설정/`false`면 migration을 생략하고 WorldStudio를 비활성 상태로 유지하며 기존 배포 흐름을 실행한다.
오타 flag·필수값 누락·대상 불일치·접속/권한/과거 이력/Flyway 실패면 새 Core `up`을 호출하지 않는다. 기존 실행 컨테이너를 중단하거나 DB를 되돌리지 않는다.
실패가 새 Core 기동 이후 발생한 경우 자동 DB rollback은 하지 않는다. 실패 범위와 이력을 확인하고 담당자가 복구 여부를 결정한다.
Flyway 상세 접속 로그와 원인 예외는 출력하지 않고 성공 적용 수/검증 결과 또는 실패 상태만 출력한다.

### 검증 위치

- 로컬: fake Docker 배포 순서·실패 중단 단위 회귀, 문서/구문/Compose 설정 검사. DB/컨테이너 기동 없음.
- CI Core integration: 독립 빈 PostgreSQL V1/재실행 0건/12개 테이블, 실제 Auth·Content migration 공존·데이터/이력 보존, 정확한 과거 이력 차단.
- CI system: 실제 Core Docker jar의 별도 main 실행, 잘못된 대상 거부, 최초 적용/재실행 0건과 기존 이력 보존. 브라우저 검증은 아니다.
- 실행 결과는 PR의 최신 head CI 결과에 기록한다. 아래 이전 사전 확인은 이번 CI 결과로 간주하지 않는다.

## 이전 사전 확인 기록

확인일: 2026-11-04 (Asia/Seoul). 상태: **통합 개발 DB 적용 중단 — 대상 식별·접속·백업 미충족**.

## 보존 대상

- 브랜치: `feature/world-studio-schema`. SQL 보존 전 기준 HEAD: `996bb145bd6e7436a5a7b7ef5f3c1f827a812e39`.
- 적용 후보: `backend/core-api/src/main/resources/db/migration/worldstudio/V1__independent_worldstudio.sql`.
- 검증 SQL SHA-256: `3f0689a58a02a3d7031526dee50619dbe7bdfd5029da03af10020a11d14e0a2a`.
- 이번 확인에서 현재 SQL·관련 테스트를 앞선 성공 실행의 SHA-256 manifest와 대조해 일치함을 확인했다. SQL을 수정하지 않았고 이번 사전 확인을 새 PostgreSQL 테스트 실행으로 표현하지 않는다.
- 보존 범위는 SQL, 독립 Flyway 검사 6건·체크섬 단위 검사 1건의 코드, 해당 CI 환경 설정, 이전 SQL 비실행 보관본 및 이 문서다. JPA Service·UI·Auth·Content·이미지·회차 구현은 이 SQL 보존 커밋에 추가하지 않는다. 기존 미커밋 구현은 삭제하거나 초기화하지 않는다.

## 대상 확인 결과

현재 worktree에는 실제 `.env`가 없다. 이전에 연결된 저장소 루트 `.env`의 Core 후보는 `127.0.0.1:5432/storyfork`, 접속 계정 `root`다. 이 파일에는 개발/운영 환경 식별 표시나 원격 개발 서버 접속 설정이 없다. 이 주소를 팀 개발 DB라고 단정하지 않았다. 비밀번호는 출력·복사·커밋하지 않았다.

이 후보에 `default_transaction_read_only=on`, 접속 시간 제한, 비대화형 모드로 연결했으나 인증에 실패했다. 따라서 실제 server/database/user SQL 결과, worldstudio schema·history 및 과거 확장 SQL 적용 여부를 확인하지 못했다. 포트 5432를 게시한 로컬 Docker 개발 서비스도 확인되지 않았다.

인프라 문서의 develop 배포 대상은 `tgv99536@100.90.8.124:5798`, Compose 프로젝트는 `storyfork-develop-cd`다. 문서상 개발 배포 근거는 있으나 현재 환경의 SSH 연결은 시간 초과였다. 비밀번호 입력·새 host key 자동 수락·서버 설정 변경·서비스 재시작은 하지 않았다.

증거: 로컬 `output/deployment/preflight-access.json`. 실제 개발 DB 설정 위치 또는 VPN/SSH 터널 접속 경로와 개발 DB임을 확인할 근거가 필요하다. 기존 후보와 문서의 서버가 같은 DB인지도 미확인이다.

## 수행하지 않은 단계

- 백업/복원 가능성 확인: 접속·대상 확인 실패로 미수행. 생성된 실제 DB 백업 없음.
- 실제 개발 DB migrate/validate/재실행 0건 검사: 미수행.
- 12개 테이블·제약·기존 Auth/Content 데이터·이력 fingerprint 전후 비교: 실제 DB에서는 미수행.
- 실제 통합 DB QA 저장/과거 조회: 미수행. 앞선 일회용 PostgreSQL의 결과와 구분한다.
- 적용한 SQL 커밋: 아직 없음. SQL 보존 커밋과 실제 적용 커밋을 혼동하지 않는다. 이 문서가 포함된 커밋은 적용 후보 SQL의 추적 기준이다.

## 재개 조건과 실행 계약

1. 접근 가능한 개발 DB 주소·계정과 개발 환경 근거를 확인한다. 운영이면 중단한다.
2. 독립/과거 WorldStudio 이력을 읽기 전용으로 확인한다. 타 도메인의 정상 V1/V2를 오판하지 않는다. 기존 적용 또는 불명확한 이력이 있으면 중단한다.
3. 적용 전 DB·이력의 복구 가능한 백업을 확보하고 격리 복원으로 확인한다. 실패하면 중단한다.
4. Git에 보존된 SQL blob의 SHA-256이 위 값과 같은지 확인한다.
5. 다음 설정으로 독립 V1만 명시 실행한다. Auth/Content migration을 선행 실행하지 않는다.

```java
Flyway.configure().dataSource(confirmedUrl, user, password)
    .locations("classpath:db/migration/worldstudio")
    .schemas("worldstudio").defaultSchema("worldstudio")
    .table("world_studio_schema_history")
    .load();
```

`migrate()` 후 `validate()` 및 재실행 추가 0건, 12개 테이블·유형·영역·관계·불변성 제약과 기존 데이터/이력 보존을 확인한다. `repair`, history 삭제, baseline, 서버 시작에 의한 DDL 자동 실행은 사용하지 않는다. 이 문서의 설정 예제는 자동 실행 코드가 아니다.

공유 DB에 지울 수 없는 불변 QA 기록을 만들지 않는다. 쓰기 QA는 분리된 일회용 DB에서 실행하고 통합 DB 구조 검사와 구분한다. 실제 적용 확인 전에는 ‘적용 완료’로 보고하지 않으며 HTTP API 구현은 별도 작업으로 남긴다.
