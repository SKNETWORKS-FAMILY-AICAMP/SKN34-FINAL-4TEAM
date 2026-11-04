# 독립 WorldStudio V1 배포 사전 확인

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
