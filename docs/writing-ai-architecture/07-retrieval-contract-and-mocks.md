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
  N --> V[Content 권한·판본·원문 확인]
  V --> C[ContextPacket + Coverage/Gap]
~~~

## 공통 입력과 출력

Scope에는 사용자 작업 참조, 대상 work/Fork, 기준 회차·판본 manifest, audience(owner/reader/character), 인물 ID, 목적, 만료가 들어간다. UI·모델이 만든 Scope를 신뢰하지 않는다. Query에는 작업 종류, 검색 문구 또는 ID, 허용 회차/문서, 결과·토큰 상한을 넣는다. 결과는 ok/partial/unavailable/unsupported/denied 중 하나이며 evidence, gaps, coverage를 반환한다. 정상 0건은 검색 장애와 다르다.

Evidence에는 source kind, source ID, work/Fork, episode/document ID, source revision, 정확한 원문 위치와 인용, canonical/inferred/hypothetical 상태, 조회 시점이 들어간다. 위치는 원문 기준 UTF-16 [start,end)이고 정확 인용은 PostgreSQL 원문으로 확인한다. 벡터 점수는 관련도일 뿐 사실일 확률이 아니다. 서로 다른 공급자의 점수를 평균해 사실을 결정하지 않는다.

Coverage는 요청한 범위의 expected와 verified 판본, 누락·stale·삭제·미지원 구간을 표시한다. top-k가 관련 문단을 찾았다는 이유만으로 작품 전체를 검수했다고 쓰지 않는다. 권한 밖 회차는 존재 자체를 드러내지 않는다. 인물용 packet은 해당 시점에 배운 정보만 포함한다.

## Q&A 범위 확정 (1단계 구현)

`content-service`의 `QaScopeService.resolve`가 Q&A와 이후 원고 Vector 검색의 공통 선필터를 확정한다. 공개 HTTP 경로·답변 생성은 아직 연결하지 않았다.

- 입력: 경로의 작품/Fork ID, Core가 검증한 Principal(없으면 공개 독자), 기준 회차 번호, 기준 회차 발행 판본 ID(`versionId`), 질문 대상 `manuscript|relationship`, 관계 시점 `current`.
- 권한: 작가는 `WorkAccessService.own`, 독자는 `published`로 판단한다. 판본·세계관 ID는 요청에서 받지 않고 정본에서 다시 읽는다.
- 범위: 해당 작품/Fork의 발행 회차 중 기준 회차 이하와 각 현재 발행 판본. Fork의 상속 회차는 Fork가 보는 판본이며, 원작이 삭제된 Fork의 독자 범위에서는 상속 회차를 뺀다. 미발행·없는 회차는 422, 판본 불일치(오래된 판본·다른 Fork 판본)는 409다.
- 관계: 기준 회차의 `basisWorldId`(기능 87)를 작품↔세계관 연결로 보고, 그 world 소유자 기준으로 현재 Neo4j graph token을 `WorldStudioService.draft`로 확인한다. Fork의 상속 회차는 원작 같은 회차에 원작 작가가 연결한 world를 쓰고(2026-11-11 사용자 결정), Fork 자체 회차는 Fork 작가가 연결한 world만 쓴다. 연결 없음은 422 `WORLD_LINK_REQUIRED`, 확인 불가 world는 404, `current` 외 시점은 409 `RELATIONSHIP_HISTORY_UNSUPPORTED`, 저장소 오류는 WorldStudio의 code·상태(409/503)를 그대로 쓴다. 독자의 관계 질문은 403이다.
- 기준은 발행 판본만이며 작가의 미발행 초안은 범위에 넣지 않는다(2026-11-11 사용자 결정).
- 독자의 관계 질문은 회차별 관계 공개 정책이 생길 때까지 403으로 막는다. 현재 관계는 이후 회차의 변화까지 담아 독자에게 미래 정보를 드러내고, 설정 기본값도 비공개이기 때문이다(DEC-36, 2026-11-11 사용자 결정).
- 회차에 연결된 world는 봉인 버전이지만 관계는 Neo4j 현재 상태다. 관계 이력이 없어 기준 회차 이후 변경 여부를 판단할 수 없으므로, 답변의 관계 근거는 항상 "현재 관계(기준 회차 시점 아님)"와 graph token으로 표시한다. 이 표시는 답변 생성 단계에서 구현한다(2026-11-11 사용자 결정).
- 후속 확인: 상속 회차에서 원작 world의 비공개 카드·Fork 이후 변경 관계를 AI 입력에 넣을지는 실제 AI 요청을 만드는 단계에서 정한다.

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
