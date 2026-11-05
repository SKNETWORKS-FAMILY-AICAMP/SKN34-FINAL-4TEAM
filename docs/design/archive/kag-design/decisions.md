> **보관 문서(2026-10-30):** KAG·lakeFS·Neo4j를 전제로 한 이전 설계안입니다. MVP는 [DEC-16](../../decisions.md#결정-목록)에서 MVP용 RDB 저장 방향을 검토하며, 새 설계는 [docs/design](../../design.md)에 있습니다. 이 문서는 비교·후속 검토용으로만 보관합니다.

# 결정 기록: STORYFORK 시스템 아키텍처

> 상위 문서: [시스템 아키텍처](design.md). 상태 표기는 [표기](design.md#표기)를 따릅니다.
> 아래 결정은 2026-10-28~29 설계 대화에서 사용자가 정한 것이며 모두 `채택`(사용자가 설계 중 잠정 채택, 팀 재검토 가능)입니다. 기존 `확정`·`합의`를 바꾸는 결정은 팀 재결정이 필요합니다. 이번 작업은 문서 작성만 했고 통합 시험은 실행하지 않았습니다([검증 과제](design.md#검증-과제)).

## 결정 목록

| ID | 결정 | 대체하는 기존 결정 | 근거 | 상세 |
|---|---|---|---|---|
| DEC-01 | 다섯 서비스로 분리: web, core-api, ai-service, kag-service, knowledge-service. 허용 호출 방향은 여섯 개뿐 | `확정` 세 서비스 유지([AGENTS.md](../../../../AGENTS.md), [usecase.md 6.3절](../../../../docs/usecase.md#63-서비스-책임)) | 세계관 정본·범위 집행과 그래프 추론이 저장 모델·규칙·기술 스택에서 Core·AI와 다름. 사용자 "일단 분리로 확정하자" | [design.md 허용 호출 방향](design.md#허용-호출-방향) |
| DEC-02 | 세계관 정본 저장을 Gitea에서 lakeFS로. 세계관 하나 = 저장소 하나, 항목 하나 = Markdown 파일 하나, 커밋 ID로 Fork 고정 | `확정` Gitea 세계관당 저장소 하나([usecase.md 6.2절](../../../../docs/usecase.md#62-확정된-정책과-기술-결정) 저장), `합의` Gitea([architecture.md](../../../../docs/architecture.md)) | 커밋 경로 읽기 전용·과거 버전 읽기를 시험으로 확인(R-03). S3 호환 객체 저장소 위에서 동작 | [knowledge-service 버전 모델](services/knowledge-service.md#세계관-버전-모델) |
| DEC-03 | 업무 DB·knowledge DB·lakeFS 메타데이터에 PostgreSQL. 인스턴스 배치는 DEC-13 | `미정` 업무 DB 제품(D-01) | lakeFS 운영 요구(PostgreSQL 11 이상)와 같은 제품으로 운영 대상을 줄임 | [인프라 PostgreSQL 배치](services/infrastructure.md#postgresql-배치) |
| DEC-04 | Neo4j Community를 파생 그래프 색인으로. 정본은 lakeFS + knowledge DB | — (기존 `제안`, 도입 시점 `미정` D-28) | 다단계 탐색·경로·벡터 검색. Community의 백업·RBAC 부재는 파생 색인이라 수용 | [knowledge-service 그래프 모델](services/knowledge-service.md#그래프-모델-neo4j-파생-색인) |
| DEC-05 | core-api를 유일한 인증·권한 판단 주체로. 하위 서비스는 Core가 비대칭 서명한 토큰(서비스·쓰기·범위)만 Core 공개키로 검증 | `미정` 세계관 권한 판단 주체(D-22), 내부 API 인증(D-06) | 판단을 한곳에 모으고, 요청마다 Core에 묻지 않아 역호출 금지를 지킴 | [design.md 공통 계약](design.md#공통-계약-인증토큰) |
| DEC-06 | knowledge-service를 OpenSPG 서버 대신 Kotlin·Spring Boot로 직접 구현. KAG가 쓰는 기능만 부분 호환 | `미정` knowledge-service 언어(D-29) | OpenSPG 서버의 인증 부재·JDK 8·MySQL 이식 규모(R-02) | [knowledge-service OpenSPG와의 관계](services/knowledge-service.md#openspg와의-관계-부분-호환) |
| DEC-07 | kag-service를 OpenSPG KAG 포크로 분리. ai-service 통합은 V-01 뒤 재판단 | `미정` OpenSPG KAG 재검토(D-30) | KAG 고정 의존성이 ai-service 스택과 함께 해석되지 않음(R-06). 사용자 "먼저 AI-service에서 하나로 합쳐도 가능한지 시도해 보고 정하자" | [kag-service](services/kag-service.md) |
| DEC-08 | 객체 저장소: 개발은 MinIO를 공식 소스 마지막 태그로 직접 빌드, 배포 실습은 AWS S3. 소유자별 인스턴스·버킷 분리는 DEC-13 | `합의` MinIO, `미정` 운영 배포(D-17 일부) | MinIO CE 이미지 배포 중단·유지보수 종료(R-05) | [인프라 객체 저장소](services/infrastructure.md#객체-저장소) |
| DEC-09 | 세계관 Fork·조합·장르 기본 복제는 lakeFS 브랜치가 아니라 새 저장소에 그 시점 이용자 노출 항목만 복사 | — (복제 규칙 `확정` BR-12는 유지) | 브랜치는 원본 이력을 공유해 비노출 항목이 이력에 남음 | [knowledge-service 세계관 복제](services/knowledge-service.md#세계관-복제) |
| DEC-10 | 임베딩 생성과 설정 추출 후보 생성은 kag-service. 그래프 쓰기 없이 후보만 반환 | `제안` ai-service `extractions` | 색인·질의에 같은 임베딩 모델을 쓰고, 지식 정렬을 그래프 읽기와 같은 곳에서 함 | [kag-service 제공 API](services/kag-service.md#제공-api) |
| DEC-11 | KGDSL 실행을 호환하지 않고 구조화 그래프 API로 대체. LLM의 Text2Cypher·쿼리 생성 금지 | — | 범위 조건 누락·쿼리 주입 위험(X-15) | [knowledge-service 범위 검색 API](services/knowledge-service.md#범위-검색-api) |
| DEC-12 | (2026-10-29) Langfuse v3 self-host 구성을 그대로 도입하고 의존 구성요소 Redis·ClickHouse를 추가. Redis·ClickHouse는 Langfuse 전용(Langfuse 소유)이며 core-api·ai-service·kag-service·knowledge-service는 접속하지 않음. 우리 서비스에 큐·worker를 두지 않는 원칙은 유지(Langfuse worker는 Langfuse 구성요소). 우리 서비스의 Redis 사용은 `미정`으로 D-10·D-11의 후보로만 기록. 운영 묶음의 배치는 DEC-14 | `확정` "Redis 두지 않음"(DP-08, [AGENTS.md](../../../../AGENTS.md) 변경 원칙 "DB·Redis·큐·worker·K8s·cloud 등 미래 인프라를 미리 추가하지 않는다", [architecture.md](../../../../docs/architecture.md) "DB·Redis·큐·worker… 없음") 일부 대체, 팀 재결정 필요. `미정` D-12 해소 | Langfuse v3 self-host가 Redis·ClickHouse를 요구(R-07). 사용자 "redis도 추가하면 추가하자" | [인프라 Langfuse](services/infrastructure.md#langfuse) |
| DEC-13 | (2026-10-29) 업무 DB와 개발 객체 저장소를 정본 소유 도메인마다 별도 인스턴스로 나눔. PostgreSQL은 core-postgres(core DB, core-api 전용), knowledge-postgres(knowledge DB와 lakeFS 메타데이터 DB. 둘 다 knowledge 도메인 소유라 한 인스턴스에 DB·계정 분리, `제안`), langfuse-postgres(Langfuse 전용, DEC-14). 개발 객체 저장소는 core용(원고 이미지)·knowledge용(lakeFS 블록 저장)·Langfuse용 인스턴스로, 배포 실습은 AWS S3 소유자별 버킷과 서비스별 IAM으로 둠. 서비스 사이 FK 없음·다른 서비스 DB 직접 접근 금지는 유지. 스키마 마이그레이션은 core-api·knowledge-service 모두 Flyway이며 버전 파일은 각 서비스 안에 두고 다른 서비스 스키마를 건드리지 않음. lakeFS·Langfuse는 자체 마이그레이션 | `제안` PostgreSQL 인스턴스 하나에 DB 분리·개발 MinIO 하나에 버킷 분리(X-18). `미정` D-01(마이그레이션 도구)·D-34(개발 네트워크 배치) 해소 | GovBiz의 서비스별 DB 인스턴스·FK 없음·서비스별 마이그레이션 방식(R-08). 사용자 "우리 이 방식 그대로 적용하자". DB 제품은 PostgreSQL 유지(DEC-03)하고 방식만 적용 | [인프라 PostgreSQL 배치](services/infrastructure.md#postgresql-배치) |
| DEC-14 | (2026-10-29) Langfuse 운영 묶음을 업무 Compose와 분리한 별도 Compose 프로젝트(가칭 llmops)로 둠. 구성은 Langfuse web·worker, 전용 PostgreSQL, ClickHouse(단일 노드, 컨테이너 메모리 상한과 서버 메모리 상한·mark 캐시 설정 파일. 개발 출발값 3g·2GiB·128MiB는 GovBiz 값이며 운영 기준값이 아님), 전용 Redis(비밀번호 필수, noeviction), 전용 blob 저장소(이벤트·미디어). 텔레메트리 끔, 모든 이미지 digest 고정, 호스트 포트는 Langfuse 화면만 `127.0.0.1`, 비밀값은 루트 `.env`에서 Langfuse 런타임에만 전달. 필요할 때만 켬. ai-service·kag-service → 수집 엔드포인트 연결은 external 네트워크 공유 또는 호스트 경유 중 `미정`(D-40) | `제안` 같은 Compose 안의 langfuse-ingest 내부 네트워크. `미정` D-40 중 PostgreSQL 배치·blob 버킷·ClickHouse 자원 설정 해소 | GovBiz LLMOps 별도 Compose 구성(R-08). DEC-12의 구성요소는 그대로 두고 배치·운영 방식만 정함 | [인프라 Langfuse](services/infrastructure.md#langfuse) |
| DEC-15 | (2026-10-29) ai-service·kag-service 공통 추적 규칙. Langfuse SDK + OTEL, 내보낼 span 이름 허용 목록, 마스킹(입력·출력 본문 속성과 예외 속성 제거, 사용량 유지. 범위 토큰·원고 원문·작가 비공개 설정·개인정보·비밀값은 어떤 속성에도 넣지 않음), W3C `traceparent`를 core-api → ai-service → kag-service로 전달(형식만 검증해 부모로 연결, baggage·임의 속성 미수용), 짧은 전송 시간 제한(GovBiz 2초). 전송 실패는 작업 결과를 바꾸지 않고, 숨기지도 않고 서비스 로그·운영 지표에 남김. kag-service의 KAG 자체 LLM 호출도 같은 규칙으로 계측 | `제안` 상관 ID(형식 미정)를 W3C `traceparent`로 구체화. `확정` 메타데이터만 기록 원칙은 유지 | GovBiz `tracing.py` 방식(R-08) | [design.md 공통 계약: 관측성](design.md#공통-계약-관측성) |

## 검토 후 제외한 대안

| ID | 대안 | 제외 이유 | 관련 결정 |
|---|---|---|---|
| X-01 | Gitea 유지 + Neo4j 파생 색인 | 저장소가 셋(Gitea·DB·Neo4j)으로 늘고, DB의 회차 기록이 Gitea 안 항목을 외래 키로 참조할 수 없음 | DEC-02 |
| X-02 | Neo4j를 정본으로 | Community에 온라인 백업이 없고, 버전 규칙(커밋 불변·유효 구간·시점 재현)을 직접 보장해야 함 | DEC-04 |
| X-03 | PostgreSQL 버전 테이블만(그래프 DB 없음) | 다단계 탐색·경로·벡터 검색 같은 그래프 도구를 쓸 수 없음. Neo4j 없이 시작하는 **단계적 대안으로는 유효** | DEC-04 |
| X-04 | Apache AGE | 사용자 결정으로 제외 | DEC-04 |
| X-05 | TerminusDB·Fluree(버전형 그래프 DB) | 확정 결정을 바꾸는 폭이 크고 생태계가 작음 | DEC-02 |
| X-06 | Memgraph | 대안으로 기록만. Neo4j보다 나은 점을 확인하지 못함 | DEC-04 |
| X-07 | FalkorDB | Redis 기반. 우리 그래프 저장소로 Redis 기반 DB를 쓸 이유가 없고, Langfuse 전용 Redis(DEC-12)와 섞지 않음 | DEC-04 |
| X-08 | Kùzu | 2025-10 저장소 보관 처리로 유지보수 불확실 | DEC-04 |
| X-09 | Amazon Neptune | 관리형 클라우드. 로컬 개발 구성과 맞지 않고 클라우드 관리형 서비스를 전제하지 않음 | DEC-04 |
| X-10 | OpenSPG 전체 스택 그대로 | 자체 서버 묶음을 함께 운영해야 함. LLM builder가 지식 저장소에 직접 씀(BR-01 위반). 회차·인물·커밋 범위 규칙을 지원하지 않음 | DEC-06, DEC-07 |
| X-11 | openspg-server 포크 유지 | 인증이 없음(`writerGraph`가 클라이언트의 고정 토큰 `"openspg@8380255d4e49_"`을 검사하지 않고 인증 인터셉터도 없음). JDK 8. Pemja(JVM 안 Python 실행)는 스케줄러 빌드 작업에서만 쓰임. 공식 이미지가 알리바바 내부 주소·Aliyun 레지스트리에 의존. MySQL → PostgreSQL 이식 규모가 큼(매퍼 28개·8,136줄, `LIMIT a,b` 15곳, `LAST_INSERT_ID` 22곳/19파일, DDL 테이블 24개 + 10개) | DEC-06 |
| X-12 | openspg-server를 core-api에 합치기 | 기술 스택 충돌(JDK 8 대 JDK 21·Spring Boot 4.1). 검색을 Core가 하면 ai-service → Core 역호출이 필요 | DEC-06 |
| X-13 | KAG를 knowledge-service 안 Python으로 | 데이터 주인에 LLM이 섞임. knowledge-service의 "LLM 미사용" 경계가 깨짐 | DEC-07 |
| X-14 | Neo4j VIEW·RBAC로 범위 집행 | 요청마다 다른 범위(커밋·회차·인물)를 표현할 수 없고 Community에는 RBAC가 없음. PostgreSQL RLS는 표현은 가능하지만 그래프 조회를 덮지 못하고 집행 경계가 DB와 서비스로 나뉨 | DEC-05, DEC-11 |
| X-15 | LLM Text2Cypher(GraphCypherQAChain류) | LLM이 만든 쿼리가 범위 조건을 빠뜨릴 수 있고 쿼리 주입 위험 | DEC-11 |
| X-16 | 세계관마다 Neo4j DB·라벨 | 세계관 수만큼 DB를 운영할 수 없고 라벨이 폭증 | DEC-04 |
| X-17 | lakeFS 브랜치로 세계관 Fork | 브랜치는 원본 이력을 공유하므로 비노출 항목이 이력으로 노출 | DEC-09 |
| X-18 | PostgreSQL 인스턴스 하나와 개발 MinIO 하나를 core-api·knowledge-service·lakeFS·Langfuse가 함께 쓰고 DB·버킷·계정으로만 분리 | 소유 격리가 계정 설정에만 달림. 공유 인스턴스를 knowledge-internal에 두면 core-api가 닿지 못하고, core-api를 붙이면 Neo4j·lakeFS까지 닿는 네트워크 빈틈이 생김(이전 D-34). 분리하면 인스턴스마다 소유자의 내부 네트워크에만 연결됨. 대신 컨테이너 수와 개발 머신 메모리가 늘어남 | DEC-13 |

## 조사·시험 근거

### R-01 KAG 소스 조사

- **대상:** [OpenSPG KAG](https://github.com/OpenSPG/KAG), Apache 2.0, 조사 시점 마지막 커밋 2026-01-28. 코드 판독 기반이며 실행하지 않았습니다.
- **검색 관문:** 그래프·검색 접근이 `GraphApiABC`·`SearchApiABC` 두 인터페이스를 지납니다. 기본 구현 이름 `"openspg_graph_api"`·`"openspg_search_api"`가 25곳에 하드코딩되어 있어, 이름을 바꾸기보다 그 이름에 등록된 구현을 교체하는 편이 수정 범위가 작습니다(K-01).
- **DSL 생성부:** `openspg_graph_api.py`, path_selection의 `path_utils.py`, `exact_one_hop_select.py` 세 곳이 KGDSL 문자열을 만들며, OpenSPG 전용 `rdf_expand()`를 씁니다(K-02).
- **스키마 의존:** 15개 파일이 OpenSPG 스키마 서버를 부릅니다(K-03). 프로젝트 설정은 `ProjectClient`로 가져옵니다(K-04). 진행 보고는 reasoner dialog report를 씁니다(K-05).
- **실패 은폐:** `execute_dsl` 실패 시 빈 `TableData` 반환, `get_entity_one_hop`의 예외 삼킴, KB 설정 초기화 실패를 로그만 남기고 계속 진행(K-06).
- **전역 설정:** `main_solver.qa()`가 `KAG_PROJECT_CONF`·`KAG_CONFIG` 전역값을 요청마다 덮어씁니다. 동시 요청에서 설정이 섞일 수 있습니다(K-07).
- **쿼리 삽입:** LLM이 만든 타입명(`un_std_entity_type`)이 쿼리에 그대로 끼워집니다(K-08).
- **기타:** 사용량은 `openai_client`의 `token_meter`로 셀 수 있습니다(K-12). 질문에 한자가 있으면 zh, 없으면 en으로 처리합니다(K-13). 쓰지 않는 SDK(dashscope, ollama, pyodps, aliyun-log, mcp)가 의존성에 있습니다(K-10).

### R-02 OpenSPG 소스 조사

- **대상:** [OpenSPG](https://github.com/OpenSPG/openspg), Apache 2.0, 조사 시점 마지막 커밋 2025-06-29. 코드 판독 기반이며 실행하지 않았습니다.
- **인증:** `writerGraph`가 클라이언트가 보내는 고정 토큰 `"openspg@8380255d4e49_"`을 서버에서 검사하지 않고, 인증 인터셉터가 없습니다.
- **런타임:** JDK 8. Pemja로 JVM 안에서 Python을 실행하는 부분은 스케줄러 빌드 작업에서만 쓰입니다.
- **이미지:** 공식 이미지가 알리바바 내부 주소와 Aliyun 레지스트리에 의존합니다.
- **MySQL 이식 규모(PostgreSQL로 옮길 경우):** 매퍼 28개·8,136줄, `LIMIT a,b` 15곳, `LAST_INSERT_ID` 22곳(19파일), DDL 테이블 24개 + 10개.
- **KAG가 부르는 서버 기능:** 스키마 조회, 노드 조회(`query_node`), 텍스트·벡터 검색, KGDSL 실행(`reason/run`). 이 중 앞의 셋만 knowledge-service가 의미 호환으로 제공합니다(DEC-06, DEC-11).

### R-03 lakeFS 1.88.0 S3 게이트웨이 시험

- **환경:** `/tmp`에서 lakeFS 1.88.0을 띄우고 Python MinIO SDK 7.2.20으로 S3 게이트웨이를 시험했습니다. 저장소에는 흔적이 없습니다.
- **성공:** 버킷 존재 확인(`bucketExists`), 객체 읽기(`get`), 메타데이터 조회(`stat`), 목록(`list`), 삭제(`remove`), presigned GET, `main/` 접두 경로 쓰기(`put`), 커밋 ID 경로로 과거 버전 읽기.
- **실패·미지원:** 브랜치 접두 없는 키(NoSuchBucket), 버킷 생성(`makeBucket`, 501), 버킷 정책 설정(`setBucketPolicy`) 미지원, 커밋 ID 경로 쓰기 거부.
- **설계 반영:** 저장소는 lakeFS API로 미리 만들고, 쓰기는 `main/` 접두로만, 과거 시점은 커밋 ID 경로로 읽습니다. 커밋 경로 쓰기 거부는 커밋 불변(Property 24)의 근거입니다.
- **한계:** Python SDK로 재현한 결과라 knowledge-service가 쓸 JVM SDK와 동작이 완전히 같다고 보장할 수 없습니다(V-03).

### R-04 lakeFS 라이선스

- lakeFS는 1.87.0부터 Apache 2.0에서 Business Source License 1.1로 바뀌었습니다([lakeFS FAQ](https://docs.lakefs.io/resources/faq/), [lakeFS 커밋 기록](https://github.com/treeverse/lakefs/commits)).
- 운영이 아닌 사용(개발·테스트·학습·시연)은 수정 포함 허용입니다. 운영 사용은 ① 수정하지 않은 원본, ② 조직 내부 목적·외부에 기능을 제공하지 않을 때 허용됩니다(설계 대화 중 조항 요약).
- 실제 사용자 서비스로 바꿀 때 공식 BSL 안내, 1.87.0 이전 Apache 2.0 버전, 상용 문의 중에서 다시 확인합니다(D-35). 법률 판단이 아닙니다.

### R-05 MinIO CE 상태

- MinIO Community Edition은 2025-10 바이너리·Docker 이미지 배포를 멈췄습니다([It's FOSS 보도](https://itsfoss.com/news/minio-moves-away-from-open-source/)).
- 2026-02 저장소 상태가 "더 이상 유지보수하지 않음"으로 바뀌고 보관 처리됐습니다. 보관 일자는 출처마다 차이가 있습니다([Vonng 블로그](https://blog.vonng.com/en/db/minio-resurrect/)).
- 2026-09 Docker Hub의 `minio/minio` 저장소 삭제가 보고됐습니다([grafana/mimir 이슈](https://github.com/grafana/mimir/issues/16608)).
- 라이선스는 AGPLv3입니다. 보안 패치가 없으므로 개발 전용으로만 쓰고 공식 소스의 마지막 태그를 직접 빌드합니다(DEC-08, D-36).

### R-06 KAG 의존성 해석

`/tmp`에서 의존성 해석만 했습니다(설치·실행은 하지 않음). 저장소에는 흔적이 없습니다.

| 조합 | 결과 |
|---|---|
| ai-service 스택 단독 | 66개 패키지로 해석 성공 |
| KAG 단독(원본 고정 버전) | 144개 패키지로 해석 성공 |
| 함께, KAG 고정 그대로 | 실패. 예: `langchain-openai>=1.5.0`이 `certifi>=2024.6.2`를 요구하지만 KAG는 `certifi==2023.11.17` |
| 함께, KAG 고정 해제 | 188개 패키지로 해석 성공. 20개 버전 변경 |

주요 버전 변경: `urllib3` 1.26.16→2.8.0, `python-dateutil` 2.8.2→3.0.0, `cachetools` 5.3.2→7.2.7, `protobuf` 3.20.1→5.29.6(관련 `arks_pb2.py`는 사용처 없음), `mcp` 1.6.0→2.3.0(MCP 파이프라인은 미사용), `networkx` 3.1→3.6.1, `nltk` 3.8.1→3.10.4 등.

- 분리(DEC-07)하면 KAG 고정 버전을 그대로 쓸 수 있어 업그레이드가 필요 없습니다.
- 통합(V-01 (a))하면 고정을 풀어야 하고, 해석 성공은 실행 보장이 아니므로 KAG 테스트를 실행해야 합니다.

### R-07 Langfuse self-host 구성

이번 문서 작성 중 확인했습니다(2026-10-29). Langfuse v3 self-host는 web·worker 컨테이너와 함께 PostgreSQL, ClickHouse, Redis, S3 호환 blob 저장소를 씁니다([Langfuse v2→v3 업그레이드 안내](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v2-to-v3), [Langfuse self-host 개요](https://langfuse.com/docs/deployment/v3/overview)). "Redis 없음"(`확정`)과의 관계를 다루던 D-12는 DEC-12로 해소했습니다.

DEC-12를 기록하면서 [Langfuse self-host 안내](https://langfuse.com/self-hosting)를 다시 확인했습니다. 문서 버전 표시는 v4였고 구성은 같습니다. 각 구성요소의 역할은 web(화면·API), worker(수신 이벤트 비동기 처리), PostgreSQL(트랜잭션 데이터), Redis 또는 Valkey(캐시·작업 큐), ClickHouse(추적·관측·점수 저장), S3 호환 blob 저장소(수신 이벤트·첨부 보관)입니다. 도입할 Langfuse 버전과 라이선스는 도입 때 확인합니다(내용은 요약·재구성).

### R-08 GovBiz 참고 프로젝트의 DB·Langfuse 운영 방식

- **대상:** 같은 부트캠프의 참고 프로젝트 GovBiz([SKN34-4th-1Team](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-4th-1Team)), 조사 시점 마지막 커밋 `a07e8d1`(2026-10-22). 2026-10-29 `/tmp`에 받아 코드·문서를 읽었고 실행하지 않았습니다. 저장소에는 흔적이 없습니다.
- **업무 DB:** 서비스마다 별도 MySQL 8.4 인스턴스를 둡니다(core `mysql`·DB `govbiz`, catalog `catalog-mysql`·`govbiz_catalog`, ops `ops-mysql`). utf8mb4를 쓰고, 서비스 사이 FK가 없으며, 다른 서비스 DB에 직접 접근하지 않습니다. 마이그레이션은 core·catalog가 Flyway(파일 64개·3개), ops가 Django 마이그레이션(31개)입니다. 근거 파일: `README.md` 6.1절, `infrastructure/compose.yaml`, `infrastructure/compose.catalog.yaml`, `backend/ops-service/compose.yaml`.
- **LLMOps:** 업무와 분리한 별도 Compose 프로젝트입니다(`infrastructure/llmops/compose.yaml`).
  - Langfuse web·worker 4.46.0(이미지 digest 고정), Langfuse 전용 PostgreSQL 17.
  - ClickHouse 25.12: 사용자 101:101, `mem_limit` 3g, `restart` on-failure:3, `CLICKHOUSE_CLUSTER_ENABLED=false` 단일 노드, 호스트 포트 없음. `clickhouse-memory.xml`로 서버 메모리 상한 2GiB·mark 캐시 128MiB를 두며, 파일 주석상 작은 로컬 데이터용이고 운영 기준값이 아닙니다. 스키마는 Langfuse가 시작할 때 마이그레이션합니다.
  - Langfuse 전용 Redis 7.4(`requirepass`, `maxmemory-policy noeviction`).
  - blob 저장소 `cgr.dev/chainguard/minio:latest`(digest 고정). 버킷 하나에 이벤트(`events/`)·미디어(`media/`) 경로를 나눕니다.
  - 비밀값은 초기화 스크립트(`init_env.py`)가 만듭니다. `TELEMETRY_ENABLED=false`. Langfuse 화면은 `127.0.0.1:13000`에만 공개합니다. 업무 서비스는 ClickHouse에 접속하지 않습니다. 같은 파일의 평가 도구(Prefect)는 이번 결정 범위가 아닙니다.
- **추적 방식:** `backend/ai-service/app/tracing.py`(`langfuse==4.15.6`). OTEL 기반이며 내보낼 span 이름을 허용 목록으로 거릅니다. 마스킹은 이름에 `input`·`output`이 들어간 속성(`usage` 포함 키 제외)과 `exception.` 속성을 지워 본문 없는 기록을 남깁니다. Core가 내부 HTTP로 W3C `traceparent`를 넘기면 AI가 형식만 검증해 부모로 연결하고, baggage·임의 속성은 받지 않습니다. 전송 시간 제한은 2초입니다.
- **배포(EKS):** 관리형 DB 없이 저장소마다 StatefulSet과 EBS gp3 PVC를 쓰고, 백업은 암호화해 S3에 보관합니다(`infrastructure/eks/`). 우리 범위 밖이라 참고로만 기록합니다.
- **적용하지 않은 것:** 업무 Redis·RabbitMQ·Elasticsearch·Qdrant는 이번 결정 범위가 아닙니다.
- **설계 반영:** DEC-13(인스턴스 분리·Flyway), DEC-14(llmops 별도 프로젝트), DEC-15(추적 규칙). 같게 한 것과 다르게 한 것은 [인프라 GovBiz 대비 차이](services/infrastructure.md#govbiz-대비-차이)에 있습니다.
- **한계:** 코드·문서 판독만 했습니다. Langfuse 4.46.0과 ClickHouse 설정값의 실제 동작, Chainguard 무료 이미지의 이용 조건·버전 고정 방식은 확인하지 않았습니다. GovBiz는 MySQL을 쓰므로 문자셋 설정 같은 DB 제품별 설정은 옮기지 않습니다.

### 근거의 한계

- KAG·OpenSPG는 실행하지 않았습니다. R-01·R-02는 코드 판독 결과입니다.
- GovBiz 조사(R-08)는 코드·문서 판독이며 실행하지 않았습니다.
- lakeFS 시험(R-03)과 의존성 해석(R-06)은 `/tmp`에서 했고 저장소에 흔적이 없습니다. lakeFS 시험은 Python MinIO SDK 7.2.20으로 했으므로 Java SDK와 동작이 완전히 같다고 보장할 수 없습니다.
- 라이선스 요약(R-04·R-05)은 설계 판단용이며 법률 판단이 아닙니다.
- 외부 출처의 내용은 요약·재구성했습니다(원문 인용 아님).

## 검증 과제와 판단 기준

| ID | 과제 | 이 기록과의 관계 |
|---|---|---|
| V-01 | ai-service 통합 시험: (a) KAG 포크를 ai-service 패키지로 포함, (b) ai-service에서 LangGraph로 KAG 방식 직접 구현(계획 노드 → knowledge-service 범위 검색 도구 → 판단 노드, KAG 프롬프트·검색 조합 참고, Apache 2.0 고지) | (a)는 R-06의 의존성 충돌을 풀어야 함. 성공하면 DEC-07을 바꿔 kag-service를 ai-service로 통합, 아니면 분리 유지. 어느 쪽이든 knowledge-service 범위 API는 재사용 |
| V-02 | knowledge-service 묶음 검색 API로 KAG 기본 파이프라인 하나가 동작하는지 | DEC-06·DEC-11의 부분 호환 범위가 충분한지 확인 |
| V-03 | lakeFS 파일 형식·커밋 단위·저장소 수 규모, JVM SDK로 S3 게이트웨이 재확인 | DEC-02, R-03의 한계 |
| V-04 | 섹션 단위 공개 표시 방식이 KAG 검색과 맞물리는지 | D-25, knowledge-service 그래프 모델 |

**V-01 판단 기준:** 표본 세계관 질문(다단계·범위 제한)의 근거 정확도, 한국어 품질, 지연, 사용량 계측 가능 여부, 고장 수·수정량. 표본 세계관·질문 구성과 통과 기준 값은 `미정`입니다. 비교 결과와 결정은 이 문서에 새 DEC 항목으로 남깁니다.
