# TASK 21 — 개발용 PostgreSQL 체크포인트

기본은 비활성이다. Content 업무/Flyway와 분리된 `langgraph` schema 후보만 사용한다.
운영 대상·계정·정책 채택은 미결이며 실제 운영 DB에 setup을 자동 실행하지 않는다.

## 버전·풀

| 항목 | 고정/검증 값 |
|---|---|
| Python | 프로젝트 >=3.11,<3.15, 로컬 3.11.15 검증 |
| LangGraph / checkpoint | 기존 1.2.12 / 4.3.1 유지 |
| 일반 AsyncPostgresSaver | langgraph-checkpoint-postgres 3.2.0, migrations 0~9 |
| Driver / pool | psycopg[binary,pool] 3.3.2 / psycopg-pool 3.3.3 |
| DB | 로컬 격리 PG 16.15 검증, CI는 job별 PG 17 |

기존 Python asyncpg/업무 풀이 없어 Saver의 psycopg 전용 풀을 사용한다.
모든 연결에 autocommit·dict_row·prepare_threshold=0과 `search_path=langgraph,pg_catalog`를 고정한다.
프로세스당 min=1/max=3, 연결/대기/SQL timeout 5초, lock timeout 1초다.
thread 잠금 슬롯은 2개로 제한해 Saver SQL용 연결 하나를 남긴다.
이 값은 개발 상한이다. worker 수×3을 전체 DB 연결 예산에 반영하기 전 운영에 활성화하지 않는다.

## 명시적인 관리 setup

1. 관리자는 schema 소유자와 별도 runtime 로그인 역할을 준비한다.
2. 루트 `.env`의 관리 URL을 관리 프로세스에만 주입한다.
3. AI 디렉터리에서 아래 고정 lock 명령을 직렬 실행한다.
4. runtime에 아래 최소 권한을 부여한다.
5. 관리 URL 없이 runtime 시작 검사를 확인한다.

```powershell
uv run --locked python -m app.runs.checkpoints setup
```

`AI_CHECKPOINT_ADMIN_DATABASE_URL`이 없으면 명령은 실패한다. 관리 연결에서만 schema 생성과
라이브러리 setup을 호출한다. session lock으로 직렬화하고 미래/구멍 난 migration은 거부한다.
Saver SQL을 업무 Flyway에 복사하지 않는다. 버전 변경 시 SQL/lock/권한/격리 회귀를 함께 검토한다.
관리 URL을 runtime 컨테이너에 전달하지 않는다. 이번에 실제 실행한 setup은 임시 테스트 클러스터뿐이다.

runtime은 schema/테이블/DB 소유자·superuser·CREATEDB·CREATEROLE·BYPASSRLS가 아니어야 한다.

```sql
GRANT USAGE ON SCHEMA langgraph TO langgraph_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  langgraph.checkpoints, langgraph.checkpoint_blobs, langgraph.checkpoint_writes
  TO langgraph_runtime;
GRANT SELECT ON langgraph.checkpoint_migrations TO langgraph_runtime;
```

모든 schema CREATE·DB CREATE/TEMP·다른 업무 테이블 권한·migration DML을 허용하지 않는다.
PUBLIC TEMP/CREATE는 역할별 REVOKE만으로 차단할 수 없다. 공유 DB 후보에서는 관리자가 PUBLIC 권한을
회수하고 필요한 Content 역할에 명시적으로 재부여할 수 있는지 먼저 조율해야 한다.
**runtime은 공유 DB의 PUBLIC 권한을 변경하지 않는다.** 조율할 수 없으면 별도 DB가 대안이다.
시작 검사는 현재 schema/search_path·실효 권한·필수 컬럼·migration 0~9를 조회만 하고,
하나라도 다르면 실패한다. runtime DDL/setup·메모리 fallback은 없다.

## 재개 계약

`AI_CHECKPOINT_DATABASE_URL`이 빈 값이면 기존 메모리 경로를 유지한다. 설정하면 FastAPI lifespan이
Saver를 app.state와 RunService에 주입한다. 종료는 실행 Task 회수→풀 close 순서다.
FixtureContent의 명시 주입 MainGraph는 인가된 동일 요청의 재전달에서 저장 유무에 따라 재개한다.
직접 호출은 `MainGraph(..., checkpointer=saver).run(original_request, resume=True)`다.
`ahistory(original_request)`는 새 wrapper에서도 현재 권한을 확인한 뒤 참조 이력만 반환한다.

물리 키는 기존 `thread_id:scope_digest:run_id`, 실행기 journal은 별도 `task_runner` namespace다.
session advisory lock은 Content thread 단위 동시 실행/복구를 막고 연결 종료 시 해제된다.
checkpoint에는 요청/한도의 SHA-256 binding과 manifest digest를 저장한다. 원 요청·grant는 저장하지 않는다.
동일한 원래 MainRequest/한도/판본이 필요하며 새 deadline을 만든 요청은 거부한다.
현재 grant 철회/만료·subject/work/Fork·판본·요청/한도 변경을 재검증한다. 문맥은 Content에서 다시 읽어
원래 digest와 대조한다. 이 읽기 검증은 반복할 수 있지만 완료한 Specialist/모델 Task는 반복하지 않는다.
새 run에는 이전 작업/비용을 복사하지 않는다.

Main 노드 경계는 sync durability다. dispatch 내부는 같은 Saver의 RunnerJournal에 완료 참조,
active attempt/lease·재시도·동적 계획·비용·원래 deadline을 저장한다. 모델 호출 전 예약 저장에 실패하면
호출하지 않는다. 결과 저장 전 중단된 active 작업은 `interrupted_outcome_unknown`으로 실패 처리하고
예약/usage_unknown을 유지한다. 자동 재호출·외부 제공사와의 exactly-once 실행은 보장하지 않는다.

JSON primitive 참조/상태만 저장하고 pickle fallback·임의 msgpack 모듈 복원을 허용하지 않는다.
messages는 최근 참조 최대 20개다. 원고/질문/생성 전문·provider key·grant·무제한 대화는 저장하지 않는다.
LangGraph가 자동 저장하는 노드 ERROR write도 원문 없는 graph_node_failed 코드로 제한한다.
전문 Agent의 결과 본문은 여전히 메모리 전용이다. 미완료 후속 작업에 본문이 필요하면 실제 참조 resolver
없이는 실패하며, 본문을 지어내거나 checkpoint에 복제하지 않는다.

## 미결

| 항목 | 이번 상태 / 필요한 결정 |
|---|---|
| 실제 Content 재개 | RemoteGrant 전문 Agent·원문/결과 참조 resolver 미연결. 실제 요청은 계속 dependency_unavailable |
| 자동 복구·인가 | Content 원 요청 재구성·lease/attempt 대조·자동 재전달 worker·grant 갱신 미구현 |
| 승인·적용 | 실제 HITL interrupt/Command·영수증은 후속 TASK. TASK 20 실제 적용 미완료 유지 |
| 보존·인증·삭제 | 암호화·DB 인증/열람 ACL·TTL·철회/탈퇴 삭제·blobs/writes/백업 삭제 기한 미결 |
| 운영 채택 | 권한 조율·연결 예산·PG17 hosted CI·복구/롤백 리허설 후 판단 |

권한 철회는 재개/이력 접근을 차단하지만 자동 물리 삭제는 하지 않는다. TTL을 임의로 확정하지 않았다.
추천은 운영 비활성과 참조 전용 상태를 유지하고 Content의 인가/삭제 계약을 먼저 확정하는 것이다.

## 격리 검증

`TEST_CHECKPOINT_ADMIN_DATABASE_URL`과 `TEST_CHECKPOINT_DISPOSABLE=true`의 명시적인 테스트 DB만 사용한다.
무작위 `langgraph_test_<12hex>` schema/role을 만들고 자신이 만든 것만 정리한다. PUBLIC TEMP 회수도
이 임시 DB에서만 한다. CI에서 환경이 없으면 실패, 로컬에서 없으면 skip(접속 없음)한다. 실제 `.env`는 읽지 않는다.
Windows psycopg async 검증은 테스트 프로세스에만 WindowsSelectorEventLoopPolicy를 설정한다.
Linux CI PG17과 로컬 PG16 결과는 구분한다. [명령·결과](../../../docs/writing-ai-architecture/task21-handoff.md).

근거: [Saver 3.2.0 공식 배포본](https://pypi.org/project/langgraph-checkpoint-postgres/3.2.0/),
[psycopg 3.3.2](https://pypi.org/project/psycopg/3.3.2/), 설치 wheel의 aio.py/base.py와
[기존 스키마 조사](../../../docs/design/erd/ai-service/postgres-saver.md).
