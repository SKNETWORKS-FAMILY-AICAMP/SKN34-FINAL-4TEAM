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

공통 Retrieval 도구/서브그래프는 Writing & Editing을 제외한 업무 Agent가 필요할 때 호출하며, 아래 Scope와 결과 계약을 재사용한다. Writing & Editing에는 Content가 확인한 허용 입력을 직접 전달하고, 필요 시 Review가 검수한다. 별도 정본이 아니고 모든 공급자나 모델을 매번 호출하지 않는다. 단순 조회는 직접 실행할 수 있다. [공통 도구](03-rag-simulation-design.md#공통-서브그래프-도구)

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

- 입력: 경로의 작품/Fork ID, Core가 검증한 Principal(없으면 공개 독자), 기준 회차 번호, 기준 회차 발행 판본 ID(`versionId`), 질문 대상 `manuscript|relationship`, 관계 시점 `current`.
- 권한: 작가는 `WorkAccessService.own`, 독자는 `published`로 판단한다. 판본·세계관 ID는 요청에서 받지 않고 정본에서 다시 읽는다.
- 범위: 해당 작품/Fork의 발행 회차 중 기준 회차 이하와 각 현재 발행 판본. Fork의 상속 회차는 Fork가 보는 판본이며, 원작이 삭제된 Fork의 독자 범위에서는 상속 회차를 뺀다. 미발행·없는 회차는 422, 판본 불일치(오래된 판본·다른 Fork 판본)는 409다.
- 관계: 기준 회차의 `basisWorldId`(기능 87)를 작품↔세계관 연결로 보고, 그 world 소유자 기준으로 현재 Neo4j graph token을 `WorldStudioService.draft`로 확인한다. Fork의 상속 회차는 원작 같은 회차에 원작 작가가 연결한 world를 쓰고(2026-11-11 사용자 결정), Fork 자체 회차는 Fork 작가가 연결한 world만 쓴다. 연결 없음은 422 `WORLD_LINK_REQUIRED`, 확인 불가 world는 404, `current` 외 시점은 409 `RELATIONSHIP_HISTORY_UNSUPPORTED`, 저장소 오류는 WorldStudio의 code·상태(409/503)를 그대로 쓴다. 독자의 관계 질문은 403이다.
- 기준은 발행 판본만이며 작가의 미발행 초안은 범위에 넣지 않는다(2026-11-11 사용자 결정).
- 독자의 관계 질문은 회차별 관계 공개 정책이 생길 때까지 403으로 막는다. 현재 관계는 이후 회차의 변화까지 담아 독자에게 미래 정보를 드러내고, 설정 기본값도 비공개이기 때문이다(DEC-36, 2026-11-11 사용자 결정).
- 회차에 연결된 world는 봉인 버전이지만 관계는 Neo4j 현재 상태다. 관계 이력이 없어 기준 회차 이후 변경 여부를 판단할 수 없으므로, 답변의 관계 근거는 항상 "현재 관계(기준 회차 시점 아님)"와 graph token으로 표시한다. 이 표시는 답변 생성 단계에서 구현한다(2026-11-11 사용자 결정).
- Q&A 답변 생성은 상속 회차의 원작 현재 관계와 비공개 카드를 AI 문맥에서 제외한다. Fork의 자체 회차는 그 회차에 연결된, Fork 작가가 소유한 세계관의 현재 관계를 사용한다.

## 공급자별 계약

| 공급자 | 우선순위와 입력 | 검증·한계 |
|---|---|---|
| 현재 관계 Graph | 1단계. Content가 연결·소유권·현재 graph token을 확인한 WorldStudio 관계 | 현재 방향·라벨·양 끝 카드와 공개 범위만. 과거 회차 관계 복원은 unsupported. |
| 원고 Vector | 2단계. PostgreSQL 판본에서 만든 Elasticsearch 인덱스, work/Fork·revision 선필터 | chunk가 문서/권한 경계를 넘지 않는다. 검색 후 Content 원문·hash·span을 재검증한다. 색인 세대가 뒤처지면 stale. |
| 회차 Wiki Graph | 후속. 회차/장면/사건/인물 지식/복선·회수/인과의 출처 있는 파생 그래프 | source revision·회차 coverage·삭제 전파가 확인된 경로만 사용. 관계 이력을 재구성하지 않는다. |
| 템플릿 Vector | 후속. 작품과 분리된 장르/세계관 카탈로그 | 라이선스·공개 범위와 catalog revision을 확인한다. 추천 결과를 자동으로 작품에 반영하지 않는다. |

Content는 `episode_current`의 활성 발행 판본과 `work_current`의 공개 상태를 읽어 첫 일괄 적재와 이후 대조를 같은 경로로 처리한다. 초안이나 저장 버전은 발행된 시점부터 적재 대상이다. 비공개·권리 제한·삭제 작품, 공개 중단·삭제 회차, 삭제 원작에서 상속된 회차는 제외한다. Fork의 자체 회차와 생성 시 고정한 상속 판본은 기존 읽기 계약을 따른다.

## 원고 벡터 인덱스 v1

[`storyfork-manuscript-v1` 매핑](../../infrastructure/elasticsearch/manuscript-chunks-v1.json)은 `intfloat/multilingual-e5-small`의 384차원 벡터를 `dense_vector`와 cosine으로 검색한다. 문단에는 `passage: `, 질문에는 `query: `를 붙이고 같은 모델 리비전으로 임베딩한다. 평가에는 배포자가 제공한 INT8 ONNX 모델로 512토큰 이내 입력을 처리하고, padding을 제외한 평균 풀링 뒤 L2 정규화를 적용했다. [모델 카드](https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3)

`work_id`는 `QaScope.workId`에 해당한다. Fork의 상속 회차도 해당 Fork의 작품 ID와 회차 ID로 색인한다. `source_work_id`는 Fork의 직접 분기 원본이며 원작에서는 필드를 생략한다. `source_revision`은 회차 버전 행의 PK 대신 `QaEpisodeRef.versionId`와 동일한 `content_version_id`를 사용한다. 상속된 원작과 Fork가 같은 `content_version_id`를 공유하므로 `work_id`를 항상 함께 제한한다.

`episode_id`, `source_hash`(UTF-8 판본 본문 SHA-256), `[start_utf16, end_utf16)`를 반환하면 Content가 판본 본문에서 인용을 확인한다. 인덱스에는 원고 본문을 저장하지 않는다. 현재 로컬 색인 세대는 `1`이다.

대조 작업은 기본 60초 간격이다. 청크는 문단 기준이며 긴 문단은 UTF-16 256단위 이내로 자른다. 작품·회차·판본·본문 해시·범위로 문서 ID를 고정해 다음 주기에 이미 반영된 청크를 건너뛴다. 구판·삭제된 청크를 먼저 제거하고 누락분은 로컬 AI Service에서 임베딩해 배치로 적재한다. 실패한 실행은 다음 주기에 다시 대조한다. 같은 Content DB의 동시 작업은 PostgreSQL advisory lock으로 막는다. 대조 전에는 PostgreSQL이 확정한 최신 Scope와 원문 검증이 여전히 필요하다. [로컬 실행 안내](../../infrastructure/README.md#로컬-원고-검색용-elasticsearch-56)

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

## 작품 Q&A API

- 작가는 `POST /api/v1/works/{id}/context/qa`를 사용하고, 독서 화면은 `POST /api/v1/public/works/{id}/context/qa`를 사용한다. 두 경로는 회원 인증·CSRF·요청별 OpenAI 전송 및 API 비용 동의를 요구한다. 공개 독서 경로는 로그인한 작가도 공개 독자 범위를 적용한다.
- 요청은 `episode`, `episodeVersionId`, `question`(500자 이하), `consent`, `target`이다. 대상은 `manuscript`(기본값), `setting`, `relationship` 중 하나다. 독서 화면의 **작품에 질문하기**에는 발행 원고와 공개 설정이 있고, 집필실의 발행 회차에는 저장된 설정과 현재 인물 관계도 있다.
- 발행 원고는 허용 회차·판본 쌍을 kNN의 사전 필터에 넣고, 상위 8개 후보를 PostgreSQL의 현재 발행 회차 ID·판본·본문 해시·UTF-16 범위와 대조한다. 설정은 공개 Wiki와 같은 읽기 투영을 재사용한다. 독자는 기준 회차에 공개된 설정 본문과 공개 속성·지식을 쓸 수 있다. 작가는 자신의 확정 설정 본문을 비공개 여부와 관계없이 읽을 수 있다. 원작을 따라가는 Fork의 설정은 상속된 공개 범위를 적용한다.
- 현재 관계는 작가 소유의 회차 연결 세계관에서 Neo4j가 반환한 활성 관계를 사용한다. 양 끝 카드의 이름과 관계 방향·라벨·설명을 근거로 쓴다. 관계 시점과 과거 관계는 모델이 `gaps`로 설명한다. 공개 경로의 현재 관계 요청은 403이다.
- 응답의 `sources[].kind`는 발행 원고·설정·현재 관계를 구분한다. 설정에는 설정 ID와 판본, 현재 관계에는 세계관 ID·관계 ID·현재 그래프 토큰이 들어간다. `claims`에는 확인·추론과 출처 ID를 담고, `gaps`에는 답할 근거가 부족한 부분을 담는다. `coverage`의 회차별 검색 범위는 원고 질문에 적용한다.
- 설정·관계는 제목과 근거의 문자 일치로 정렬해 최대 8건을 보낸다. 근거가 없으면 모델을 호출하지 않고 `insufficient`를 반환한다. 저장소 또는 모델 연결 장애는 503, 미등록 출처를 인용한 모델 응답은 502, 답변 도중 발행 범위나 확인한 근거가 바뀌면 409를 반환한다.
- `MANUSCRIPT_INDEX_ENABLED=true`와 Content DB에 맞는 `MANUSCRIPT_INDEX_NAME`을 사용한다. 위에서 준비한 로컬 DB의 인덱스는 `storyfork-manuscript-v1-local`이다. AI Service에는 로컬 E5와 `OPENAI_API_KEY`, Structured Outputs를 지원하는 `OPENAI_MODEL`을 설정한다. [실행 안내](../../infrastructure/README.md#네이티브-자동-적재) · [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)

### 로컬 실모델 검증 (2026-11-11)

`gpt-5.6-luna`로 로그인한 독서 화면에서 공개 개발 샘플 질문을 세 번 제출했다. 원작 `starlight` 2화와 Fork `seal` 2화에서 카엘이 허락한 일을 묻자 각각 서고 열람을 답했고, 같은 상속 판본 `ec9e6883-0c2d-3b95-9976-b5fbaf6688bc`의 2화 원문을 표시했다. 동일 질문을 API에서 각각 한 번 재현해 두 응답 모두 200 `answered`이며 각 `workId`·`episodeId`가 PostgreSQL의 해당 작품과 회차에 일치하고 인용 청크 ID가 서로 다른 것을 확인했다. Fork의 `sourceWorkId`는 원작을 가리켰다.

Fork에서 카엘의 생년월일을 묻자 화면에 “확인된 원고 근거로 답하기 어려워요.”와 **근거가 부족한 부분**이 표시됐다. 모델은 제공된 발췌에서 생년월일을 확인할 수 없다고 설명했다. 확인 범위는 개발 샘플 원작과 Fork의 이 세 사례다.

### 설정·관계 로컬 실모델 검증

`gpt-6-luna`로 합성 개발 작품의 1화 발행본을 기준으로 검증했다. Neo4j에서 라온과 모루의 관계를 수정한 뒤 작가 답변이 현재 역할인 ‘기록 안내자’와 그래프 토큰 `3`을 인용했다. 같은 질문의 공개 API는 403, 비소유 회원의 작가 API는 404였다.

작가와 독자가 검은 별 지도의 보관 장소를 물었다. 작가는 ‘보라색 관측함’과 비공개 설정 판본을 받았다. 독자는 출처 없이 `insufficient`를 받았고, 2화부터 공개되는 새벽 탑의 입장 규칙에도 같은 상태를 받았다. 독자에게 1화부터 공개된 은빛 도서관의 질문은 ‘은제 책갈피’와 공개 설정 판본을 반환했다.

브라우저에서 집필실의 **현재 관계** 출처와 그래프 토큰을 확인했다. 독서 화면에는 공개 설정의 제목·판본·인용문이 표시됐고, 비공개 설정 질문에는 출처 없이 **근거가 부족한 부분**이 표시됐다. 집필실 첫 요청에는 Neo4j 연결 오류가 표시됐고 같은 질문을 다시 보내 출처를 확인했다.

## Mock과 실제 검증의 구분

Mock은 권한 필터, 누락, 오래된 판본, Fork 분리, 출처 형식을 단위 테스트에서 재현하는 데 쓴다. 모든 Mock evidence는 mock임을 표시하고 실제 변경 적용 근거로 사용하지 않는다. 기능 완료에는 해당 실제 공급자와 실제 OpenAI 모델의 결과가 필요하다. 실 Neo4j/Elasticsearch/OpenAI 장애를 Mock 성공으로 바꾸지 않는다.

최소 수용 사례: 현재 관계 질문, 타 작품/Fork 차단, 원고 관련 문단 검색, 판본 변경 뒤 stale 차단, 1~10화 중 누락된 회차의 coverage gap, 인물 지식 습득 전후, 템플릿 권리 철회. Wiki·템플릿 사례는 해당 공급자 구현 단계에서 실제 검증한다.
