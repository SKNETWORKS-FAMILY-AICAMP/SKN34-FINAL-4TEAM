# 전체 RAG 검색 계약과 단계적 구현

RAG 목표는 **현재 관계 Graph + 회차 Wiki Graph + 원고 Vector + 템플릿 Vector**다. 네 공급자는 같을 필요가 없지만, 결과는 같은 권한 범위와 출처 규약으로 읽힌다. 구현 순서는 [로드맵](05-implementation-roadmap.md)에 따른다. Content는 검색 엔진이 아니라 정본·권한·판본 확인자다.

~~~mermaid
flowchart LR
  S[Content 허용 Scope/manifest] --> R[현재 관계: Neo4j]
  S --> M[원고 Vector: Elasticsearch]
  S -.-> W[회차 Wiki Graph]
  S -.-> T[템플릿 Vector]
  R --> N[출처 정규화]
  M --> N
  W -.-> N
  T -.-> N
  N --> V[Content 권한과 출처별 확인]
  V --> C[ContextPacket + Coverage/Gap]
~~~

## 공통 입력과 출력

공통 Retrieval 도구/서브그래프는 Writing & Editing을 제외한 업무 Agent가 필요할 때 호출하며, 아래 Scope와 결과 계약을 재사용한다. Writing & Editing에는 Content가 확인한 허용 입력을 직접 전달하고, 필요 시 Manuscript Review가 검수한다. 별도 정본이 아니고 모든 공급자나 모델을 매번 호출하지 않는다. 단순 조회는 직접 실행할 수 있다. [공통 도구](03-rag-simulation-design.md#공통-서브그래프-도구)

Scope에는 사용자 작업 참조, 대상 work/Fork, 기준 회차·판본 manifest, audience(owner/reader/character), 인물 ID, 목적, 만료가 들어간다. UI·모델이 만든 Scope를 신뢰하지 않는다. Query에는 작업 종류, 검색 문구 또는 ID, 허용 회차/문서, 결과·토큰 상한을 넣는다. 결과는 ok/partial/unavailable/unsupported/denied 중 하나이며 evidence, gaps, coverage를 반환한다. 정상 0건은 검색 장애와 다르다.

Evidence의 공통 필수 정보는 출처 종류, 그 종류 안에서 식별 가능한 출처 참조, 검증에 사용한 판본·세대·토큰 등 출처별 식별 정보, canonical/inferred/hypothetical 상태, 조회 시점이다. 작품·회차에 속하는 근거에는 해당 work/Fork와 회차·문서 식별자를 포함한다. 위치·인용을 확인하는 방식은 출처 종류에 따른다.

| 출처 종류 | 출처별 확인 정보 |
|---|---|
| 원고 Vector | work/Fork, 회차·문서 ID, 판본, 본문 해시, 원문 기준 UTF-16 `[start,end)`, 인용. Content가 PostgreSQL 판본 원문에서 대조한다. |
| 현재 관계 Graph | 세계관 ID, 관계 ID, 현재 graph token과 방향·라벨·양 끝 카드. Content가 world 연결·소유권·공개 범위와 현재 그래프를 확인한다. 출처의 시점을 현재로 표시한다. |
| 회차 Wiki Graph | 출처 회차·문서의 판본, 파생 노드·경로 참조, 근거와 회차 coverage. 원고 직접 인용이 있을 때 해당 원문 위치와 인용을 대조한다. |
| 템플릿 Vector | 카탈로그 항목 ID, catalog revision, 라이선스·공개 범위. 독립 카탈로그에는 작품/Fork와 회차 필드를 요구하지 않는다. |
| Q&A의 설정 | 설정 ID와 판본, 사용한 공개 범위와 인용. Content가 해당 회차에 허용한 설정 본문·속성·지식을 확인한다. |

Python은 출처 종류별 필수 정보와 검증 결과를 확인한다. 해당 종류에 적용되지 않는 필드는 누락으로 세지 않는다. 템플릿의 카탈로그 정보는 작품의 확정 설정과 구분한다. 벡터 점수는 검색 관련도를 뜻하며, 공급자별 점수를 평균해 사실을 결정하지 않는다.

Coverage는 요청한 범위의 expected와 verified 판본, 누락·stale·삭제·미지원 구간을 표시한다. top-k가 관련 문단을 찾았다는 이유만으로 작품 전체를 검수했다고 쓰지 않는다. 권한 밖 회차는 존재 자체를 드러내지 않는다. 인물용 packet은 해당 시점에 배운 정보만 포함한다.

## Q&A 범위 확정 (1단계 구현)

`content-service`의 `QaScopeService.resolve`가 Q&A의 작품·Fork·발행 판본 범위를 확정한다. 답변 경로는 아래 계약을 사용한다.

- 입력: 경로의 작품/Fork ID, Core가 검증한 Principal(없으면 공개 독자), 기준 회차 번호, 기준 회차 발행 판본 ID(`versionId`). 범위는 원고만이다.
- 권한: 작가는 `WorkAccessService.own`, 독자는 `published`로 판단한다. 판본은 요청에서 받지 않고 정본에서 다시 읽는다.
- 범위: 해당 작품/Fork의 발행 회차 중 기준 회차 이하와 각 현재 발행 판본. Fork의 상속 회차는 Fork가 보는 판본이며, 원작이 삭제된 Fork의 독자 범위에서는 상속 회차를 뺀다. 미발행·없는 회차는 422, 판본 불일치(오래된 판본·다른 Fork 판본)는 409다.
- 기준은 발행 판본만이며 작가의 미발행 초안은 범위에 넣지 않는다(2026-11-11 사용자 결정).
- 설정·관계 질문 대상(`setting`·`relationship`)과 Neo4j 현재 관계 범위(`QaScope.world`)는 작품 Q&A 화면 제거(#525) 뒤 쓰는 곳이 없어 지웠다. 설정·관계 근거는 AI가 Content MCP로 기준 회차 시점 WorldStudio를 읽는다([세계관 근거](#qa-세계관-근거-490)).

## 공급자별 계약

| 공급자 | 우선순위와 입력 | 검증·한계 |
|---|---|---|
| 현재 관계 Graph | 1단계. Content가 연결·소유권·현재 graph token을 확인한 WorldStudio 관계 | Q&A 내부 검색 API는 최신 방향·라벨·양 끝 카드와 공개 범위만 준다. 회차 시점 관계는 DEC-51로 WorldStudio가 제공하며, Manuscript Review·Rating·시뮬레이션은 Content MCP `world_studio_read(episode)`로 읽는다. Q&A 전환은 #490이다. |
| 원고 Vector | 2단계. PostgreSQL 판본에서 만든 Elasticsearch 인덱스, work/Fork·revision 선필터 | chunk가 문서/권한 경계를 넘지 않는다. 검색 후 Content 원문·hash·span을 재검증한다. 색인 세대가 뒤처지면 stale. |
| 회차 Wiki Graph | 후속. 회차/장면/사건/인물 지식/복선·회수/인과의 출처 있는 파생 그래프 | source revision·회차 coverage·삭제 전파가 확인된 경로만 사용. 관계 이력을 재구성하지 않는다. |
| 템플릿 Vector | 후속. 작품과 분리된 장르/세계관 카탈로그 | 라이선스·공개 범위와 catalog revision을 확인한다. 추천 결과를 자동으로 작품에 반영하지 않는다. |

Content는 `episode_current`의 활성 발행 판본과 `work_current`의 공개 상태를 읽어 첫 일괄 적재와 이후 대조를 같은 경로로 처리한다. 초안이나 저장 버전은 발행된 시점부터 적재 대상이다. 비공개·권리 제한·삭제 작품, 공개 중단·삭제 회차, 삭제 원작에서 상속된 회차는 제외한다. Fork의 자체 회차와 생성 시 고정한 상속 판본은 기존 읽기 계약을 따른다.

## 원고 벡터 인덱스 v1

[`storyfork-manuscript-v1` 매핑](../../infrastructure/elasticsearch/manuscript-chunks-v1.json)은 `intfloat/multilingual-e5-small`의 384차원 벡터를 `dense_vector`와 cosine으로 검색한다. 문단에는 `passage: `, 질문에는 `query: `를 붙이고 같은 모델 리비전으로 임베딩한다. 평가에는 배포자가 제공한 INT8 ONNX 모델로 512토큰 이내 입력을 처리하고, padding을 제외한 평균 풀링 뒤 L2 정규화를 적용했다. [모델 카드](https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3)

`work_id`는 `QaScope.workId`에 해당한다. Fork의 상속 회차도 해당 Fork의 작품 ID와 회차 ID로 색인한다. `source_work_id`는 Fork의 직접 분기 원본이며 원작에서는 필드를 생략한다. `source_revision`은 회차 버전 행의 PK 대신 `QaEpisodeRef.versionId`와 동일한 `content_version_id`를 사용한다. 상속된 원작과 Fork가 같은 `content_version_id`를 공유하므로 `work_id`를 항상 함께 제한한다.

`episode_id`, `source_hash`(UTF-8 판본 본문 SHA-256), `[start_utf16, end_utf16)`를 반환하면 Content가 판본 본문에서 인용을 확인한다. 인덱스에는 원고 본문을 저장하지 않는다. 현재 로컬 색인 세대는 `1`이다.

대조 작업은 기본 60초 간격이다. 청크는 문단 기준이며 긴 문단은 UTF-16 256단위 이내로 자른다. 작품·회차·판본·본문 해시·범위로 문서 ID를 고정해 다음 주기에 이미 반영된 청크를 건너뛴다. 구판·삭제된 청크를 먼저 제거하고 누락분은 로컬 AI Service에서 임베딩해 배치로 적재한다. 실패한 실행은 다음 주기에 다시 대조한다. 같은 Content DB의 동시 작업은 PostgreSQL advisory lock으로 막는다. 대조 전에는 PostgreSQL이 확정한 최신 Scope와 원문 검증이 여전히 필요하다. Content는 시작할 때 인덱스가 없을 때만 v1 매핑으로 만들고 기존 인덱스는 매핑만 검증한다. 불일치하면 시작하지 않는다. 개발 서버 CD는 Elasticsearch와 고정 리비전 모델을 포함한 AI 이미지를 함께 배포한다. [로컬 실행·배포 안내](../../infrastructure/README.md#로컬-원고-검색용-elasticsearch-56)

`POST /storyfork-manuscript-v1/_search`에서 `knn.field`는 `embedding`, `knn.query_vector`는 같은 모델의 질문 벡터다. 아래는 원작의 허용 회차가 2개일 때 `knn.filter` 예시다. Fork 조회는 `must_not exists`를 `source_work_id`의 `term`으로 바꾼다. 회차 번호와 판본을 한 쌍으로 비교하고 허용 목록이 비어 있으면 `match_none`을 사용한다. [Elastic kNN 사전 필터](https://www.elastic.co/docs/solutions/search/vector/knn)

```json
[
  { "term": { "work_id": "<QaScope.workId>" } },
  { "bool": { "must_not": { "exists": { "field": "source_work_id" } } } },
  { "term": { "index_generation": 1 } },
  { "bool": {
    "minimum_should_match": 1,
    "should": [
      { "bool": { "filter": [
        { "term": { "episode_number": 1 } },
        { "term": { "source_revision": "<1화 versionId>" } }
      ] } },
      { "bool": { "filter": [
        { "term": { "episode_number": 2 } },
        { "term": { "source_revision": "<2화 versionId>" } }
      ] } }
    ]
  } }
]
```

### 개발 표본 평가

2026-11-11에 저장소 [시연용 원고 CSV](../../infrastructure/sample-data/README.md)의 `starlight` 1–3화, `postman` 1–2화, `crown` 4화, `seal` 3화에서 문단 26개를 뽑았다. 각 질문에 정답 문단 하나를 미리 지정하고 11개 질문을 같은 문단 집합에서 cosine으로 순위화했다. 두 모델의 상위 3개 지표가 같아 벡터 차원이 절반인 E5-small을 선택했다. [E5-small](https://huggingface.co/intfloat/multilingual-e5-small) · [E5-base](https://huggingface.co/intfloat/multilingual-e5-base)

| 모델 | 차원 | 정답 1위 | 정답 상위 3위 | MRR@3 |
| --- | ---: | ---: | ---: | ---: |
| E5-small | 384 | 7/11 | 8/11 | 0.682 |
| E5-base | 768 | 7/11 | 8/11 | 0.682 |

Elasticsearch 9.5.6의 `storyfork-manuscript-v1-dev-sample`에 원고 표본 26문단, 원작과 같은 판본을 쓰는 Fork 상속 문단 1개, 차단 검증용 문서 5개를 넣었다. `knn.filter`로 작품·회차·판본을 제한했을 때 정답은 1위 8/11, 상위 3위 11/11이었다. 필터를 제거하거나 회차와 판본을 별도 `terms`로 비교하면 차단 검증용 문서가 결과에 들어왔다. 올바른 필터는 다른 작품, 같은 원작의 다른 Fork, 이전 판본, 잘못 조합한 회차·판본, 허용 세대 밖 문서를 모두 제외했다. 빈 허용 범위는 0건, 차원 불일치와 매핑에 없는 필드는 HTTP 400이었다.

초기 매핑 평가에서는 `storyfork-manuscript-v1`을 빈 상태로 만들었다. 다음 검증에서 Content의 첫 대조로 개발 PostgreSQL의 발행본 32회차(작품 11개, 그중 Fork 7개)에서 청크 134개를 적재했다. 같은 판본 ID를 공유하는 원작과 두 Fork를 각각 검색하고 PostgreSQL 원문 해시와 UTF-16 위치를 대조했다. 검증 DB에서 최초 발행, 판본 교체, 공개 중단, 재발행, 회차 삭제, 원작 삭제 후 상속 회차 제외를 확인했다.

## 작품 Q&A API (제거, #525)

작가 집필실과 독서 화면의 **작품에 질문하기** 패널(`StoryQaPanel`)과 그 전용 API(`POST /api/v1/works/{id}/context/qa`, `POST /api/v1/public/works/{id}/context/qa`), Content의 답변 생성 경로(`ManuscriptQaService.ask`·`ManuscriptQaClient`)와 AI의 `POST /internal/v1/manuscript/qa`를 제거했다(2026-11-18 사용자 결정, #525). 이 화면은 집필 AI 대화 Q&A와 같은 Story Q&A 에이전트를 쓰면서도 설정 근거로 작품 설정 문서, 관계로 Neo4j 최신 관계를 써서 WorldStudio 기준(#490)과 출처가 달랐다. 작품 질문은 집필 AI 대화(`ask_story_qa`)로만 한다. 독자용 작품 Q&A는 없다.

남은 것은 아래 공통 Retrieval 도구가 쓰는 Content 검색(`ManuscriptQaService.retrieveForAi`: 범위 확정 → 임베딩 → Elasticsearch → PostgreSQL 원문 재대조)이다. 검색 설정:

- `MANUSCRIPT_INDEX_ENABLED=true`와 Content DB에 맞는 `MANUSCRIPT_INDEX_NAME`을 사용한다. 위에서 준비한 로컬 DB의 인덱스는 `storyfork-manuscript-v1-local`이다. AI Service에는 로컬 E5와 `OPENAI_API_KEY`, Structured Outputs를 지원하는 `OPENAI_MODEL`을 설정한다. [실행 안내](../../infrastructure/README.md#네이티브-자동-적재) · [로컬 compose 스택에서 켜기](../../infrastructure/README.md#로컬-compose-스택에서-켜기-475)(compose용 `MANUSCRIPT_INDEX_NAME`을 네이티브와 나눈다) · [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

### 공통 Retrieval 도구 (오케스트레이션, 2026-11-12 사용자 결정)

AI가 DB에 직접 접속하지 않고 Content API를 호출하는 방식이다. Flyway 마이그레이션과 원고 색인 동기화·시드 코드는 그대로 Content에 둔다.

- Content `POST /internal/v1/ai/qa/retrieval` `{scopeToken, question}` → `{status: found|insufficient, sources, excerpts, gaps, coverage, steps}`. `ManuscriptQaService.retrieve`(범위 확정 → 임베딩 → Elasticsearch → PostgreSQL 원문 재대조)를 쓰고 모델은 부르지 않는다. `steps`는 공급자별(`embedding`·`elasticsearch`·`postgres_verify`) 소요 ms·결과 수다.
- 인증은 `/internal/v1/ai/**` 전용 보안 체인의 `X-Internal-Token`(`INTERNAL_TOKEN`, 32자 이상)이다. 조회 키(작품·작가·회차·판본)는 Content가 인증 뒤 `QaScopeGrants`로 HMAC 서명해 발급한 `scopeToken`(1시간 만료)에서만 읽는다. AI는 토큰을 되돌려 줄 뿐이라 `INTERNAL_TOKEN`만으로 다른 작가를 지정할 수 없다. 서명이 틀리거나 만료되면 403이다. Content가 그 값으로 `QaScopeService` 권한·범위를 다시 확정한다. 서명 키는 프로세스마다 새로 만들어 Content 재시작·다중 인스턴스에서는 발급한 토큰이 무효다.
- 토큰 발급은 Content 공개 경로 `POST /api/v1/works/{id}/writing-ai/orchestrations` `{request | resume{approved}, threadId?, operation?, episode, episodeVersionId, targetEpisode?}`가 한다(`episode`·`episodeVersionId`는 근거 회차, 선택 `targetEpisode`는 승인 뒤 쓸 반영 회차로 없으면 `episode`와 같다). 회원 인증(Principal)·작품 범위를 확인한 뒤 작가 본인으로 토큰을 발급하고, 대화를 `user:<작가>/work:<작품>` scope에 묶어 AI 오케스트레이션을 부른다. 응답은 `{threadId, result}`이며 result는 AI 응답 그대로다. resume 때도 새 토큰을 보내 AI가 저장된 토큰을 바꾸므로 1시간 만료·Content 재시작 뒤에도 이어 실행할 수 있다. 집필실 채팅은 같은 `WritingAiService`로 범위를 확인하고 토큰을 발급하는 SSE 경로 `/api/v1/works/{id}/chat/sessions/{threadId}/messages`를 쓴다([대화 세션](02-ai-architecture.md#유지되는-실행-계약)). Content는 아직 콘티·선택 구간 입력을 보내지 않는다. 웹 조사의 질문·동의는 입력 대기 뒤 resume으로 받는다. 집필 AI 대화는 OpenAI 전송·비용 동의를 따로 받지 않는다(2026-11-19 사용자 결정, #542).
- AI `app/retrieval/service.retrieve`가 이 API를 호출한다. 오케스트레이션 요청에 Content가 확인한 `scope`가 있으면 Q&A 단계가 발췌 입력 없이 Retrieval로 근거를 받고, 근거가 없으면 모델을 부르지 않고 gaps만 돌려준다. Writing & Editing은 호출하지 않는다.
- 한계: 오케스트레이션 경로는 답변 생성 뒤 Content의 범위·근거 재확인(409)을 하지 않는다. 검색어는 메인 에이전트가 정한 `ask_story_qa(request)`의 앞 500자다. 메인 모델이 지칭을 풀어 적을 수 있지만 Content 쪽 검색어 재작성은 없다. Manuscript Review·Rating·시뮬레이션은 이 도구가 아니라 Content MCP로 원고·세계관을 읽는다. World & Plot이 생기면 목적별 조회를 정한다.

### Q&A 세계관 근거 (#490)

집필 AI 대화의 Q&A(`ask_story_qa`)는 원고와 설정·관계 근거를 따로 받는다. 원고는 위 Retrieval(내부 검색 API, scopeToken)을 그대로 쓰고, 설정·관계는 Manuscript Review·시뮬레이션과 같은 Content MCP 세계관 읽기로 받는다. 에이전트마다 다른 설정을 기준으로 답하거나 검수하지 않게 하려는 것이다.

결정(2026-11-18 사용자 결정):

1. **설정 정본은 WorldStudio 하나다.** Q&A는 Content 작품 설정 문서(`setting_*`, knownBy·회차 범위)를 읽지 않는다. 데이터는 옮기지 않는다. WorldStudio에서는 아는 인물이 관계 연결과 인물 회차 기억(DEC-47)으로, 공개 범위가 `revealFromEpisode`(DEC-46)로 표현된다.
2. **초안을 근거로 쓴다.** Review와 같은 `world_studio_read` 초안이라 작가가 막 고친 설정이 바로 반영된다. 작가 전용 경로라 독자에게 초안이 보이지 않는다.
3. **작품 연결 세계관을 읽는다.** `world_studio_list`의 `linkedWorkId`가 작품인 세계관을 읽고, 없으면 Fork가 이어받는 원작 세계관(`work_inherited_world`)을 읽는다. 그것도 없으면 대체 세계관을 찾지 않고 gaps로 알린다. 회차 기준 세계관(`episode_world_basis_read`)은 쓰지 않는다.
4. **Writing(`work_context_read`)은 이 이슈에서 바꾸지 않는다.** 후속으로 맞춘다.
5. **질문 종류를 나누지 않는다.** Content Retrieval은 원고만 다루므로 Q&A마다 원고 Retrieval과 세계관을 둘 다 근거로 넣고 모델이 골라 인용한다.

동작:

- 공용 함수: 세계관 읽기는 `content_mcp.linked_world(workId, episode)`, 거르기는 `novelbrain.service.episode_settings`다. Review와 Q&A가 같은 함수를 쓴다. 거르기는 독자 공개 회차(`revealFromEpisode`)가 근거 회차 이하인 카드, 그 회차까지의 인물 기억, 양 끝 카드가 모두 남은 관계만 남긴다.
- 근거 회차는 `target.baseEpisode`, 없으면 `target.episode`다. 관계는 그 회차 시점이다(DEC-51). `target`이 없으면 Q&A 단계가 실패한다.
- 발췌 id는 `card:<id>`·`relation:<id>`, kind는 `setting`·`relationship`, episode는 근거 회차다. 지시문은 설정·관계 발췌를 기준 회차 시점의 세계관으로 다룬다(작품 Q&A 화면을 지운 뒤 현재 관계 `relationship:` 발췌가 모델에 갈 경로는 없다, #525).
- 시연 규모라 공개 카드·관계를 모두 보낸다. 8건이 넘으면 질문과 `novelbrain` BM25로 8건을 고른다. 카드 인용은 2,000자까지다(`shortcut:` 주석). 그래서 Q&A 입력 한도를 발췌 16건(원고 8 + 세계관 8)·인용 2,000자로 넓혔다. Content가 보내는 원고·설정 발췌는 계속 256자·8건 이하다.
- Retrieval 결과는 원고 발췌(`kind=manuscript`)만 쓴다. Content Retrieval은 원고만 돌려준다(설정·관계 대상은 제거). Content가 원고 검색을 쓸 수 없다고(503 `RetrievalUnavailable`) 답하면 그 문구를 gap으로 남기고 세계관 근거로만 답한다. 그 밖의 Retrieval 오류는 단계 실패다. 세계관 읽기는 `world_read` 추적 span에 고른 카드·관계의 참조만 남긴다.
- 세계관이 없거나 쓸 카드가 없으면 gaps로 알리고, 원고와 세계관 모두 근거가 없으면 모델을 부르지 않는다. MCP 호출·형식 오류는 빈 근거로 바꾸지 않고 단계 실패다. MCP 도구와 인자는 Python이 고정해 호출하고 모델에 노출하지 않으며 읽기 도구만 쓴다.
- 실모델 확인(2026-11-18, 로컬 집필실 채팅 브라우저 e2e, 개발 샘플 작품 '별빛 서약의 탑'(WorldStudio 카드 15장, 발행 3화), 근거 회차 2화, 모델 호출은 Decision Guard·메인 에이전트·Q&A): 설정 질문 '카엘은 어떤 사람이야?'는 카엘·리안·오르벤 카드와 관계 하나(`card:`·`relation:`)를 인용해 답하고 나이·외모는 gaps로 남겼다. 관계 질문 '리안과 오르벤은 어떤 관계야?'는 리안 카드와 원고 발췌로 스승·제자 관계를 답했다. 3화 공개 카드(세라핀·재의 사절 도착·마법 금지 규칙)는 2화 근거에서 빠졌다(Langfuse `world_read` 참조로 확인). 카드 15장이라 BM25로 8건을 골랐다. 컨테이너를 새로 띄운 직후 첫 질문은 Content 원고 검색이 E5 모델을 처음 읽느라 20초를 넘겨 Retrieval 시간 초과로 실패했고, 다음 질문부터는 정상이었다.
- 한계: 인물 문서(SOUL·GOAL)는 회차 범위가 없어 그 안에 적은 뒤 회차 정보(예: 3화에 등장하는 인물의 호칭)가 근거로 쓰일 수 있다(Review와 같다). Rating도 같은 `linked_world`를 쓴다(#524). 설정집 검토·시뮬레이션의 세계관 읽기는 아직 각자 코드에 있다.

### 로컬 실모델 검증 (2026-11-11, 제거 전 작품 Q&A 화면 기록)

`gpt-5.6-luna`로 로그인한 독서 화면에서 공개 개발 샘플 질문을 세 번 제출했다. 원작 `starlight` 2화와 Fork `seal` 2화에서 카엘이 허락한 일을 묻자 각각 서고 열람을 답했고, 같은 상속 판본 `ec9e6883-0c2d-3b95-9976-b5fbaf6688bc`의 2화 원문을 표시했다. 동일 질문을 API에서 각각 한 번 재현해 두 응답 모두 200 `answered`이며 각 `workId`·`episodeId`가 PostgreSQL의 해당 작품과 회차에 일치하고 인용 청크 ID가 서로 다른 것을 확인했다. Fork의 `sourceWorkId`는 원작을 가리켰다.

Fork에서 카엘의 생년월일을 묻자 화면에 “확인된 원고 근거로 답하기 어려워요.”와 **근거가 부족한 부분**이 표시됐다. 모델은 제공된 발췌에서 생년월일을 확인할 수 없다고 설명했다. 확인 범위는 개발 샘플 원작과 Fork의 이 세 사례다.

### 설정·관계 로컬 실모델 검증 (제거 전 작품 Q&A 화면 기록)

`gpt-6-luna`로 합성 개발 작품의 1화 발행본을 기준으로 검증했다. Neo4j에서 라온과 모루의 관계를 수정한 뒤 작가 답변이 현재 역할인 ‘기록 안내자’와 그래프 토큰 `3`을 인용했다. 같은 질문의 공개 API는 403, 비소유 회원의 작가 API는 404였다.

작가와 독자가 검은 별 지도의 보관 장소를 물었다. 작가는 ‘보라색 관측함’과 비공개 설정 판본을 받았다. 독자는 출처 없이 `insufficient`를 받았고, 2화부터 공개되는 새벽 탑의 입장 규칙에도 같은 상태를 받았다. 독자에게 1화부터 공개된 은빛 도서관의 질문은 ‘은제 책갈피’와 공개 설정 판본을 반환했다.

브라우저에서 집필실의 **현재 관계** 출처와 그래프 토큰을 확인했다. 독서 화면에는 공개 설정의 제목·판본·인용문이 표시됐고, 비공개 설정 질문에는 출처 없이 **근거가 부족한 부분**이 표시됐다. 집필실 첫 요청에는 Neo4j 연결 오류가 표시됐고 같은 질문을 다시 보내 출처를 확인했다.

## Mock과 실제 검증의 구분

Mock은 권한 필터, 누락, 오래된 판본, Fork 분리, 출처 형식을 단위 테스트에서 재현하는 데 쓴다. 모든 Mock evidence는 mock임을 표시하고 실제 변경 적용 근거로 사용하지 않는다. 기능 완료에는 해당 실제 공급자와 실제 OpenAI 모델의 결과가 필요하다. 실 Neo4j/Elasticsearch/OpenAI 장애를 Mock 성공으로 바꾸지 않는다.

최소 수용 사례: 현재 관계 질문, 타 작품/Fork 차단, 원고 관련 문단 검색, 판본 변경 뒤 stale 차단, 1~10화 중 누락된 회차의 coverage gap, 인물 지식 습득 전후, 템플릿 권리 철회. Wiki·템플릿 사례는 해당 공급자 구현 단계에서 실제 검증한다.
