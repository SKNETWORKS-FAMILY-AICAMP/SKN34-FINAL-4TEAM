# 인프라 설계 — RDB 기반 MVP

> 상위 문서: [시스템 아키텍처](../design.md) · [결정 기록](../decisions.md). 이 문서는 **설계 초안**이며 구성요소의 설치·운영·검증을 뜻하지 않습니다. 기존 KAG 기반 구성은 [보관본](../archive/kag-design/services/infrastructure.md)에 있습니다.

## 현재와 MVP 구성

현재 Compose는 `web`·`core-api`·`ai-service` 세 서비스를 실행하며 DB가 없습니다. [현재 아키텍처](../../architecture.md)가 실행 상태의 기준입니다.

MVP에서 추가하는 구성요소는 **PostgreSQL 하나**이며, 스키마는 core-api 안의 **Flyway**로 관리합니다([DEC-17](../decisions.md#결정-목록)). 첫 업무 기능(계정 UC-22)을 구현할 때 함께 추가합니다.

| 대상 | 목적 | 상태 |
|---|---|---|
| PostgreSQL(core-postgres) | 세계관 항목·갱신 기록, 작품·원고·공개 범위·Fork, AI 작업, 댓글·제보 | `확정`(DEC-17), 미구현 |
| Flyway | core-api 안의 버전 파일로 스키마 변경 관리 | `확정`(DEC-17), 미구현 |
| SMTP·Mailpit | 이메일 인증·비밀번호 재설정 메일 | MVP 이후(DEC-22) |
| MinIO | 원고 이미지 저장 | MVP 이후. 원고 이미지를 MVP에서 뺌(`제안`) |
| Langfuse | AI 추적 | MVP 이후(DEC-18) |
| 내장 스케줄러 | 자율 연재·정기 작업 | MVP 이후(`제안`) |
| Elasticsearch | 공개 작품 검색 | 기존 MVP 제외. DB 검색 |
| Gitea·kag-service·knowledge-service·lakeFS·Neo4j | 이전 설계의 세계관 저장·추론 | 쓰지 않음(DEC-16·20) |

## PostgreSQL·Flyway

- core-postgres 인스턴스 하나에 core DB를 둡니다. 접속 계정은 core-api 전용이며 호스트 포트를 공개하지 않습니다.
- Flyway 버전 파일은 core-api 안에 두고 core-api 시작 시 적용합니다. 적용된 버전 파일은 고치지 않고 새 버전으로 변경합니다.
- 세계관 갱신 기록·Fork 복사·공개 범위 변경은 필요한 범위를 한 트랜잭션에 넣고 동시성·실패를 시험합니다.
- DB 접근 라이브러리(JPA 또는 JDBC 계열)와 테이블·인덱스는 첫 업무 기능 구현 때 정합니다.
- MVP에서는 pgvector 확장과 임베딩을 쓰지 않습니다(DEC-17).

## Langfuse (MVP 이후)

MVP에는 llmops 묶음(Langfuse web·worker, 전용 PostgreSQL·Redis·ClickHouse·blob)을 두지 않습니다([DEC-18](../decisions.md#결정-목록)). 도입할 때는 이전 초안의 구성(DEC-12·14)과 추적 규칙(DEC-15)을 [이전 결정 기록](../archive/kag-design/decisions.md#결정-목록)에서 참고하며, 원고 원문·비공개 설정·개인정보·비밀값을 보내지 않는 메타데이터 원칙은 그대로 둡니다.

## 네트워크·보안

```text
브라우저 → web → core-api → ai-service → OpenAI
                   │  ↑
                   │  └─ ai-service 도구의 내부 조회 호출 (/internal/v1, 읽기 전용)
                   └─ core-postgres (Flyway)
```

- 브라우저는 공개 Core API만 사용합니다. AI Service, core-postgres, Core 내부 조회 API는 호스트에 공개하지 않습니다. web의 Vite·nginx 프록시는 `/api`만 중계하고 `/internal`은 중계하지 않습니다.
- Core ↔ AI 내부 통신 인증은 MVP 이후입니다([DEC-19](../decisions.md#결정-목록)). 포트 비공개는 인증이 아니므로 로컬 검증 범위를 넘는 배포 전에 정합니다.
- Core DB 접속 정보는 Core 런타임에만, OpenAI 키는 AI 런타임에만 전달합니다. AI Service에는 Core 내부 주소만 전달합니다. `VITE_*`·브라우저 번들·이미지 build ARG에 비밀값을 넣지 않습니다.
- 개발 환경설정은 저장소 루트 `.env` 한 곳에서 관리하고 공유 설정은 `.env.example`만 둡니다. 실제 `.env`를 덮어쓰거나 커밋하지 않습니다. Compose는 루트에서 `--env-file .env`를 명시하고 네이티브 실행은 `infrastructure/scripts/run-native.py`의 서비스별 허용 설정만 전달합니다.
- 현재 Compose는 인증·TLS가 없는 로컬 검증용이며 인터넷 운영 배포가 아닙니다. 운영 호스팅·TLS·도메인·백업 정책은 별도 결정이 필요합니다.

## 백업·복구와 검증 계획

- **PostgreSQL:** 세계관 갱신 기록·Fork 복사본을 포함한 정본 백업과 복구를 실제 데이터로 시험합니다. 보관 정책은 `미정`입니다.
- **환경·보안:** 비밀값 주입 범위, 내부 조회 API 비공개 여부, 실제 AI 호출 여부를 나눠 검증합니다. 이 문서 작업에서는 서비스·인프라 시험을 실행하지 않았습니다.

## 미정

DB 접근 라이브러리, 백업 보관 정책, 운영 배포 조건은 `미정`입니다. MVP 이후 항목은 [상위 설계](../design.md#위험미정-사항)를 따릅니다.
