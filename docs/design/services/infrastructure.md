# 인프라 설계 — PostgreSQL·관계 그래프 기반 MVP

[메인 README](../../../README.md) · [문서 목록](../../README.md)

> [상위 설계](../design.md) · [결정 기록](../decisions.md#결정-목록)(특히 DEC-41). 이 문서는 **목표 방향**이며 설치·운영·검증 완료가 아닙니다. 이전 [KAG 기반 구성](../archive/kag-design/services/infrastructure.md)은 현행 MVP가 아닙니다.

## 현재와 MVP 방향

현재 소스는 `web`·`core-api`·`content-service`·`ai-service`와 독립 운영 골격입니다([현재 아키텍처](../../architecture.md)). Core는 Auth·Health, Content는 이전된 콘텐츠·첨부·WorldStudio를 소유합니다. #132는 Neo4j 현재 관계 정본·Content HTTP/UI 연결과 opt-in 검증 구성을 추가합니다. 소스 구현과 hosted CI·실제 DB 이관·배포 완료를 구분하며 기존 SQL·데이터를 유지합니다.

| 대상 | MVP 역할 | 상태 |
|---|---|---|
| PostgreSQL | Core·콘텐츠·운영별 정본과 쓰기 범위 분리. 서버 공동 사용 출발안 | 인증·선택 콘텐츠/첨부 저장 적용. 스키마/논리 DB·계정 권한·소유 전환 미정 |
| Flyway | 각 소유 서비스의 PostgreSQL 스키마·이력 관리 | 현행 Auth·Content·Attachment migration 적용. checksum·식별자·기존 이력 보존, writer/소유 전환은 후속 설계 |
| 관계 그래프 DB | Neo4j 현재 관계 내용의 유일 정본. 문서·원고 전문/관계 이력은 두지 않음 | #132 Content Java Driver·HTTP/UI·격리 CI와 opt-in Compose 소스 구현. 실제 이관·hosted CI·운영 배치/백업 검증 대기 |
| Gitea | 별도 Git 콘텐츠 저장소 | 사용하지 않음(DEC-27) |
| `pg_git` (`seanwevans/pg_git`) | MVP 이후 PostgreSQL 확장 도입을 신중히 추진 | **MVP 미적용**. 실제 포크·설치·개발은 아직 안 함; 재사용 범위·격리 방식 검토(DEC-27·30) |
| MinIO(S3 호환) | 설정 이미지 파일 보관. RDB에는 URL 저장 | 설정·표지·회차 첨부 선택 구현 존재. 추가 배포·접근·정리 계약은 별도 |
| KAG·pgvector | 이전 MVP 이후 또는 범위 밖 항목 | 이번 결정으로 추가하지 않음 |
| Langfuse | 운영 영역 LLMOps, 도입 시 별도 제품 배포 | MVP 이후 유지. 자체 UI/API 통합·평가 실행 계약 미정, Spring Boot 재구현 아님 |
| SMTP | 현재 인증·복구·이메일 변경 | 로컬 구성 존재, 운영 제공사 미정. 옛 MVP 제외를 미구현으로 읽지 않음 |
| Celery | AI 서비스의 회차 원고 전처리 작업 실행(DEC-50). 브로커는 기존 RabbitMQ, worker 컨테이너 하나 추가 | **결정만 기록, 미구현.** [전처리 계약](../manuscript-preprocessing-contract.md) |

#132에서 **Neo4j**와 Content의 Java Driver를 사용하고 world/card/relation UUID로 연결합니다. PG prepare receipt → transaction 밖 Neo4j CAS → PG finalization이며 미완료는 원래 요청으로 재시도합니다. 관계는 현재 상태만 보관하므로 관계 이력·과거 시점 복원·관계 전체 체크포인트/Fork는 지원하지 않습니다. 이는 DEC-27·33의 관계만의 MVP 예외이며 기존 인물·설정·원고 버전과 SQL·데이터는 보존합니다. 별도 graph-service·큐·worker·outbox·분산 원자 transaction은 추가하지 않습니다. 실제 이관·운영 복구/백업은 별도 계약입니다([상세](../worldstudio-independent-schema.md#현재-관계-mvp-계약--132)).

## 네트워크와 비밀값

```text
브라우저 → Frontend → 단일 공개 진입점 (기존 nginx 확장 후보)
                        ├─ Core: 인증·크레딧·알림 → 자기 소유 PostgreSQL 범위
                        ├─ 콘텐츠 → 자기 소유 PostgreSQL·MinIO·관계 그래프
                        │    ├─ Core: 정산·알림 사건 등 합의된 공통 업무
                        │    └─ AI: 콘텐츠 생성·검토
                        └─ 운영 → 자기 소유 PostgreSQL 범위
                             ├─ Core/콘텐츠: 회원/콘텐츠 조치 적용 요청
                             └─ AI: 운영 검사·평가 (계약 미정)
AI → 허용 문맥 조회 (목표 콘텐츠 경유 도구 후보, 최종 경로 미정)
Langfuse → 도입 시 별도 제품 서비스 (운영 UI/API 통합 미정)
```

위는 목표 경계입니다. 현재 works/public works와 world-studios exact·하위 경로는 Content로, 나머지 `/api`는 Core로 연결합니다. 기존 쿠키·CSRF·응답과 내부 인증 endpoint 비공개 경계를 유지합니다. Core를 중앙 프록시로 만들지 않습니다. 콘텐츠 인가는 콘텐츠, 회원 인증은 Core, 운영 권한은 운영이 검사합니다. AI의 DB 조회 여부는 미정이며 자격 증명·정본 쓰기 권한을 승인하지 않습니다. DB·내부 API의 비공개 포트는 인증이 아닙니다(DEC-19). 분리 서비스 인증·키 배포·세션 폐기 전파, TLS·백업·운영 배포는 후속 계약입니다.

같은 PostgreSQL 서버라도 서비스별 쓰기·DB 권한·Flyway 이력을 분리합니다. 타 서비스 테이블 직접 UPDATE·공유 JPA 트랜잭션에 의존하지 않으며 HTTP 호출은 자동 원자적이지 않습니다. 기존 데이터·migration을 보존하고 writer 전환·호환 읽기·복구/롤백을 먼저 설계합니다. 정기 실행·중복 방지·트랜잭션·복구는 업무 소유 서비스, 감시·재실행 요청은 운영에 둡니다. 중앙 스케줄러·별도 Start 서버·공통 starter 라이브러리는 선제 도입하지 않습니다. 예외로 회차 원고 전처리는 AI 서비스의 Celery worker로 실행합니다(DEC-50).

환경 설정은 루트 `.env` 한 곳에서 관리하고 `.env.example`만 공유합니다. 실제 `.env`는 수정·공개하지 않으며, 사용할 모델 API 키는 AI 런타임에만 전달합니다. Neo4j 접속 설정은 Content에만 전달합니다. 소스 빌드 검증용 prod overlay의 `worldstudio` profile은 별도 volume·loopback Bolt만 제공하고 username `neo4j`/별도 password를 사용합니다. 이미지 전용 dev CD에 그래프 배포를 강제하지 않습니다.

## 검증 계획·미정

현재 관계 CAS·부분 실패/원래 요청 재시도·권한 밖 참조 차단과 카드 이력 not_recorded를 선택 단위 및 CI 통합 대상으로 둡니다. 로컬은 단위·설정 검사만 수행하며 DB/컨테이너·통합·E2E·백업 복구를 실행하지 않습니다. Neo4j/Java Driver 선택은 #132 소스 계약이고 실제 이관·운영 배치/백업·hosted CI는 대기입니다. 관계 이력·시점 복원·관계 전체 체크포인트/Fork 검증은 이번 MVP 지원 범위가 아닙니다.
