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

## 공급자별 계약

| 공급자 | 우선순위와 입력 | 검증·한계 |
|---|---|---|
| 현재 관계 Graph | 1단계. Content가 연결·소유권·현재 graph token을 확인한 WorldStudio 관계 | 현재 방향·라벨·양 끝 카드와 공개 범위만. 과거 회차 관계 복원은 unsupported. |
| 원고 Vector | 2단계. PostgreSQL 판본에서 만든 Elasticsearch 인덱스, work/Fork·revision 선필터 | chunk가 문서/권한 경계를 넘지 않는다. 검색 후 Content 원문·hash·span을 재검증한다. 색인 세대가 뒤처지면 stale. |
| 회차 Wiki Graph | 후속. 회차/장면/사건/인물 지식/복선·회수/인과의 출처 있는 파생 그래프 | source revision·회차 coverage·삭제 전파가 확인된 경로만 사용. 관계 이력을 재구성하지 않는다. |
| 템플릿 Vector | 후속. 작품과 분리된 장르/세계관 카탈로그 | 라이선스·공개 범위와 catalog revision을 확인한다. 추천 결과를 자동으로 작품에 반영하지 않는다. |

Elasticsearch 인덱싱은 원고 저장·버전 변경·삭제에서 재처리 가능한 식별자로 갱신한다. 인덱스는 source revision과 generation을 가진다. 늦게 도착한 구버전 색인이 최신판을 덮지 않도록 Content manifest와 비교한다. 실제 검색 성능·한국어 회수율은 개발용 corpus에서 측정한다. 임베딩 생성에 OpenAI를 쓴다면 그 호출도 키·비용·권한·실패를 별도로 기록한다.

## Mock과 실제 검증의 구분

Mock은 권한 필터, 누락, 오래된 판본, Fork 분리, 출처 형식을 단위 테스트에서 재현하는 데 쓴다. 모든 Mock evidence는 mock임을 표시하고 실제 변경 적용 근거로 사용하지 않는다. 기능 완료에는 해당 실제 공급자와 실제 OpenAI 모델의 결과가 필요하다. 실 Neo4j/Elasticsearch/OpenAI 장애를 Mock 성공으로 바꾸지 않는다.

최소 수용 사례: 현재 관계 질문, 타 작품/Fork 차단, 원고 관련 문단 검색, 판본 변경 뒤 stale 차단, 1~10화 중 누락된 회차의 coverage gap, 인물 지식 습득 전후, 템플릿 권리 철회. Wiki·템플릿 사례는 해당 공급자 구현 단계에서 실제 검증한다.
