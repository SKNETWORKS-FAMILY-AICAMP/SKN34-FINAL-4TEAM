# 집필 AI 실연동 인수보고 · 2026-11-11

TASK 01~24 당시의 결과와 이 브랜치에서 실행 가능한 경로를 구분한다. 아래에서 **실연동**은 실제 클라이언트가 서비스 조립에 등록됐다는 뜻이다. 유료 모델 호출·공유 DB 접속·운영 배포를 검증했다는 뜻은 아니다.

| 판정 | 범위 | 근거와 제한 |
|---|---|---|
| 기존 실구현 | Content 소유권·Run 위임·멱등 접수, SSE·취소, 원고 제안 승인·불변 영수증, 집필 UI (10, 17, 22~24) | 기존 Content와 UI 흐름을 재사용한다. 승인 전 원고 저장 없음. 기존 이어쓰기 API도 같은 생성 모델을 사용한다. |
| 이번 실연동 | 작가 질문·부분 검수·전개 아이디어·선택 편집·차회 초안·콘티 확장 (01~05, 09~12, 15~19, 24) | 공개 UI의 네 작업은 `Content → RemoteGrant → run_live`로 실행한다. 실제 Run은 동의 범위 내 한 번의 생성 호출이다. 초안·편집은 Content가 결과를 확인할 때 변경안을 준비하고 사용자가 승인해야 저장된다. 이 경로는 합성 MainGraph의 복합 DAG 전체를 실행한 것이 아니다. |
| 이번 실연동 | WorldStudio Neo4j 현재 관계, Elasticsearch 원문 의미 검색, Langfuse RAG 추적 | 회차와 연결된 세계관만 읽고 현재 관계를 과거·인물의 지식으로 사용하지 않는다. 검색 결과는 현재 Content 원문에서 복원한다. 추적에 prompt·원문·생성문·키를 넣지 않는다. |
| 명시적 목업·제외 | 회차/세계관 위키 그래프(02~04), 템플릿 추천(13) | 위키는 fixture로만 유지한다. 실제 검색 실패 때 위키 목업으로 대체하지 않는다. 템플릿은 RAG 포트·근거·색인·검색 경로에서 제거했다. 독립 추천 대역은 공개 카탈로그/라이선스 정본을 대체하지 않는다. |
| 선행 개발 | 인물별 시뮬레이션(14), 전체 회차 검수·복합 초안(15~19), 세계관/플롯 쓰기(20), 실제 Run 복구(06~08, 21~23) | 인물별 허용 기억과 Wiki coverage, 설정/플롯 writer의 원자적 계약, 실 Run을 재구성할 영속 lease·결과 저장이 각각 필요하다. 합성 StateGraph·Saver·interrupt 테스트 성공을 이 기능의 실서비스 성공으로 세지 않는다. |

## 실제 요청 한 건의 흐름

1. Content가 소유권·thread·판본·동의·취소를 검사한다. `POST /internal/v1/ai/runs/{id}/retrieval`은 서비스 자격과 해당 Run의 위임이 모두 맞을 때만 읽을 수 있다.
2. 회차의 `basisWorldId`가 있으면 Content의 `WorldStudioService.draft`가 소유권, Neo4j 현재 graphVersion, 양 끝 카드를 검증한다. 현재 활성 관계의 카드명·라벨·내용만 작가 문맥에 넣는다. 봉인된 세계관의 관계 이력은 복원하지 않는다. 인물 관점·미선택 세계관에는 현재 관계를 넣지 않는다.
3. AI는 회차·문서·버전이 일치하는 허용 발췌를 나누고 Elasticsearch에 없는 구간만 생성한다. 검색은 현재 허용 ID 집합으로 제한하며 `_source`를 받아 모델에 전달하지 않는다. 반환 ID로 Content 본문·UTF-16 구간·SHA-256 인용을 복원한다. 권한 밖 ID, 타임아웃, 일부 색인 실패를 정상 0건으로 바꾸지 않는다.
4. 생성 직전·직후 Content의 원문/관계 digest를 다시 확인한다. Responses API는 `gpt-6-luna`, 자동 재시도 0, `store=false`다. 비용 동의 및 입력/출력 한도 안에서 호출한다. 일반 질문은 답변과 검색 근거, 검수는 확인한 범위만 `partial`로 돌려준다. 위키 없는 전체 연속성 보장은 없다.
5. Content가 실제 생성 결과로부터 작업에 허용된 연산만 만든다. 편집은 사용자가 지정한 UTF-16 선택 구간, 다음 초안은 기준 회차 다음의 새 회차다. 판·근거 hash가 달라지거나 대상 회차가 이미 있으면 적용하지 않는다. 모델이 원고·세계관·권한을 직접 쓰지 않는다.

## 적재 및 기동

- AI 런타임: 루트 환경의 `OPENAI_API_KEY`, `INTERNAL_TOKEN`, `CONTENT_AI_RUN_BASE_URL`(Compose에서 전달). Content에는 기존 서명 키 `AI_RUN_GRANT_SECRET`도 필요하다. 모델 환경변수로 모델을 바꿀 수 없다. [OpenAI 모델](https://developers.openai.com/api/docs/models/gpt-6-luna).
- Elasticsearch: `ELASTICSEARCH_URL`과 필요 시 `ELASTICSEARCH_API_KEY`를 지정한다. ES 9.x, ML 노드와 [다국어 E5 기본 endpoint](https://www.elastic.co/docs/explore-analyze/elastic-inference/inference-api), [semantic_text 지원 라이선스](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text)가 필요하다. 첫 적재에 모델 다운로드·메모리가 필요하다. 계정에 전용 인덱스 생성·읽기·create 권한을 부여한다. 인덱스명은 `storyfork-manuscript-e5-v1`이다.
- 로컬 선택 구성: 루트에서 `docker compose --profile rag up -d`를 사용한다. `ELASTICSEARCH_URL=http://elasticsearch:9200`이고 ES는 호스트 포트를 열지 않는다. 기본 Basic 라이선스는 E5 추론을 보장하지 않는다. 이미 허가받은 클러스터를 사용하거나 평가판 사용을 선택했다면 **새 로컬 볼륨의 최초 기동 전** `ELASTIC_LICENSE_TYPE=trial`을 지정한다. 기존 클러스터의 라이선스는 변경하지 않는다. dev/prod는 관리되는 ES URL·자격을 사용한다.
- 공개 발행본은 AI 서비스 기동 후 익명 Content 목록을 페이지 단위로 읽어 자동 적재하고, 한 바퀴가 끝나면 5분 뒤 반복한다. 작품·Fork·회차·버전·UTF-16 구간·본문 hash 기반 ID로 이미 있는 구간의 임베딩을 생략한다. 작가 문맥은 접근 때 허용 발췌만 보충한다. 초안/설정/현재 관계를 공개 목록 수집기가 적재하지 않는다. 공개 중단·삭제·판 교체 뒤 구 ID가 남아도 새 Run의 허용 집합에 없으면 조회할 수 없다. **ES 저장 데이터의 물리 삭제는 별도 보존 정책이 필요하다.**
- Langfuse: `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`를 같은 프로젝트 값으로 지정한다. [OTLP HTTP](https://langfuse.com/docs/observability/get-started)로 Content 조회, ES 적재·검색, OpenAI 생성 시간을 같은 trace로 보낸다. 미설정은 비활성, 부분 설정·수신 장애는 원문 없는 경고다. Langfuse 장애는 원고를 다시 생성할 이유가 아니다.

## 운영 전 확인할 것

| 항목 | 현재 경계 | 인수 기준 |
|---|---|---|
| 검색 품질·범위 | 공개 원문을 적재하지만, 현재 작가 Run에서 검색 가능한 범위는 Content가 선택한 기준 회차까지 최근 최대 3개 회차의 허용 발췌다. | 권리 확인된 한국어 corpus로 누락·오인용·recall과 응답 지연을 측정한다. 범위를 확대하려면 manifest·인용 resolver도 함께 확장한다. |
| 위키·시뮬레이션 | 과거 관계/인물의 비밀/전체 coverage를 현재 그래프로 추정하지 않는다. | 위키·knownBy의 실제 정본과 인가 계약을 먼저 준비한다. |
| 장애 복구 | 실제 Run 본문은 AI 프로세스 메모리에 있고 위임은 5분이다. 승인된 Content 영수증과 원고는 영속적이다. | 재시작 및 장시간 지난 답변 복원, 색인 보존·회수, 실제 백업/복구를 검증한다. |
| 실환경 | 운영 DB·실제 모델·사용자 원고를 사용하지 않은 단위 검증이다. | 격리 환경에서 실제 ES E5 적재와 검색, Neo4j 판본 변경, Langfuse trace 수신, UI 승인까지 각각 확인한다. |

검증 단위: AI `test_live_retrieval`, `test_remote_content`, `test_generation`, 라우팅·검색 계약·카탈로그·Run 서비스 회귀. Content `AiRunServiceTest`로 위임·취소·UTF-16 편집 후보와 기존 접수 계약을 검사한다. 당시 TASK 인수보고의 테스트 개수는 이 변경의 실측치가 아니다.


## 최종 검증

- AI: 변경 범위 단위 241개 통과, integration 2개 제외. 색인 동시 create의 refresh 경쟁 및 Content 응답 경계 검증을 포함한다.
- Content: `AiRunServiceTest` 22개와 `ChangeProposalServiceTest` 16개 통과. 총 38개, 실패/오류 0.
- CodeRabbit: 사용자에게 명시적 코드 전송 승인을 받은 뒤 `review --agent --uncommitted --include-untracked` 실행. `review_completed`, findings 0. 이후 보고서 보완·동시 색인 회귀·Content 응답 스키마 검증은 로컬 검토와 단위 테스트로 구분한다.
- Ponytail 자체 리뷰: 기존 Content 소유권·Neo4j CAS·제안 승인·단위 실행 환경을 재사용했다. 추가 production 패키지·lockfile 변경 없음. 현재 한 프로세스·시연 규모를 가정한다. 공개 목록 순회는 많은 작품을 다루는 작업 큐의 대체가 아니다.
- 실행 초기에는 asyncio loopback/Gradle 캐시 접근, JDK 17 기본 환경, 자동 승인 검토 일시 제한으로 실패/중단했다. 기존 저장소 JDK 21과 승인된 실행 환경에서 위 단위를 통과했다. 통합·브라우저·전체 빌드·실 제공사 검증은 수행하지 않았다.

명령: AI `.venv/Scripts/python.exe -m pytest -m 'not integration' tests/test_live_retrieval.py tests/test_remote_content.py tests/test_generation.py tests/test_routing.py tests/test_retrieval_contract.py tests/test_retrieval_coordinator.py tests/test_template_recommendation.py tests/test_mock_retrievers.py tests/test_run_service.py tests/test_remote_run_api.py --tb=short`.
Content `gradlew.bat unitTest --tests ai.storyfork.content.proposal.AiRunServiceTest --tests ai.storyfork.content.proposal.ChangeProposalServiceTest --offline` (저장소 JDK 21 사용).

상세 미구현 사유와 구현 순서·완료 기준은 [TASK 01~24 전체 판정](implementation-status.md)에 있다.

### PR CI에서 발견한 기존 테스트 계약 불일치

첫 실연동 커밋 `bd75d621`의 CI에서 AI 단위·통합은 통과했다. Content의 기존 `ProposalServiceTest`는 `publishedEpisodes` 대신 실제 호출되는 `nextEpisodeNumber`를 대역 설정해야 했다. 로컬 단위 실패를 재현한 뒤 수정해 1개 통과했다(위 38개와 별도). 웹 `writing-route`는 UUID 집필실의 기존 `RequireRole` 로그인 전환과 달리 서버 오류 alert를 기대했다. 현재 인증 계약에 맞춰 로그인 화면과 미인증 콘텐츠 요청 차단을 검증하도록 수정했으며 통합 재실행은 CI에 맡긴다. 제품 인증·승인 로직은 변경하지 않았다.
