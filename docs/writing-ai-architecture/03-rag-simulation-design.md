# 7개 필수 기능 설계

모든 기능은 Content가 검증한 작품/Fork·판본·공개 범위에서 시작한다. Agent는 역할별 입력과 출력이 다른 **업무 기능**이며 역할마다 서버를 추가하지 않는다. 실제 RAG 공급자는 기능이 필요로 할 때 연결한다. [전체 구조](02-ai-architecture.md) · [검색 계약](07-retrieval-contract-and-mocks.md)

## 1. Story Context / Q&A

작품 정보 조회와 질문 응답을 담당한다. 이름·나이·현재 관계·특정 원문 같은 정확한 질문은 Content 정본/Neo4j 현재 관계에서 확인한다. 서사적 이유·회차 간 연결은 허용 원고 검색과, 구축된 뒤에는 Wiki의 사건 경로를 쓴다. 답변은 주장별 출처·판본·확인/추론/불명 상태를 표시한다. 질문에 필요한 자료가 없으면 모른다고 답한다. 조회만으로 정본을 변경하지 않는다.

## 2. Review Agent

| 단계 | 검사 대상 | 판단 기준 |
|---|---|---|
| Mechanical Review | 수치, 이름, 날짜, 중복 표현, 검증 가능한 맞춤법 규칙 | 원고 위치와 비교 대상이 확인된 경우만 확정 오류. 창작 문체·방언은 자동 오류로 만들지 않는다. |
| Semantic Review | 설정 충돌, 인물 지식, 감정 변화, 서사 인과관계, 복선 | 원고·설정·관계·사건의 판본과 근거를 대조한다. 사실 충돌, 해석 의심, 근거 부족을 구분한다. |

Mechanical만 요청하면 Semantic과 Simulation을 실행하지 않는다. Semantic에서도 인물의 행동과 반응을 **재현해야 할 때만** Simulation을 호출한다. 가상 반응은 오류의 확정 근거가 아니며 의심과 대안으로 제시한다. Finding에는 원문 위치, 검사 종류, 근거, 확정/의심/판단 불가, 제안이 담긴다. 수정은 별도 Editing 요청과 승인으로 이어진다.

## 3. Character Simulation Subgraph

한 인물의 행동을 만든 뒤 임시 상황을 갱신하고 다음 인물의 관찰·지식 입력을 다시 만든다. 한 번에 여러 인물의 행동을 생성하고 끝내지 않는다.

~~~mermaid
flowchart TD
  A[허용된 초기 상황과 인물별 지식] --> B[다음 인물 선택]
  B --> C[그 인물에게 보이는 상태만 투영]
  C --> D[OpenAI 행동 생성]
  D --> E{행동·한도 검증}
  E -->|유효| F[임시 상태 갱신]
  F --> G{목표·종료 조건}
  G -->|계속| B
  G -->|종료| H[가상 결과와 근거]
  E -->|실패| I[실패/부분 결과]
~~~

인물의 비밀과 미래 지식은 다른 인물의 입력에 들어가지 않는다. 턴·모델 호출·시간 한도를 요청 전에 고정하고, 무효 행동·취소·제공사 실패를 표시한다. 임시 세계 상태와 인물 기억은 작품 정본으로 저장하지 않는다. 처음에는 짧은 개발용 시나리오로 상태 갱신과 지식 격리를 실모델 검증한다.

## 4. Writing & Editing Agent

- **새 원고:** 목표 회차와 BeatPlan/콘티, 허용된 설정·직전 회차를 받아 새 소설 문장을 만든다. 출력은 생성 원문과 사용한 계획·근거다.
- **기존 원고 수정:** 대상 문서 판본, 선택 구간, 원문 해시, 수정 지시를 받아 그 구간의 before/after Patch를 만든다. 선택 밖 문장은 유지한다.

두 경로 모두 LLM을 쓰지만 입력·출력·저장 검증이 다르다. 문체/말투 변경도 기존 원고 수정이다. 결과 표시와 실제 원고 저장을 분리하고, Content가 최신 판본·선택 범위·승인 영수증을 확인한 뒤에만 반영한다.

## 5. Story Development Agent

앞으로의 전개를 계획한다. 인사이트, 콘티, 다음 화 사건·장면 순서를 BeatPlan으로 반환한다. “11화에 어떤 사건을 넣을까?”는 Development 결과로 끝난다. “그 계획으로 11화 원고를 써줘”는 Development 결과를 Writing에 전달한다. 예정 사건과 이미 확정된 사건을 혼동하지 않는다. 인물의 반응이 계획 판단에 필수일 때만 Simulation을 추가한다.

## 6. World & Plot Management

세계관 설정이나 플롯 변경 전에 관련 설정, 관계의 **현재 상태**, 영향받는 회차·장면·다른 플롯을 조회한다. ImpactReport에 영향 대상·판본·근거·확실성과 해결할 충돌을 먼저 보여준다. 그다음 검토 가능한 변경 후보를 만든다. 작가 승인 전 정본은 그대로다. Neo4j 관계와 PostgreSQL 문서를 한 원자 트랜잭션이라고 표시하지 않는다. 회차별 과거 관계가 필요하면 지원 불가를 반환한다.

## 7. 웹 조사 에이전트

작품의 현실성과 개연성을 확인할 외부 사실 질문을 만든 뒤 웹 검색으로 출처·발행/확인 시점·서로 다른 근거를 수집한다. 주장별로 확인/상충/미확인 결과와 작품의 해당 장면을 연결한다. 웹 문서를 작품 정본이나 인물 기억으로 승격하지 않는다. 검색 페이지의 프롬프트 인젝션을 지시로 실행하지 않고, 비공개 원고 전문은 검색어로 보내지 않는다. 검색 실패와 근거 부재를 명시하며 원고 수정은 Editing 후보와 승인 경로로 분리한다.

현재 구현(`backend/ai-service/app/research/`, `POST /internal/v1/research/web`): 입력은 `question`(≤500자)과 `context`(≤500자, 작가가 고른 맥락)다. 응답은 `searchedAt`(검색 시작 UTC), 주장별 `findings[{text, verdict: confirmed|conflicting|unverified, sourceUrls}]`, `gaps`다. 모델이 쓴 URL 중 실제 `web_search_call` 출처에 없는 것은 지우고, 근거 URL이 남지 않은 주장은 `unverified`로 내린다. 검색이 한 번도 완료되지 않으면 503, 모델 응답 형식 오류는 502다. 모델은 루트 `.env`의 `OPENAI_MODEL`을 쓴다. 2026-11-11 `gpt-6-luna`로 실제 호출 2회를 검증했다(조선 후기 한양–동래 이동: 실록·백과 출처 URL로 confirmed와 미확인 gaps, 18.9~34.2초 / 가공 인물 질문: 해당 주장 unverified·빈 출처와 gaps). Content 공개 API·화면 연결은 후속이다.

### MCP 도입 검토 — 미채택

| 목적 | 후보 | 확인할 사항 |
|---|---|---|
| 웹 검색·추출 | [Tavily](https://github.com/tavily-ai/tavily-mcp), [Brave Search](https://github.com/brave/brave-search-mcp-server), [Firecrawl](https://github.com/firecrawl/firecrawl-mcp-server) | 기존 OpenAI 웹 검색과 중복하므로 검색 품질·비용·전송 조건을 비교한다. |
| 공개 페이지 읽기 | [Fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch), [MediaWiki](https://github.com/ProfessionalWiki/MediaWiki-MCP-Server) | Fetch는 검색기가 아니다. 접근·이용 조건, 누락, 사설 주소·리다이렉트와 DNS 위험을 확인하고 위키는 읽기만 검토한다. |
| 논문·번역 | [research-mcp](https://github.com/404Simon/research-mcp), [arxiv-mcp-server](https://github.com/blazickjp/arxiv-mcp-server), [DeepL](https://github.com/DeepL/deepl-mcp-server) | 출처·원문 접근권과 번역 정확도를 확인한다. 프리프린트는 동료 심사 완료를 뜻하지 않는다. |
| 장소·날씨 | [Mapbox](https://github.com/mapbox/mcp-server), [OSM MCP](https://github.com/ni-c/osm-mcp), [Open-Meteo MCP](https://github.com/cyanheads/open-meteo-mcp-server) | 현행 지도는 과거 경로의 근거가 아니며 기상 재분석은 현장 관측과 구분한다. 위치 전송과 이용 조건을 확인한다. |

모두 후속 후보이며 현재 연결된 기능이 아니다. 실제 사용 사례가 생기면 기존 검색과 비교해 필요한 도구만 선택한다. 제공사·비용·보관·외부 전송과 동의 조건을 확인하고, 허용된 최소 맥락만 보낸다. URL·자료와 확인 시점·누락을 유지하며 외부 텍스트를 지시나 작품 정본으로 취급하지 않는다. 합성 자료로 품질·실패를 평가한 뒤 적용한다.
