[메인 README](../../README.md) · [문서 목록](../README.md)

> PR #98 리뷰 반영: 독립성은 worldstudio 스키마·Flyway 이력·업무 경계에 적용한다. 실행 시 기존 Core PostgreSQL DataSource와 기본 JPA/트랜잭션 인프라를 공유한다. 조건부 등록으로 비활성 시작 계약을 유지한다. 독립 SQL에는 Auth/Content migration 선행 조건이 없으며 기존 Content 테이블·코드에 대한 업무 의존을 추가하지 않는다. 아래의 과거 전용 연결/JPA 검증 설명은 [현재 실행 계약](../../backend/content-service/src/main/resources/db/migration/worldstudio/README.md)으로 대체한다.

# WorldStudio 독립 초기 스키마 재설계안

작성일: 2026-11-04. 상태: 독립 V1 및 JPA Repository·Service 구현. 공용 DB 적용·HTTP API/기존 UI 전환 완료를 뜻하지 않는다. 최신 실행 결과는 [JPA 검증 기록](worldstudio-jpa-verification.md)을 따른다.

## 회차별 관계 — DEC-51

**상태: 소스 구현, hosted CI 대기(2026-11-13 설계 확정).** 서버(`episode` 조회·저장)·MCP·독자 설정 위키(`upto`)와 관리 화면의 회차 선택(아래 '화면')은 소스에 구현했다(브라우저 육안 미확인). 기존 데이터 이전(공유 Neo4j, [스크립트](../../infrastructure/neo4j/dec51-relationship-edges.cypher) 미실행)은 남았다.

### 저장 모델

```
(:StudioCard A)-[:RELATED {relationId, worldId, fromEpisode, ended, payload}]->(:StudioCard B)
```

- 카드 노드는 지금처럼 `id`·`worldId`만 둔다. 인물·회차마다 새 노드를 만들지 않는다.
- 관계가 바뀐 회차마다 두 카드 사이에 `RELATED` 연결을 하나 추가한다. `relationId`가 같은 연결들이 한 관계의 회차별 값이다. 한 쌍 사이의 여러 관계는 `relationId`로 구분한다.
- `payload`는 지금 `StudioRelationship.payload`와 같은 내용(분류·방향/대칭·극성·본문·label·semantic metadata)이다. 방향 없는 관계도 source→target 연결 하나로 저장하고 payload의 대칭 값으로 구분한다.
- 관계가 끝나면 `ended=true` 연결을 추가한다. 연결을 지우는 것은 같은 회차 값을 덮어쓸 때뿐이다.
- 기존 `StudioRelationship` 노드는 없앤다. 다른 세계관이 같은 관계 ID를 쓰지 못하게 막는 확인은 연결의 `relationId`·`worldId`로 한다.
- 세계관 노드(`StudioRelationshipWorld`)의 CAS token·요청 key/hash·잠금(`mutex`)은 그대로 쓴다.
- 세계관 노드의 `count`는 이 세계관의 `RELATED` 연결 수(종료 연결 포함)로 뜻을 바꿨다. 조회마다 실제 연결 수와 비교해 다르면 `RELATIONSHIP_VERSION_MISMATCH`(409)다. 아직 이전하지 않은 기존 세계관이 빈 관계 성공으로 보이지 않게 하는 점검이기도 하다.

### 회차 기준

- 회차는 연결된 소설의 회차 순번 `episode.sequence`다. 독자 공개 회차 `revealFromEpisode`와 같은 번호다.
- 소설이 연결되지 않은 세계관은 모든 관계를 1화로 기록한다.
- 회차 삭제·순서 변경으로 번호가 바뀌어도 연결의 `fromEpisode`는 옮기지 않는다(ponytail 한계, 필요해지면 별도 결정).

### 조회

N화 시점 관계: 관계마다 `fromEpisode <= N`인 연결 중 가장 최근 하나를 고르고, 그것이 종료 연결이면 뺀다.

```cypher
MATCH (a:StudioCard)-[e:RELATED {worldId:$world}]->(b:StudioCard)
WHERE e.fromEpisode <= $ep
WITH e ORDER BY e.fromEpisode DESC
WITH e.relationId AS id, head(collect(e)) AS e
WHERE NOT e.ended
RETURN id, startNode(e).id AS source, endNode(e).id AS target, e.payload
```

구현은 이 규칙의 설명용 질의와 달리 세계관의 연결을 한 질의로 모두 읽고(세계관 노드의 token·`count`와 함께), 같은 규칙을 코드(`relationsAsOf`)로 적용한다. 같은 관계·같은 회차의 가장 최근 연결이 둘이면 손상으로 보고 `RELATIONSHIP_VERSION_MISMATCH`다.

| 호출 | 회차 |
|---|---|
| 작가 관리 화면·초안 조회 (`GET /api/v1/world-studios/{id}?episode=N`, MCP `world_studio_read`) | 요청의 회차, 생략하면 최신 |
| 공개 세계관 조회·목록의 관계 수 | 기준 회차(DEC-53): 연결된 소설의 발행된 마지막 회차, 소설이 연결되지 않았으면 1화 |
| 독자 설정 위키 `GET /public/works/{id}/world-cards?upto=` | `upto`(카드와 같은 기준이라 관계 스포일러도 막힌다) |

### 저장

- 저장 API는 지금처럼 'N화 시점의 관계 전체'를 받는다. 저장소가 N화 시점 값과 비교해 바뀐 관계만 `fromEpisode=N` 연결로 넣고(같은 관계·회차가 있으면 덮어씀), 목록에서 빠진 관계는 종료 연결을 넣는다. 회차를 생략하면 최신 회차다.
- N화를 고쳐도 N화보다 뒤 회차에 이미 있는 연결은 바꾸지 않는다.
- 카드 삭제(`lifecycle=removed`, `replace=true`에서 생략)는 `episode`를 생략한 최신 편집에서만 한다. 회차를 지정한 편집이 카드를 삭제하면 422 `WORLD_INPUT_INVALID`다(아래 '한계 ①').
- PG prepare → Neo4j CAS → PG finalization 순서, 원래 요청 재시도, 오류 코드는 아래 #132 계약을 그대로 따른다.

### 구현 결과

- **API**: `GET /api/v1/world-studios/{id}?episode=N`(선택)과 `PUT /api/v1/world-studios/{id}/draft` 본문의 `episode`(선택)는 1 이상의 정수다. 아니면 422 `WORLD_INPUT_INVALID`이고 저장 전에 거절한다(쿼리는 문자열로 받아 Spring 변환 400이 되지 않게 한다). 응답의 `relationships`는 요청한 회차 시점이며 저장 응답도 저장한 회차 기준이다. MCP `world_studio_read`·`world_studio_edit_draft`도 같은 `episode`를 받는다. 공개 세계관 조회는 최신, 독자 설정 위키는 `upto` 시점이다. 카드·revision 응답 모양은 바뀌지 않았다.
- **저장 회차**: 요청의 `episode`, 생략하면 그 세계관 연결의 가장 큰 `fromEpisode`(종료 연결 포함), 연결이 하나도 없으면 1화다. 본문의 관계는 그 회차 시점의 관계 전체이고 upsert 모드(`replace=false`)는 그 시점 관계에 합쳐 전체로 만든다. 저장소가 그 시점 값과 비교해 새로 생겼거나 끝점·내용이 바뀐 관계만 `fromEpisode=N` 연결로 쓰고 목록에서 빠진 관계는 종료 연결을 쓴다. 바뀐 것이 없으면 연결을 쓰지 않고 세계관 노드의 token·key/hash만 올린다.
- **덮어쓰기·끝점 변경**: 같은 관계의 같은 회차 연결이 있으면 지우고 새로 쓴다. 끝점이 바뀌어도 그 회차에는 연결이 하나만 남는다. N화보다 뒤 회차의 연결은 건드리지 않는다.
- **미완성 관계**: 양 끝 카드 중 하나라도 비어 있는 활성 관계는 저장할 수 없다(요청 검증 422 `WORLD_INPUT_INVALID`, 저장 순서 1단계 전). `lifecycle="removed"`로 표시한 관계는 끝이 비어도 되며 그 시점 목록에서 빠져 종료 연결이 된다. 아래 #132의 '미완성 nullable endpoint 허용'을 대체한다.
- **다른 세계관 ID 차단**: 다른 세계관의 연결이 같은 `relationId`를 쓰거나 카드가 다른 세계관 소속이면 이전처럼 그래프 콜백 안에서 거절한다(`WorldNotFound` → 확정 비적용 → `409 WORLD_WRITE_REJECTED`). 같은 key/hash 재시도의 멱등성과 token 불일치 처리는 #132와 같다.
- **화면**: `/worldstudio/:id` 관계도 보기의 `관계 기준 회차` 칸이 소설을 연결한 서버 세계관에서만 `GET ?episode=N`으로 그 회차 관계를 다시 읽고(비우면 최신) 저장에 같은 값을 본문 `episode`로 보내며, 저장하지 않은 변경이 있거나 메모리 데모면 잠근다. 지난 회차 관계의 끝점이 삭제된 설정이면(응답의 `lifecycle=removed` 카드) '삭제된 설정'(응답이 준 그 카드의 이름이 있으면 '삭제된 설정: 이름')으로 읽기 전용이고 저장 시 그대로 보낸다(한계 ①). 카드 삭제는 회차를 생략한(최신) 저장에서만 허용되고 회차를 지정한 저장의 카드 삭제는 서버가 422로 거절하므로, 회차를 고른 동안에는 설정 삭제 진입점(편집 화면 삭제·레일 ⋮ 삭제·인물 삭제)을 '설정 삭제는 최신 회차에서 할 수 있어요.'와 함께 잠그고 삭제 처리도 거절하며 삭제는 최신 회차에서 한다. 지난 회차를 연 채 저장하면 저장 영역·검토·저장 단계가 '관계는 N화 기준으로 저장돼요'를 알리고, AI 후보 검토·확정 버전 요청 중에도 회차 선택을 잠근다.
- **기존 데이터**: [`infrastructure/neo4j/dec51-relationship-edges.cypher`](../../infrastructure/neo4j/dec51-relationship-edges.cypher)가 `StudioRelationship`을 `fromEpisode=1`·`ended=false` 연결로 옮긴다. 공유 Neo4j 데이터라 실행 전에 승인을 받으며 아직 실행하지 않았다. 이전 전의 기존 세계관은 `count`가 연결 수와 달라 조회가 `RELATIONSHIP_VERSION_MISMATCH`이고 빈 관계로 보이지 않는다.
- **한계**: ① 편집에서 그 회차 시점의 관계와 완전히 같게 둔 관계는 지난 회차에 이미 삭제된 카드가 끝점이어도 그대로 통과한다(끝점이 이 세계관의 카드이기만 하면 된다). 새로 만들거나 끝점·내용을 바꾼 관계는 양 끝이 활성 카드여야 하므로, 삭제한 카드를 끝점으로 하는 관계를 새로 잇거나 고칠 수는 없고 빼면 그 회차에 종료 연결이 생긴다. 다만 **카드 삭제는 `episode`를 생략한(최신) 편집에서만** 할 수 있다: 이번 요청이 삭제하는 카드(요청 전 초안에서 활성이던 카드, `replace=true`에서 생략한 카드 포함)가 있는데 `episode`를 지정하면 422 `WORLD_INPUT_INVALID`다(지난 회차 시점의 관계만으로는 최신 관계에 그 카드가 남는지 알 수 없다. 그 회차에서 끝낸 관계를 더 뒤 회차에서 같은 내용으로 다시 이었을 수 있다). 최신 편집에서도 삭제하는 카드를 끝점으로 하는 관계가 저장 결과에 남으면 같은 422이므로 그 관계는 `lifecycle=removed`로 보내거나 `replace=true`에서 생략해 함께 빼야 한다(#341). 이미 반영된 재시도는 두 검사를 모두 건너뛴다. 최신 관계에 삭제 카드 끝점이 남아 AI 초기 세계관 적용의 활성 카드 사전 검사(`InitialWorldAdditionMapper.build`)가 422로 거절하던 것을 저장 쪽에서 막은 것이며 매퍼는 바꾸지 않았다. 최신 관계에 없는 지난 회차 관계는 삭제된 카드를 끝점으로 계속 가질 수 있다. 이 세계관의 카드가 아닌 끝점은 어느 경우에도 422로 거절한다. 조회도 삭제된 카드를 이 세계관의 카드로 본다. ② `RELATED`에 인덱스가 없어 세계관 조회와 관계 ID 확인이 모든 연결을 훑는다. ③ 관계 ID는 노드가 없어 두 세계관이 같은 새 ID를 동시에 처음 쓰는 경합은 잠그지 못한다(이미 커밋된 ID는 막는다).

### 기존 데이터

지금 있는 `StudioRelationship` 관계는 `fromEpisode=1` 연결로 한 번 옮긴다. 공유 Neo4j 데이터라 실행 전에 승인을 받는다. 이전 스크립트: [`dec51-relationship-edges.cypher`](../../infrastructure/neo4j/dec51-relationship-edges.cypher)(한 트랜잭션·멱등, 양 끝이 모두 있는 관계만 옮기고 `count`를 새 뜻으로 다시 센다. 끝이 비어 옮기지 못한 관계는 노드로 남기며 스크립트의 점검 조회로 확인한다).

### 범위 밖

관계 이력 복원 API, 관계를 포함한 세계관 전체 restore(카드만 초안으로 되돌리기는 [아래](#확정-버전으로-카드-되돌리기와-세계관-삭제-2026-11-17)가 지원한다), 같은 회차 정정 이력, 회차 재배치, 인물 자체의 회차별 상태(카드 값).

## 카드 본문 링크 — DEC-53

**상태: 설계 확정(2026-11-18 사용자 결정, [#485](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/485)), 3단계 소스 구현·로컬 단위 테스트와 링크 관련 렌더 테스트 5개 파일(MarkdownEditor·CardMarkdown·PublicWiki·WorldCardPage·WorldStudioPage, jsdom 273건) 통과, hosted CI 통합 테스트·전체 렌더 레인·브라우저 육안 확인 미확인.** 카드 본문에서 같은 세계관의 다른 카드를 가리킨다. 링크는 본문이 그 카드를 말했다는 **언급**이고, 정의된 연결은 관계(Neo4j, 회차별)가 맡는다. 링크를 관계로 올리는 후보는 발표 뒤에 AI가 내고 작가가 승인한다(DEC-36).

### 저장 표기

- 본문 안 `[글자](card:<uuid>)`이다. 마크다운 링크 문법이라 마크다운 편집기(Toast)가 글을 그대로 보존한다. `<uuid>`는 대상 카드의 논리 ID(`setting_card.id`)라 제목·별칭을 바꿔도 링크는 깨지지 않는다.
- 별도 컬럼·메타데이터 키를 두지 않는다. 본문 문자열이 정본이고 카드 버전·확정·되돌리기가 본문과 함께 보존한다. 저장할 때 대상 id는 검사하지 않는다(`importedFrom`처럼 문자열 그대로 저장한다. 지운 카드·다른 세계관의 id도 저장되고 읽는 쪽이 치환한다).
- 공개 렌더러(`CardMarkdown`)는 파서(react-markdown)가 읽은 `a`마다 그 노드의 **원문**(`position`)이 아래 정규식 전체에 맞는지(`cardLinkOf`)로 설정 링크인지 정하고, 맞을 때만 쓰는 화면이 준 `cardLink`가 링크 요소를 돌려주면 링크로 그린다(카드 페이지는 `/worlds/:id/cards/:cardId`, 독자 위키는 같은 위키 안 그 카드의 문서, 응답에 없는 카드는 글자만). 파서는 정규식이 링크로 보지 않는 모양(`<card:A>`·`[갑](<card:A>)`·제목이 붙은 링크·글자에 대괄호나 줄바꿈이 든 링크)도 `card:` 주소로 읽지만 그런 모양은 글자만 보인다. 편집기 미리보기(Toast)는 sanitizer가 `card:` 주소를 지우므로 링크 렌더러가(원문 `sourcepos`가 정규식에 맞는 링크만) 해시 주소와 data 속성으로 바꾸고, 누르면 그 카드의 편집 화면을 연다(초안에 없는 카드는 아무 일도 없다). 요약(`plainCardText`)은 `[글자](주소)`를 글자로 줄인다(테스트로 확인했다).
- 링크 하나는 글자를 뺀 약 45자(`[` + `](card:` + UUID 36자 + `)`)를 쓰고 카드 본문 3,000자 한도에 포함된다.
- 기존 연관 설정(`semanticMetadata.studio.item.relatedIds`)은 이전하지 않는다(읽기 전용이고 AI 초기 추출만 기록한다). 카드 페이지의 '연관 설정'은 `relatedIds`와 링크 대상을 합쳐 표시만 한다.
- 입력은 편집기 바로 위 줄의 `설정 링크` 버튼이 여는 검색(이름·별칭)에서 대상을 고르면 `[선택한 글자 또는 대상 제목](card:<uuid>)`을 넣는 방식이다(`[`·`]`·줄바꿈은 뺀다). 인라인 `[[` 자동완성은 두지 않는다. 버튼은 Toast 도구 줄 밖에 둔다(도구 줄은 좁으면 끝 항목을 더보기로 숨겨 눌러 쓰기 어렵다). 카드 본문(인물은 IDENTITY.md)에만 있다(SOUL·GOAL·회차 기억 문서에는 없다). 검색 패널은 그 버튼 아래, 편집기 바로 위에 열려 검색 칸에 초점이 가고, Esc·`닫기`로 닫으면 버튼으로 돌아오며, 편집 중인 카드를 뺀 같은 세계관 카드를 최대 30개 보인다. 가리키는 설정(백링크)은 서버가 계산하지 않고 화면이 받은 본문에서 계산한다.

### 문법 (정규식 하나)

본문을 줄·코드·이스케이프 같은 마크다운 문맥 없이 통째로 훑어 아래 정규식에 맞는 곳을 링크로 본다. 코드 블록·인라인 코드 안의 것도 링크다(문맥을 보지 않으므로 서버 치환이 파서 차이로 새지 않는다). 서버(Kotlin)·화면(TypeScript)·AI 입력 경계(Python)가 이 정규식과 [검증 표](#링크-검증-표)를 같은 결과로 따로 구현한다. 정규식의 글자 집합은 JavaScript 기준이고 길이는 UTF-16 단위로 센다.

```text
\[([^\[\]\r\n]{1,200})\]\(card:([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\)
```

- 글자는 `[`·`]`·줄바꿈을 뺀 1~200자다. UUID의 16진수는 대소문자를 가리지 않고 id를 비교할 때는 소문자로 맞춘다. `card:`는 소문자뿐이다.
- 이 모양이 아니면 링크가 아니라 글자 그대로다. 외부 주소 링크는 이 문법이 아니라 기존 마크다운 그대로다.
- 마크다운 파서는 이 정규식이 링크로 보지 않는 모양도 `card:` 주소의 링크로 읽을 수 있다: 글자에 `[`·`]`·줄바꿈이 든 링크(`[[갑]](card:A)`), 자동 링크(`<card:A>`), 꺾쇠 주소(`[갑](<card:A>)`), 제목이 붙은 링크(`[갑](card:A "t")`). 그런 모양은 링크가 아니라 글자이고 화면은 링크로 그리지 않는다. 대신 서버와 AI 입력 경계는 링크를 바꾼 뒤 남은 `card:<uuid>`(대소문자 무시)를 대상이 보이는 카드가 아니면 지운다: 숨은 카드의 id가 응답이나 모델 입력 어디에도 남지 않게 하려는 것이다.

### 처리 규칙

| 처리 | 곳 | 규칙 |
|---|---|---|
| 숨김 치환 | 서버: 독자 설정 위키·공개 세계관 상세·Fork 이어받기 응답의 카드 `text`와 관계 `body` | 대상 id가 그 응답의 보이는 카드에 없으면 `[글자](card:<uuid>)`를 `글자`로 바꿔 id를 지우고, 링크가 아닌 모양에 남은 `card:<uuid>`도 같은 기준으로 지운다. 있으면 그대로 둔다. 세 응답이 같은 함수를 쓴다([공개 쪽 규칙](public-world-contract.md#본문-링크의-공개-응답)) |
| 글자로 벗기기 | AI 입력 경계: Content가 AI 요청을 만들 때(세계관 검토 `WorldReviewInput`의 카드 본문·인물 문서, 원고 Q&A의 관계 근거 본문, 초기 분석 입력 `InitialWorldInput`의 카드 본문 출처), ai-service가 MCP 응답을 스냅샷·요청으로 바꿀 때(`world_snapshot`: 시뮬레이션·평점·원고 검토, `world_review`의 채팅 경로) | 맞는 곳을 모두 `글자`로 바꾸고 남은 `card:<uuid>`도 지운다(대상이 보이든 아니든). 모델 입력·BM25에 UUID가 섞이지 않게 한다. 초기 분석은 출처 해시·근거 구간(UTF-16 오프셋)이 걸린 입력이라 벗긴 글을 출처 원문으로 삼는다: 해시·구간은 벗긴 글 기준이고 `InitialWorldInput.validateAgainst`가 같은 규칙으로 저장 초안에서 다시 만들어 견준다([입력 스냅샷](initial-world-input-snapshot.md)) |
| 가져오기 | 화면: 공개 상세 응답을 내 세계관 초안으로 복사할 때 | 같이 가져온 카드끼리만 새 id로 바꿔 잇고 나머지는 글자로 바꾼다 |
| 백링크·끊긴 링크 | 화면(작가 화면은 초안, 공개 화면은 받은 보이는 카드) | 받은 본문에서 계산한다. 작가 화면은 카드 편집 화면의 연관 설정에 이 카드가 건 링크(`본문 링크`)와 이 카드를 가리킨 링크(`본문에서 가리킴`)를 넣고, 공개 화면은 카드 페이지의 '이 카드를 가리키는 설정'에 넣으며 둘 다 게시판 연결 수에 센다(관계로 이미 이어진 카드는 관계 쪽이 보인다). 대상이 초안에 없거나 삭제된 링크를 끊긴 링크로 표시하는 일은 발표 뒤 확장('끊긴 링크' 점검)으로 미룬다: 지금은 연관 설정에 넣지 않고 미리보기에서 눌러도 아무 일도 하지 않는다 |

### 링크 검증 표

서버·화면·AI 입력 경계의 단위 테스트가 아래 행을 모두 담는다. 표의 `A`·`B`는 UUID `aaaaaaaa-2222-3333-4444-555555555555`·`bbbbbbbb-2222-3333-4444-555555555555`로 바꿔 읽는다(`card:1111`처럼 형식이 틀린 값만 그대로 쓴다). '보이는 id'는 숨김 치환에 주는 응답의 카드 id 집합이다.

| 본문 | 찾는 링크 (글자, id) | 글자로 벗긴 결과 |
|---|---|---|
| `[승상](card:A)` | (`승상`, A) | `승상` |
| `앞 [갑](card:A) 중 [을](card:B) 뒤` | (`갑`, A), (`을`, B) | `앞 갑 중 을 뒤` |
| `[갑](card:A)[을](card:B)` | (`갑`, A), (`을`, B) | `갑을` |
| `[갑](card:AAAAAAAA-2222-3333-4444-555555555555)` | (`갑`, A) — 대소문자 무시 | `갑` |
| 인라인 코드(백틱) 안의 `[갑](card:A)` | (`갑`, A) — 코드 안도 링크 | 인라인 코드 안의 `갑` |
| `[](card:A)` | 없음 — 글자 0자 | `[]()` |
| `[갑](card:1111)` | 없음 — UUID 형식이 아님 | 그대로 |
| `[갑](card: A)` | 없음 — 공백 | 그대로 |
| `[갑](CARD:A)` | 없음 — `card:`는 소문자뿐 | `[갑]()` — 남은 `CARD:A`를 대소문자 무시로 지운다 |
| `[갑](https://example.com)` | 없음 — 외부 링크 | 그대로 |
| `[[갑]](card:A)` | 없음 — 글자 안의 `[`·`]` | `[[갑]]()` |
| 글자 안에 줄바꿈이 있는 링크 `[갑⏎을](card:A)` | 없음 | `[갑⏎을]()` |
| 글자 200자 + `](card:A)` | (200자, A) | 200자 |
| 글자 201자 + `](card:A)` | 없음 — 200자 초과 | `[201자]()` |
| `[갑[을]](card:A)` | 없음 — 글자 안의 `[`·`]` | `[갑[을]]()` |
| `[갑]을](card:A)` | 없음 | `[갑]을]()` |
| `([갑](card:A))` | (`갑`, A) | `(갑)` |
| `card:A` | 없음 — 링크 모양이 아님 | 비움(``) |
| `<card:A>` | 없음 — 자동 링크 모양 | `<>` |
| `[갑](<card:A>)` | 없음 — 꺾쇠 주소 | `[갑](<>)` |
| `[갑](card:A "t")` | 없음 — 제목이 붙음 | `[갑]( "t")` |

| 본문 | 보이는 id | 숨김 치환 결과 |
|---|---|---|
| `[승상](card:A)` | {A} | 그대로 |
| `[승상](card:A)` | {} 또는 {B} | `승상` |
| `앞 [갑](card:A) 뒤 [을](card:B)` | {B} | `앞 갑 뒤 [을](card:B)` |
| 인라인 코드 안의 `[갑](card:A)` | {} | 인라인 코드 안의 `갑` |
| `[갑](card:AAAAAAAA-2222-3333-4444-555555555555)` | {A} | 그대로 — 대소문자 무시 |
| `card:A`(링크 모양이 아님) | {A} | 그대로 |
| `card:A` | {} | 비움 — 링크는 아니지만 숨은 카드의 id라 지운다 |
| `<card:A>` | {A} | 그대로 |
| `<card:A>` | {} | `<>` |
| `[갑](<card:A>)` | {} | `[갑](<>)` |
| `[갑](card:A "t")` | {} | `[갑]( "t")` |
| `[[갑]](card:A)` | {A} | 그대로 |
| `[[갑]](card:A)` | {} | `[[갑]]()` |
| `[갑](card:A) <card:B>` | {B} | `갑 <card:B>` |
| `[갑](CARD:A)` | {} | `[갑]()` |

글자로 벗기기는 첫 표의 '글자로 벗긴 결과' 칸이고 보이는 id가 비어 있는 숨김 치환과 같다. 화면은 첫 표의 '찾는 링크' 칸에 있는 것만 링크로 그린다.

## 「동일 인물」 관계 — DEC-53

**상태: 설계 확정(2026-11-18 사용자 결정, [#485](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/485)), 소스 구현(4단계: Content·AI·화면, 로컬 단위 테스트 통과, 병합·hosted CI 통합·브라우저 육안 확인 전). DEC-51 기존 관계 이전의 승인·실행이 선행한다(이전 전의 세계관은 관계 조회가 409라 저장도 시뮬레이션도 막힌다).** 나중에 밝혀지는 이름·가면(예: '검은 옷의 사내'가 사실은 '아무개')은 한 카드의 부분 공개가 아니라 카드를 둘로 나누고 이 관계로 잇는다(DEC-36 유지). 기록하지 않은 두 카드는 두 사람이다: 이름·내용이 비슷해도 서버·화면·AI가 합쳐 읽지 않는다.

| 항목 | 규칙 |
|---|---|
| 값 | 관계 `category: identity`. 서버가 받는 `structural`·`emotional`에 하나를 더한다(`RelationshipInputHelper`·AI 관계 모델·화면 종류) |
| 방향 | 다른 이름 카드(가면, 관계의 시작) → 본체 카드(관계의 대상). 방향 관계(`direction: directed`)여야 하고 `polarity`가 `denied`인 관계는 한 사람으로 묶는 데 쓰지 않는다 |
| 끝점 | 두 카드 모두 인물(`cardType=character`) 카드여야 하고 자기 자신과 이을 수 없다 |
| 사슬·순환 금지 | 한 카드는 가면이거나 본체다(둘 다일 수 없다). 한 가면의 본체는 하나이고 본체 하나에 가면 여럿은 허용한다. 검사는 저장 결과의 최신 회차 시점 identity 관계 전체에서 한다(중간 회차 시점의 사슬은 보지 않는다. 그래서 A→B를 3화에 끝내고 B→C를 2화에 쓰는 것처럼 중간 회차에만 남는 사슬은 저장되고, 그 회차로 읽는 Fork 시뮬레이션은 409로 실패한다. 한계) |
| 저장 회차 필수 | identity 관계를 새로 쓰거나 바꾸거나 끝내는 저장은 `episode`를 지정해야 하고 생략하면 422 `WORLD_INPUT_INVALID`다. 생략한 저장은 마지막 관계 회차(없으면 1화)로 기록되고 관계는 확정 버전 없이 초안 저장 즉시 독자에게 반영되므로, 두 카드가 이미 공개된 이중 신분이면 저장하는 순간 정체가 드러난다. 소설이 연결되지 않은 세계관은 화면이 `episode: 1`을 보낸다 |
| 오류 | 아래는 모두 422 `WORLD_INPUT_INVALID`다(새 오류 코드는 없다): `episode` 없이 새로 쓰기·바꾸기·끝내기(`replace=true`로 빼서 끝내는 것 포함), `direction`이 `directed`가 아님, 끝점이 인물 카드가 아님·자기 자신, 한 가면에 본체 둘, 본체가 가면(사슬·순환), 카드 유형을 바꿔 끝점이 인물이 아니게 됨 |
| 유형 변경 | 인물이던 카드를 인물이 아닌 유형으로 바꾸는 저장은 저장 회차와 무관하게 저장 결과의 최신 시점 identity의 끝점이 모두 인물인지 본다(사슬·순환 검사와 같은 읽기, `Neo4jRelationshipRepository.readAfter`). identity가 4화부터인데 3화로 저장하며 본체 카드를 장소로 바꾸는 저장도 막는다. 유형을 바꾸지 않는 저장은 이 읽기를 하지 않는다 |
| 설정 삭제와 저장 | 설정 삭제는 `episode`를 지정할 수 없고(위 '한계 ①') identity를 새로 쓰거나 바꾸거나 끝내는 저장은 `episode`가 필수라 둘을 한 요청에 담을 수 없다. identity가 이어진 설정은 먼저 관계를 끝내(회차 지정) 저장한 뒤 설정을 지운다. 화면은 identity 변경과 설정 삭제(그 관계와 상관없는 설정 포함)를 한 저장에 담지 않고 둘로 나눠 저장하라고 알린다 |
| 문서 | SOUL·GOAL·회차 기억은 본체 카드에만 둔다(가면 카드는 이름과 `IDENTITY.md` 본문뿐이며 서버는 막지 않고 화면이 가면 카드 편집 화면에서 본체 입력으로 안내한다). 진실을 아는 인물은 자기 회차 기억(`memory/NN회차.md`)에 적는다 |
| 공개 | 다른 관계와 같다([공개 세계관 계약](public-world-contract.md#동일-인물의-공개)). 공개 화면의 관계 종류 표시에서 `identity`는 '동일 인물'로 보인다 |
| 시뮬레이션 | 한 사람으로 묶어 읽는다([시뮬레이션 계약](character-simulation-contract.md#동일-인물--dec-53)) |
| 화면 | 관계 작성 패널의 '동일 인물' 칸은 인물 카드 둘에서만 열리고 본체를 고르며 관계 기준 회차가 있어야 적용한다(소설을 연결하지 않은 세계관은 1화로 기록한다고 알리고 `episode: 1`을 보낸다). 본체가 작가 전용(공개 회차 없음)이면 다른 인물이 본체를 알 수 있다고 경고한다. 시뮬레이션 시작 양식은 같은 사람의 두 카드를 함께 고르지 못하게 잠근다(내 세계관과 Fork가 이어받은 세계관 모두) |

## 현재 관계 MVP 계약 — #132

> **DEC-51로 대체됨(소스 구현, hosted CI 대기).** 관계 저장 모델·시점 조회·미완성 관계 거절은 위 절을 따르고, 저장 순서·인가·부분 실패 계약은 계속 유효하다. 이 절의 '현재 상태 하나' 서술은 DEC-51 이전 설명이다.

2026-11-05 사용자 변경 결정: **관계 내용은 Neo4j의 현재 상태 하나만 정본으로 저장한다. 관계 변경 이력·과거 snapshot·버전 조회·복원은 만들지 않는다.** DEC-27·33의 관계 이력 보존에 대한 이번 MVP만의 예외이며, 인물·설정·원고의 기존 버전 기능과 기존 SQL·데이터를 폐기하는 결정은 아니다. 아래 V1 설계는 역사적 기록이며, 관계 저장·HTTP 연결·실행 소유권은 이 절과 Content 실행 계약을 우선한다. 소스 구현은 병합·hosted CI·실제 이관·배포 완료와 다르다.

### 저장과 인가

- Content의 `WorldStudioController → WorldStudioService → JPA / Neo4jRelationshipRepository`가 처리한다. Core의 기존 인증 확인으로 검증된 UUID Principal만 사용하며 body owner ID·체험 actor를 신뢰하지 않는다. 모든 개별 조회/변경은 소유 world를 먼저 검사한다. 변경 요청의 Bearer·쿠키·CSRF 경계를 유지한다.
- PostgreSQL은 world/card UUID·소유권·카드 원문·기존 카드 버전/manifest와 요청 상태만 소유한다. 추가 V2의 `relationship_state`는 graph token·생성 hash·최근 key/hash·예상 draft revision·완료 여부만 저장한다. 관계 내용·관계 snapshot·outbox를 이중 저장하지 않는다.
- 기존 V1의 12개 테이블과 SQL 바이트는 보존하고 V2로 상태 테이블 하나만 추가한다. 새 경로는 기존 PG `relationship*`/`world_revision_relationship`에 쓰지 않는다. 과거 데이터의 실제 Neo4j 이관은 승인·실행하지 않았고 자동 backfill/import도 없다. 전환 marker가 없는 기존 world는 빈 관계 성공이 아니라 `migration_required`다.
- Neo4j는 안정적인 world/card/relation UUID, 한 쌍의 다중 관계, 방향/대칭·극성·구조/감정·자유 본문·label·semantic metadata를 현재 값으로 보존한다. 삭제는 현재 edge/payload를 제거하며 교차 world 재사용 방지용 ID 예약만 남을 수 있다(DEC-51 이후: 현재 값이 아니라 회차별 연결로 보존하고 삭제는 종료 연결을 추가한다). `relationshipVersion`/`graphVersion`은 CAS·정합성 token이지 과거 관계를 조회할 수 있는 버전이 아니다.
- 관계 endpoint는 같은 world의 카드여야 하고, 새로 만들거나 바뀐 관계는 활성 카드만 참조한다(그 회차 시점 관계와 같게 둔 관계는 지난 회차에 이미 삭제된 카드도 허용하되 이번 요청이 삭제하는 카드는 최신 편집에서만 지울 수 있고 거기 이어진 관계는 남길 수 없다, 위 '한계 ①'). DEC-51 이후 관계는 양 endpoint가 모두 있어야 저장하며 미완성(nullable) endpoint는 422 `WORLD_INPUT_INVALID`다(위 '구현 결과'). 요청당 카드·관계 최대 1,000개, 편집 요청 직렬화 크기 2 MB, key 1~200 UTF-8 바이트를 검사한다.
- 관계의 병합 결과는 회차 시점 활성 관계 최대 10,000개다. `removed`로 끝내는 관계는 활성 총량에서 제외한다. 요청당 1,000개 제한은 삭제 표시에도 적용하며, 서버 내부에서 읽은 전체 관계의 정합성 검사는 요청 건수 제한과 분리한다.
- 2026-11-16 사용자 결정: 세계관 하나의 활성 설정 카드는 병합 결과 최대 10,000개다. 삭제된 카드는 이 총량에 포함하지 않으며 기존 카드 수정은 새 카드 추가로 세지 않는다. AI 초기 세계관 승인 추가도 기존 활성 카드와 새 카드의 합을 검사한다. 이 총량은 단일 요청 카드 최대 1,000개와 별개이며, 요청별 관계 한도와 2 MB 제한도 그대로다.

### 두 저장소의 부분 실패

1. 짧은 PG transaction에서 소유권·draft revision·key/hash를 검사하고 새 카드 **논리 ID만** 예약한다. pending receipt를 커밋하며 아직 카드 원문·세계관 이름은 바꾸지 않는다.
2. PG transaction 밖에서 Neo4j의 현재 상태를 CAS 교체한다. 같은 expected token + key/hash의 정확한 재시도는 이미 반영된 현재 결과를 반환한다. 다른 내용·낡은 token은 충돌이다. 다른 world의 관계/endpoint UUID를 callback 안에서 거절하여 graph transaction 비적용이 확정된 경우에만, 소유권·key/hash·예상 draft revision·graph token이 그대로인 pending receipt를 별도 PG transaction으로 해제한다. 카드 원문·현재 graph token은 바꾸지 않고 예약한 카드 UUID는 보존한다. 이 해제의 커밋까지 확인한 뒤 `409 WORLD_WRITE_REJECTED`를 반환하며 해제 실패·다른 receipt·통신/CAS 실패는 미확인 상태로 남긴다.
3. 짧은 PG transaction에서 acknowledgement와 receipt를 확인하고 카드 원문·기본 정보·현재 token을 반영하며 draft revision을 한 번 증가시킨다. 이후 두 저장소의 token·카드 membership·PG 재확인을 통과한 현재 조회만 성공한다.
   일반 편집의 upsert(`replace=false`)는 요청한 카드만 갱신하며, 전체 교체(`replace=true`)는 생략된 카드를 삭제 상태로 반영한다.
4. Neo4j 성공 뒤 PG 실패나 응답 유실은 분산 rollback으로 숨기지 않는다. pending 조회는 실패하고, **원래 expected revision·key·입력 그대로** 재시도하면 PG finalization을 재개한다. 마지막 완료 receipt만 보관하므로 후속 저장 이후 낡은 요청을 영구 replay하는 계약은 아니다.

Frontend HTTP adapter는 같은 세계관·초안 revision·회차의 조회 기준과 현재 편집값을 비교해 변경·삭제 카드와 관계만 `replace=false`로 보낸다. 기준이 없거나 revision·회차가 다르면 입력을 보존하고 전송 전에 거절한다. 변경·삭제 카드 또는 관계가 각각 1,000건을 넘거나 요청 크기 추정치가 1,999,000바이트를 넘으면 전송 전에 거절하며 자동으로 분할하거나 부분 저장하지 않는다(서버의 2 MB 검사를 위한 여유 포함). Frontend HTTP adapter는 원래 요청 body/key를 탭 메모리에만 보존하고 모호한 실패 뒤 바뀐 입력의 재전송을 차단하며, 미확인 요청은 조회 기준을 다시 검사하기 전에 원래 body/key 그대로 재시도한다. 확실한 `422 WORLD_INPUT_INVALID`와 `409 WORLD_WRITE_REJECTED`만 pending을 해제하여 재조회·수정·새 key를 허용한다. `WORLD_WRITE_REJECTED`는 기존 pending/같은 완료 요청이 아닌 prepare 전 stale draft 거절 또는 위 graph 확정 비적용 후 PG 해제 완료에만 사용한다. 일반 `WORLD_CONFLICT`·관계 token 불일치·503은 같은 body/key를 유지한다. 새로고침·프로세스 종료로 원래 body를 잃으면 자동 복구할 수 없다. 대기 요청을 버리거나 다른 내용으로 강제 완료하는 관리 기능·worker는 이번에 만들지 않았다. 원래 입력을 보존해야 하며 승인 없는 실제 DB 복구/수동 변환은 하지 않는다.

### 공개 API와 화면

nginx/Vite의 `/api/v1/world-studios` exact 및 하위 경로는 Content:8081로 간다. 그 밖의 기존 인증 URL은 Core를 유지한다. Frontend는 `View → ViewModel → UseCase → HttpWorldStudioRepository`에서 상대 URL만 호출하며 Neo4j·AI에 직접 접근하지 않는다.

| 메서드·경로 (`/api/v1/world-studios` 기준) | 동작 |
|---|---|
| `GET /` | 소유 world 요약과 `current` / `incomplete` / `migration_required` 상태 |
| `POST /` | caller UUID를 사용한 생성·같은 입력 재시도 |
| `GET /{id}` | token이 일치하는 현재 카드와 `?episode=N`(선택, 생략하면 최신) 시점의 관계 전체 |
| `PUT /{id}/draft` | 기본 upsert, `replace=true`면 전체 교체. 본문 `episode`(선택, 생략하면 최신 회차) 시점의 관계로 저장하고 관계 삭제도 이 요청으로 반영(종료 연결) |
| `POST /{id}/revisions` | 기존 카드·설정의 불변 revision 저장. 관계 snapshot 없음 |
| `GET /{id}/revisions/{revisionId}` | 기존 카드 revision 조회. `relationships=null`, `relationshipStatus=not_recorded` |
| `POST /{id}/revisions/{revisionId}/restore` | 확정 버전의 **카드만** 초안으로 되돌린다(본문 `expectedDraftRevision`, 응답은 되돌린 초안). 관계·이름·새 확정 버전은 그대로([규칙](#확정-버전으로-카드-되돌리기와-세계관-삭제-2026-11-17), 2026-11-17) |
| `DELETE /{id}` | 세계관 소프트 삭제(204, V9). 연결된 소설이 있으면 409 `WORLD_LINKED`([규칙](#확정-버전으로-카드-되돌리기와-세계관-삭제-2026-11-17), 2026-11-17) |
| `PUT /{id}/publication` | 세계관 단위 공개 범위(`private`/`public`)·장르 설정(V6, [DEC-45](decisions.md)). 카드·관계·revision은 바꾸지 않는다 |
| `PUT·DELETE·GET /{id}/cover` | 세계관 표지(PNG·JPEG·WebP 5MB 이하 multipart `file`) 저장·교체·삭제·소유자 읽기(V7). 바이트는 객체 저장소, DB에는 키·형식만 두며 카드·관계·revision은 바꾸지 않는다 |

공개 조회는 소유자 API가 아니라 비로그인 읽기 전용 `GET /api/v1/public/world-studios`·`/{id}`가 맡는다. 공개이고 저장 버전이 있는 세계관만 마지막 저장 버전에서 기준 회차 이하로 공개된 카드(DEC-46·53)와 그 카드끼리의 Neo4j 기준 회차 시점 관계를 보이며(관계 이력 API는 여전히 없다) 참조 이용·Fork는 없다([계약](public-world-contract.md)). 상세에는 이 세계관에 연결된 소설이 공개 작품일 때만 그 최소 정보(`linkedWork`, #329)가 붙는다(같은 계약). 설정 가져오기는 화면이 이 공개 API로 읽은 카드를 내 세계관 초안에 복사해 `PUT /{id}/draft`로 저장하는 것이라 전용 API가 없다. 소유자 응답(`GET /`의 요약과 `GET /{id}`·`PUT /{id}/draft`·`POST /`의 초안 응답)에는 이 세계관에 연결된 소설 `linkedWorkId`가 붙는다(1:1, 정본은 Content `work.world_studio_id`, 같은 계약). 공개 표지는 같은 기준일 때만 `GET /api/v1/public/world-studios/{id}/cover`로 읽는다. 이 경로의 nginx/Vite 라우팅도 Content:8081이다.

기존 관계 편집·관계도는 서버가 확인한 현재 draft를 사용한다. UI의 저장 버튼은 현재 draft PUT이며 카드 revision POST·공개·발행을 자동 실행하지 않는다. AI 후보는 연결하지 않았다. 이탈 시 요청을 취소하고 늦은 응답 설치를 막는다. 지원하는 `semanticMetadata.studio`가 없거나 현재 UI 모델과 불일치하는 서버 응답은 임의 변환/빈 데이터로 대체하지 않고 실패한다. 카드 `semanticMetadata` 최상위의 `revealFromEpisode`·`importedFrom`(DEC-46, 독자 공개 회차와 가져오기 출처)은 `studio` 밖에 따로 두며 모양이 어긋나면 그 값만 버리고 로드는 계속한다([계약](public-world-contract.md)). 기존 데이터 호환 import는 별도 승인 대상이다.

| 오류 code | HTTP | 의미 |
|---|---|---|
| `RELATIONSHIP_MIGRATION_REQUIRED` | 409 | 기존 world 전환 필요 |
| `RELATIONSHIP_WRITE_INCOMPLETE` | 503 | 원래 요청 재시도가 필요한 pending |
| `RELATIONSHIP_VERSION_MISMATCH` | 409 | PG/Neo4j token·참조 불일치 |
| `RELATIONSHIP_STORE_UNAVAILABLE` | 503 | Neo4j 연결·저장 실패 |
| `WORLD_WRITE_UNCONFIRMED` | 503 | PG 쓰기/커밋 결과 미확인 |
| `WORLD_WRITE_REJECTED` | 409 | 확정 비적용이며 pending이 없으므로 최신 조회 후 수정 가능 |
| `WORLD_CONFLICT` | 409 | 요청 충돌, 비적용을 보장하지 않으므로 같은 body/key 보존 |
| `RELATIONSHIP_HISTORY_UNSUPPORTED` | 409 | 관계를 포함한 과거 세계관 전체 복원 미지원 |
| `WORLD_RESTORE_BLOCKED` | 409 | 확정 버전으로 되돌리면 사라질 설정에 현재 관계가 이어져 있음(설정 이름을 알린다) |
| `WORLD_LINKED` | 409 | 연결된 소설이 있어 세계관을 삭제할 수 없음 |

현재 관계를 과거 revision에 끼워 넣지 않는다. 확정 버전 복원은 **카드만 초안으로** 되돌리며(아래 절, 2026-11-17 사용자 결정) 관계는 과거 값으로 되돌리지 않는다. 회차 시점 관계 조회는 DEC-51로 지원하지만 관계를 과거 값으로 되돌리는 복원과 관계까지 포함한 체크포인트/Fork는 미지원이다(`RELATIONSHIP_HISTORY_UNSUPPORTED`는 Q&A 문맥의 과거 관계 요청에 쓴다). 원고·인물·설정의 기존 버전 데이터와 관계 없는 버전 기능은 유지한다.

### 확정 버전으로 카드 되돌리기와 세계관 삭제 (2026-11-17)

2026-11-17 사용자 결정으로 기존에 차단하던 `restore`를 아래 의미로 구현하고 세계관 삭제를 더한다(새 DEC 번호는 아직 없다).

**확정 버전으로 카드 되돌리기** — `POST /api/v1/world-studios/{id}/revisions/{revisionId}/restore`, 본문 `{ "expectedDraftRevision": n }`, 응답은 되돌린 초안(기존 초안 응답, 관계는 최신 회차).

- 소유자만 한다. 없는 버전·확정(`sealed`)되지 않은 버전·다른 세계관의 버전·남의 세계관은 404, 낡은 `expectedDraftRevision`은 409 `WORLD_CONFLICT`다. `save`처럼 관계 저장 미완료(503)·미확인 AI 적용이 있으면 하지 않는다.
- **카드만, 초안으로**: 초안의 카드 집합이 그 버전의 카드(내용·공개 범위·`semanticMetadata` 그대로, 그 버전에서 삭제 상태였던 카드는 삭제 상태 그대로)가 된다. 그 버전에 없던 현재 활성 카드는 내용을 둔 채 `removed`가 되고 이미 삭제된 카드는 그대로다. 세계관 이름·설명·공개 설정·표지와 관계(Neo4j)는 바꾸지 않는다.
- **새 확정 버전은 만들지 않는다.** 작가가 기존 `확정 버전 남기기`(`POST /{id}/revisions`)로 직접 남긴다. restore는 행을 만들지 않으므로 `restored_from_*` 칼럼(`world_revision`·`setting_card_version`)에는 쓰지 않고, 초안 revision을 한 번 올리며 초안의 기준 확정 버전(`base_world_revision_id`, 응답 `baseWorldRevisionId`)만 되돌린 버전으로 바꾼다. 확정 버전의 `currentRevisionId`는 그대로다.
- **관계 끝점 보호**: 사라질 카드가 **현재(최신 회차) 관계의 끝점**이면 아무것도 바꾸지 않고 409 `WORLD_RESTORE_BLOCKED`(사라질 설정 이름 5개까지 + 나머지 개수)로 거절한다. 작가가 관계부터 정리한 뒤 다시 시도한다. Neo4j는 PG transaction 밖에서 읽고, 쓰기(PG 한 transaction) 직전에 초안 revision과 관계 token이 그대로인지 다시 확인한다.
- 텍스트 복원은 과거 이미지까지 보장하지 않는다(DEC-39). 이미지는 바뀌지 않는 행이라 되돌린 카드가 가리키던 이미지는 그대로 남아 있다.
- 화면: 확정 버전 시트에서 연 버전의 `이 버전으로 초안 되돌리기`. 확인 창이 사라지는 설정 카드 수·"관계는 그대로"·이미지 안내를 보이고, 저장하지 않은 변경·미확인 확정/AI 요청이 있으면 이유와 함께 잠근다. 성공하면 서버 초안을 다시 읽어 화면에 반영하고 서버 거절 이유는 그대로 보인다.

**세계관 삭제** — `DELETE /api/v1/world-studios/{id}` → 204. WorldStudio `V9__world_soft_delete.sql`이 `worldstudio.world.deleted_at timestamptz`(NULL 허용)만 더한다. 규칙은 [공개 세계관 계약](public-world-contract.md#세계관-삭제-2026-11-17-사용자-결정)이 정한다: 소프트 삭제(데이터 보존), 소유자·공개 조회 모두 없는 것으로 다룸, 연결된 소설이 있으면 409 `WORLD_LINKED`.

### 설정과 검증 경계

WorldStudio는 기능 플래그 없이 항상 켜져 있다. Content 서버 시작 시 `world_studio_schema_history`로 전용 schema를 migrate한 뒤 validate하며(repair·baseline 없음), Core 인증 자격과 Neo4j 연결(local·dev compose의 `neo4j` 컨테이너)이 필요하다. `NEO4J_URI/USERNAME/PASSWORD/DATABASE`는 Content 런타임만 받으며 Frontend·Core·AI·build ARG로 전달하지 않는다. 네이티브 기본 URI는 `bolt://127.0.0.1:7687`다.

소스 검증용 `base + docker-compose.prod.yaml`에는 opt-in `worldstudio` profile의 `neo4j:5.26.0-community`, 별도 `worldstudio-neo4j` volume, loopback Bolt 포트만 둔다. 이 조합의 username은 `neo4j`, password는 별도 비밀값(8자 이상), URI는 내부 `bolt://neo4j:7687`을 사용한다. 이미지 전용 `docker-compose.dev.yaml`은 그래프를 자동 배포하지 않으며 승인된 외부 Neo4j가 필요하다. profile·flag가 실제 migration/데이터 이관/기동을 승인하지 않는다.

로컬은 선택 순수 단위·설정 계약·Compose `config --quiet`만 확인한다. Content HTTP/PG/Neo4j 및 React/Hook 통합 회귀는 CI 소스에 두고 격리 자원으로 실행한다. 실제 Core 로그인·nginx를 통과한 Studio HTTP 시스템 시나리오는 추가하지 않았다. hosted `Required CI`·브라우저·실제 이관·배포는 별도 대기이며 관계 이력·시점 복원 기능표는 ❌로 유지한다.

## 플랫폼 장르 템플릿 세계관

장르별 예시 템플릿 26개(카드 1254장, 인물 379명, [안내](../../infrastructure/sample-data/genre-templates/README.md))는 기존 운영 관리자 계정(Core `auth/V8__member_admin_operations.sql`의 `admin@example.test`, 회원 UUID `5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01`, `operator=true`)에 **임시 할당**해 그 계정이 소유하는 **WorldStudio 독립 세계관으로만** 둔다. 운영자로 로그인하면 세계관 목록에서 보인다. 작품·회차·체크포인트로는 넣지 않으며 사용자 샘플 CSV와 섞지 않는다.

- **적재 경로:** WorldStudio 읽기는 Neo4j 현재 상태 노드가 필요해 SQL로 넣을 수 없다. Content 서버 시작(`ApplicationReadyEvent`) 때 `GenreTemplateSeeder`가 classpath `genre-templates.json`을 읽어 기존 `WorldStudioService`의 create → edit(`expectedDraftRevision=0`) → save를 운영 관리자 subject(`GenreTemplateSeeder.TEMPLATE_OWNER`)로 호출한다. 새 템플릿의 세계관 공개 설정·행 생성·1회 처리 marker는 같은 PG 트랜잭션에서 처리한다. 일반 세계관 기본값은 비공개이며, 별도 쓰기 경로나 Neo4j 직접 쓰기는 없다.
- **멱등:** 세계관 ID는 장르별 고정, edit·save key는 `genre-template-<장르>`다. 최초 v1 적재에서는 저장까지 끝난 세계관(`currentRevisionId`가 있음)을 건너뛰며, 이후 별도의 v2 보완을 검사한다. save가 draft revision을 올려 같은 edit의 중복 판정이 `WORLD_CONFLICT`로 바뀌기 때문이다. 앞선 edit가 미완료(`RELATIONSHIP_WRITE_INCOMPLETE`)로 남은 세계관은 create가 같은 코드로 거절하므로 이를 무시하고 같은 요청으로 edit를 재시도한다.
- **실패:** Neo4j·PG 장애 등 장르별 실패는 장르·예외 클래스·메시지만 `error`로 남기고 다음 장르와 서버 기동을 계속한다. 다음 시작 때 같은 방식으로 다시 시도한다. `genre-templates.json`을 읽지 못해도 `error`만 남기고 기동하며 그 시작에서는 적재하지 않는다.
- **한계(PG만 초기화):** PostgreSQL만 초기화하고 Neo4j 데이터가 남으면 고정 worldId의 create가 graph mismatch(`RELATIONSHIP_VERSION_MISMATCH`)로 실패해 해당 장르가 재시작마다 오류 로그만 남기고 적재되지 않는다. 둘을 함께 초기화해야 한다. CI처럼 여러 PG가 Neo4j 하나를 공유하면 컨텍스트마다 오류 로그가 나오지만 테스트는 깨지지 않는다.
- **한계(임시 소유자):** 템플릿을 기존 운영 관리자 계정에 임시로 할당했다. ① V8 샘플 관리자 비밀번호가 마이그레이션 주석에 공개되어 있어 그 계정으로 로그인하면 누구나 템플릿을 수정·삭제할 수 있다. 실제 운영 계정·공개 템플릿 조회가 생기면 소유자를 바꾼다. ② V8은 `ON CONFLICT (email) DO NOTHING`이라 기존 DB에 `admin@example.test`가 다른 id로 있으면 템플릿 소유자가 실제 로그인 계정과 다를 수 있다. ③ 초기 상태를 증명하지 못해 제외된 비공개 템플릿은 소유자가 공개하기 전까지 다른 사용자에게 보이지 않는다. 소유자를 바꿔도 이미 적재된 세계관은 옮겨지지 않는다. 고정 worldId의 create가 소유자 불일치로 거절(`WorldNotFound`)되어 장르별 오류 로그만 남으므로, 소유자 변경 때는 기존 세계관(PG·Neo4j)을 승인 하에 정리해야 한다.
- **v2 보완:** 기존 장르 11종의 최초 적재 입력만 `genre-templates-v1.json`으로 동결하고, 최초 저장 뒤 `GenreTemplateRepair`가 v1과 동일한 이름·설명·카드 및 관계 없는 revision 2만 갱신한다. 세계관 ID와 과거 저장 버전은 유지하며, 새 개별 카드 ID는 UUIDv5(worldId, `setting:` + key)다. 기존 카드 ID는 과거 저장 버전에 남는다. 고정 key `genre-template-<장르>-repair-v2`와 expected revision 2로 edit 후 revision 3을 save하며 미완료 작업은 같은 요청으로 재시도한다. 사용자 수정·완료된 보완은 건너뛰므로 새 카드를 자동 적용하지 않는다. 기존 미완료 v2와 변경된 입력의 hash가 다르면 서비스가 거절하고 오류를 기록한다. 창작 11종의 386장은 원본 설정에서 추출하며 첫 화 원고·집필 지침·장편 전개는 원본에 보존하고 활성 카드에서 제외한다. v2 본문·유형·메타데이터는 배포 후 동결하며 이후 임의 수정은 자동 반영 대상이 아니다. 자세한 절차는 [샘플 README](../../infrastructure/sample-data/genre-templates/README.md#v2-보완과-기존-데이터-반영)를 따른다.
- **SOUL 보완:** 이전 26종의 최초 요청과 기존 11종의 v2 보완은 `genre-templates-v2.json` 스냅샷을 사용해 기존 key·hash를 유지한다. `genre-template-<장르>-soul-v1`은 DEC-47의 `semanticMetadata.characterDocs`에 `soul`, 빈 `goal`, 빈 `episodes`만 더한다. 기존 세계관은 카드 전체(제거 카드와 메타데이터 포함), 이름·설명·관계, 초안 및 관계 revision과 두 저장 이력(기존 11종) 또는 최초 저장 이력(15종)이 고정 기준과 일치할 때만 `replace=true`로 보완한다. 사용자 카드 수정·삭제·관계·문서 변경과 수정 후 되돌린 이력은 revision 또는 내용 불일치로 건너뛴다. 편집 후 저장 전 재시도는 같은 key·hash를 사용하고, 미완료의 다른 요청이나 Neo4j 장애는 오류로 남긴다. 머지 전 `memory` 형식의 PR 후보를 별도로 실행해 미완료 요청이 남은 환경은 새 `goal` 입력과 hash가 달라 자동 재개하지 않으므로 이전 입력으로 완료해야 한다(기존 26종 SOUL 보완에 해당하며, 역사 7종의 중단된 최초 적재는 런타임 제외 후 자동 복구하지 않는다). 공개 범위·장르·표지는 쓰지 않으며, 공개 설정의 과거 변경 후 복원 이력은 초안으로 증명할 수 없다. 보완 후 기존 확정 버전은 유지된다.
- **역사 연구 7종:** 기존 `GenreTemplateSeeder`의 최초 시드에서 제외하고, 확장 후보 경로는 기본 꺼짐으로 둔다. 확장 경로를 승인 후 켜면 없는 세계관과 아래 조건을 통과한 저장 완료 원본만 처리한다. 이미 저장된 옛 카드·관계는 삭제하지 않으며 과거 중단된 역사 시드 요청은 자동 복구하지 않고 오류로 보류한다. 독립 역사 감수·원저 저작권 및 일부 인용 검토는 미완료다. 미국 자료의 CC BY-SA 4.0 저작 표시와 변경 이력, 장별 기여자는 [역사 자료 안내](../../infrastructure/sample-data/genre-templates/history/README.md)에 보존한다.
- **역사 설정집 후보:** `history/studio/`는 검토용이며 시드 입력이 아니다. 후보 인물의 SOUL은 선택 사항이고 제공된 값은 유효해야 하며 GOAL은 필수가 아니다. 기존 창작·신화 26종의 SOUL 필수 계약은 유지한다. 후보 확인과 빈 DB 또는 기존 DB 반영은 별도의 안전성 검증 및 사용자 승인 후 진행한다. 같은 세계관 ID의 다른 create 입력은 creation hash가 충돌하고 미완료 edit도 기존 key와 다른 hash를 거절한다. 공개 설정 이력·동시 기동을 포함한 실제 이관은 검증하지 않았다.
- **확장 후보의 최초 적재:** `sample-worlds-expanded/manifest.json`은 기본 꺼진 `app.worldstudio.expanded-seed-enabled`가 켜진 경우 새 적재를 시작한다. 꺼진 경우에는 이미 시작해 미완료 marker가 남은 세계관만 동일 고정 입력·hash로 재개한다. 원본의 서비스·DB 사용 제한과 재배포 조건 확인, 독립 역사 감수 및 사실 검토가 끝나기 전에는 새 적재를 켜지 않는다(#425). 입력 리소스가 바뀌어 hash가 달라지거나 없어 원 요청을 복원할 수 없으면 실패를 기록하고 marker를 지우지 않으며 관리자 개입 전 관계를 unavailable로 유지한다. 없는 역사·전승 세계관은 새로 만들고, 기존 26종은 아래 원본 확인 조건을 통과한 경우에만 증분 적용한다. 신규 world와 적재 marker는 같은 PG 트랜잭션에서 비공개로 만들고 전체 입력 hash와 청크 진행을 보존한다. 모든 카드 청크를 먼저, 관계 청크를 다음에 고정 key·revision으로 upsert하여 양 끝점의 순서 문제를 피하고 마지막에 한 번 확정한다. 요청은 카드·관계 각 1,000건과 2 MB를 넘지 않아야 한다. PG pending → Neo4j → PG 최종화와 같은 입력 재시도를 사용하고, 입력 변경·사용자 편집·공개 선택·기존 확정 버전이 감지되면 더 진행하지 않는다. 최종 저장·최초 공개와 완료 표식은 같은 PG 트랜잭션이다. 과거 역사 미완료 요청의 원본 입력 복구는 후속이다. Neo4j의 5초 트랜잭션 제한과 전체 관계 탐색은 대량 데이터에서 성능을 측정하지 않았다.
- **기동 순서:** 동일한 `ApplicationReadyEvent`에서 기존 장르 시더를 확장 시더보다 먼저 실행한다. 개별 장르의 기존 시드가 실패하면 기존 오류·확장 보류 로그를 남기고, 다른 세계관과 서버 기동은 계속하며 다음 기동에 다시 시도한다.
- **기존 26종 증분 적용:** 공개 1회 marker가 있고 V9 이후 소유자 메타데이터 변경이 없으며 동결 create·edit·save 입력, 초안·전체 확정 이력, 현재 카드와 모든 회차의 관계 없음이 일치한 원본만 대상으로 한다. V9 이전 공개·표지 원복 이력은 구별할 수 없으나 현재 원본인 경우 1회 공개를 허용한 기존 사용자 결정을 따른다. 확장 시작 시 world 잠금 아래 미완료 marker를 먼저 커밋하고 청크의 PG pending → Neo4j → PG 확정 순서를 유지한다. 미완료 동안 공개 상세·독자 위키는 기존 확정 카드를 유지하되 관계를 `unavailable`로, 목록 관계 수는 `null`로 표시한다. Neo4j 조회 앞뒤로 marker와 PG graph token·현재 revision을 재확인해 적재 시작이나 완료와 경합한 관계를 보이지 않는다. 기존 world의 공개·표지·일반 편집·확정 저장·AI 적용은 미완료 marker가 있으면 충돌로 거절하고 원래 적재 key/hash만 재개한다. 소유자의 공개 상태는 바꾸지 않으며 최종 revision과 marker 완료는 같은 PG 트랜잭션에서 확정한다. 관계 방향과 근거 내용 감수는 권리 확인과 별도 선행조건이다. 소스·CI 검증 중이다.
- **AI 검토 경계:** 확장 중인 초안은 AI 검토로 전송하지 않고 `WORLD_CONFLICT`로 거절한다. 검토용 초안 조회의 PG 단계 전후에 marker를 확인한다. 조회 이후 확장이 시작돼도 AI에는 조회 시점에 고정한 이전 완전 초안만 전달되며, 검토 결과는 기존대로 저장하지 않는다.
- **옛 역사 7종의 확정 원본:** 18a1cf의 최초 create·edit·save 입력과 모든 카드/버전·관계 이력을 확인해 원본으로 증명한 경우 현재 공개 선택을 유지하며 후보를 추가한다. 옛 카드 158장은 확장 후보와 ID가 달라 삭제·병합하지 않고 그대로 두므로 이전 DB의 카드 총량은 신규 DB와 다를 수 있다. 옛 요청이 미완료이거나 최초 원본을 증명할 수 없으면 보류한다. 미완료 옛 요청을 같은 입력으로 안전하게 재개하는 경로는 아직 구현하지 않았다.
- **v2 교체·이력:** 관계가 없는 pristine 세계관만 `replace=true`로 편집하여 이전 카드를 `removed`로 표시하고 새 카드만 활성으로 둔다. `replace` 자체도 요청 hash에 포함되므로 이전에 미완료된 같은 key의 요청과 충돌할 수 있으며 거절을 성공으로 처리하지 않는다. v1의 확정 버전은 불변이고, 제목·본문이 있는 제거 카드는 새 버전에도 이력으로 남는다. 따라서 이전 첫 화·집필 지침이 활성 카드에서는 빠져도 버전 이력에서 삭제되지는 않는다.
- **신화·고전 15종(카드 868장):** v1 동결본에서 제외하고 각 장르 작품과 선택적 보충 출전에 근거한 카드로 create → edit → save한다. 처음부터 `templateOrder`와 유형 메타데이터를 넣고 사건은 event/history로 적재한다. 한국어 번역 전문과 번역 문단 복제는 저장하지 않는다. 기존 검증용 DB에 다른 내용으로 동일 ID가 있으면 자동 교체하지 않고 충돌을 기록한다. 사용자 편집과 저장된 세계관은 재시작 시 보존한다. 카드마다 출처와 문헌 범위를 표시하며 Neo4j 관계선은 자동 생성하지 않는다.
- **출처 참조:** `source/sources.md`에는 기존 편집 앵커와 원전 URL·위치가 있다. 편집 앵커는 원전의 공식 문단 번호가 아닐 수 있으며, 이집트 자료 등은 작품 단위 위치만 제공해 카드별 구절을 특정하지 못한다. 선택적 `supplementary.md`는 기존 출전·원어 발췌를 유지하며, `narrative_refs`는 문서와 앵커, 보충 출전에는 중복 문장 대신 발췌 SHA-256을 둔다. 생성기는 문서·고유 앵커·URL과 보충 발췌의 해시 및 500자 제한을 검증한다. 한국어 원고를 제거했으므로 과거 문단과의 정확한 일치나 외부 원전·카드의 사실 관계는 자동 검증하지 못하며 편집 검토가 필요하다.
- **우선 주제·기존 카드 검사:** `infrastructure/sample-data/test_myth_sources.py`가 사용자 요구(PR #287 추가 요청)의 우선 주제를 확인한다: 그리스 트로이 전쟁·영웅·명계, 북유럽 라그나로크·묠니르·궁니르·아홉 세계, 크툴루 아컴·인스머스·르뤼에·네크로노미콘·외신, 서유기(별도 `journey_to_the_west` 세계관) 일행·여정(팔십일난)·법보. 주제마다 제목에 이름이 있고 카드 유형이 맞으며(장소 `location`·신물 `object`·사건 `event`·인물 `character`) 설명(출전 줄을 뺀 30자 이상과 주제 관련 단어)과 출전 링크가 있는 **서로 다른 카드**가 하나씩 있어야 하며, 한 카드가 여러 주제를 대신할 수 없다. 신화 15종의 기존 카드는 세계관 ID·카드 ID·순서·유형을 앞 N장의 해시로 고정하므로 새 카드는 뒤에 추가한다. 카드 공개(`public`)는 적재기가 모든 템플릿 카드에 일괄 적용하므로 데이터에 카드별 값을 두지 않는다. 이설은 모든 전승에 요구하지 않는다. 카드에 "이설"이라고 쓴 경우에만 서로 다른 근거 절 2개 이상과 서로 다른 출전 URL 2개 이상을 요구한다. 본문에는 `- [출전명](URL): 해당 출전의 설명` 줄을 출전마다 두고 각 설명은 10자 이상이면서 서로 달라야 하며, 각 출전은 실제로 참조한 절의 URL과 연결되어야 한다(`genre-templates/test_traditions.py`). 문장의 사실 관계와 차이를 정확히 설명하는지는 편집자가 확인한다.
- **공개 계약:** 신규 플랫폼 템플릿은 세계관과 카드를 공개로 생성한다. 확정 저장 전에는 공개 목록에 나타나지 않으며, 저장 후에는 봉인된 현재 버전의 활성 공개 카드만 보인다. 생성 요청 hash와 edit·save 요청은 그대로 유지한다. 최초 PG 생성 직후 Neo4j 장애가 나도 공개 설정이 함께 저장되어 같은 요청으로 재시도할 수 있다.
- **기존 DB 1회 공개:** 사용자 결정으로 고정 worldId와 임시 소유자의 기존 비공개 샘플 중 현재 원본과 일치하는 것만 최초 한 번 공개한다. 생성 hash, 관계 완료·PG/Neo4j 최종 key/hash와 graph version, 모든 회차의 관계 없음, draft/base/current revision, 동결 v1/v2/SOUL 카드 전체(삭제 포함), 봉인된 모든 저장 revision·카드 버전·정확한 save 요청과 현재 genre·표지 기본값을 검사한다. 비공개 카드 확정본·사용자 수정·원복 이력·확인된 불일치는 제외한다. 미완료 요청은 보류하고 완료 후 다시 검사한다. 과거 공개 해제와 장르·표지 변경 후 기본값으로 원복은 기록이 없어 구별할 수 없고 현재 원본이면 1회 공개하기로 사용자가 명시 결정했다.
- **marker와 오류:** WorldStudio V9의 `owner_metadata_version`은 소유자의 공개·표지 요청마다 증가하고 표지 업로드는 객체 저장 전 증가해 그래프 조회 중 동일 값으로 되돌린 선택도 감지한다. V9 이후 이 값이 증가한 세계관은 공개 대상에서 제외한다. `template_publication_once`는 세계관당 하나이며 world 잠금 아래 공개와 같은 PG 트랜잭션에 기록한다. 이미 공개된 것, V9 이후 소유자가 공개·표지를 선택한 것 또는 판정이 달라 제외된 것에는 marker를 남겨 나중에 원복·비공개해도 자동 공개하지 않는다. 미완료 요청은 marker 없이 보류한다. 행이 없는 템플릿은 시더가 신규 생성할 때 marker를 함께 기록한다. 소유자 불일치·DB/Neo4j 장애·토큰 불일치는 오류로 기록하며 공개하지 않는다. 일시적 그래프·DB 장애나 일관성을 확인할 수 없는 조회 불일치는 marker 없이 오류로 남겨 다음 시작에 재시도한다. 같은 버전에서 확인된 최종 key/hash 불일치는 영구 제외하고 오류를 기록한다. 보류 사이 소유자가 공개·비공개나 표지를 명시했다면 다음 잠금 판정에서 marker를 기록하고 공개하지 않는다. v2 또는 최신 리소스 로딩 실패 시 기존 샘플 공개 판정을 보류하며, 해당 템플릿의 동결 리소스가 빠져도 판정을 보류한다. PG와 Neo4j는 분산 트랜잭션이 아니므로 graph 조회 후 같은 world 잠금 아래 모든 PG 판정 근거와 완료·토큰을 다시 확인한다. 기존 카드와 불변 이력은 바꾸지 않는다.
- **후속(미구현):** 템플릿을 통째로 복사해 새 세계관으로 시작하는 흐름과 Fork 연계는 없다. 공개 템플릿의 공개 카드는 설정 가져오기(DEC-46)로 복사할 수 있다. 서버 시작 적재는 로컬 단위(저장소·서비스 대역)로만 확인했고 실제 PG·Neo4j 실행과 배포는 확인하지 않았다.

## 기준

초기 세계관은 작품과 회차가 없어도 생성·편집·확정 저장할 수 있다. WorldStudio가 자신의 논리 식별자·초안·불변 버전·확정 묶음을 소유한다. 기존 Content 테이블과 migration 순서에 의존하지 않는다.

이전 안의 `setting_document/setting_draft/setting_version` ALTER, Content V1~V7 선행 조건과 `contentRepository` 시작 의존은 채택하지 않는다. 기존 공유 Content/Auth 테이블과 Flyway 이력은 그대로 둔다. 이전 V1/V2 SQL은 검토 기록으로 보존하며 새 독립 초기 SQL로 오인해 배포하지 않는다.

## 저장 경계

같은 PostgreSQL 서버/DB를 쓰더라도 전용 `worldstudio` schema에 테이블을 둔다. 기존 `public.world` 등과 이름이 겹치지 않고 공유 데이터에 ALTER를 수행하지 않는다. 실제 서버·DB·계정은 적용 전 확인해야 하며 CORE/CONTENT 주소가 같다고 가정하지 않는다.

Flyway location은 `classpath:db/migration/worldstudio`로 유지하되 독립 V1 내용을 새로 작성한다. history는 `worldstudio.world_studio_schema_history`에 둔다. 이전 SQL이 적용된 DB에서는 체크섬 변경·repair로 바꾸지 않는다. 기존 적용 여부를 먼저 확인하고, 적용돼 있다면 별도 전환 migration을 설계한다. 빈 schema의 V1에는 다른 서비스 이력을 baseline으로 재사용하지 않는다.

평소 서버 시작으로 DDL을 실행하지 않는다. 명시적인 migration 실행에서만 대상 DB/schema와 기존 이력을 검사하고 migrate/validate를 수행한다. WorldStudio API를 활성화하는 것과 migration 실행은 별도 설정이다.

> 현재: `WorldStudioConfig`는 조건 없이 Content DataSource로 전용 persistence unit을 만든다. 아래는 과거 기록이다.

`WorldStudioConfig`는 명시적으로 `app.worldstudio.enabled=true`인 경우에만 전용 WORLDSTUDIO_DATABASE_*와 JPA persistence unit을 만든다. Core/Content DB URL로 fallback하지 않으며 Auth/Content 초기화 의존도 없다. 기존 Auth는 자기 Entity 패키지만 스캔하므로 수정하지 않는다. 기존 Content 공존 검증은 데이터 보호를 위한 일회성 opt-in 테스트이며 이후 독립 저장 검증의 선행 조건이 아니다.

과거 확장 이력은 이름/버전 번호만으로 차단하지 않는다. 보관 SQL의 정확한 version·script·Flyway checksum·SQL type·성공 여부를 함께 확인한다. 타 도메인의 정상 동명 V1/V2와 다른 체크섬은 허용한다.

## 테이블과 책임

| 테이블 | 핵심 정보와 책임 |
|---|---|
| world | 안정적인 world ID, 소유자 식별자, 생성 시각, 현재 확정 revision 참조, 세계관 단위 공개 설정(V6 `visibility` 기본 `private`·`genre`·`published_at`, DEC-45), 소유자 표지(V7 `cover_object_key`·`cover_content_type`, 바이트는 객체 저장소). 작품/회차 FK 없음(소설과의 1:1 연결은 Content `work.world_studio_id`가 정본이고 FK 없이 값만 가리킨다, DEC-46) |
| world_draft | world당 이름·설명, draft_revision, base_world_revision_id, 수정 시각. 자동저장 대상 |
| setting_card | card ID, world ID, 생성 시각. 제목이나 유형 변경에도 ID 유지 |
| setting_card_draft | card별 제목·원문·card_type·area_code·별칭·태그·자유 분류·semantic metadata·lifecycle·visibility. 초안 |
| setting_card_version | 안정적인 version ID와 card ID, 버전 순번, 동일한 카드 필드 및 visibility snapshot, 생성 시각·복원 기준. 불변 |
| relationship | relation ID, world ID. 실제 관계·감정의 안정적인 논리 식별자 |
| relationship_draft | source/target card, structural/emotional, 자유 본문·선택 label, direction/polarity/lifecycle. 미완성 입력은 nullable 허용 |
| relationship_version | 완성 검증한 방향별 관계 snapshot. 한 쌍 사이 여러 관계·감정 보존. 불변 |
| world_revision | revision ID·world별 순번·이름/설명 snapshot·부모/복원 revision, 생성 시각. 확정 저장 단위 |
| world_revision_card | revision에 포함된 card/version의 정확한 manifest |
| world_revision_relationship | revision에 포함된 relation/version의 정확한 manifest |
| world_save_request | world별 멱등 키·요청 hash·성공 revision. 재시도 중복 저장 방지 |

태그와 별칭은 처음에는 초안/버전의 문자열 배열로 snapshot한다. 사용자 자유 텍스트를 같은 의미라고 추론해 합치지 않는다. 공유 Content tag master를 참조하지 않는다. 교차 세계관 태그 검색 사전은 필요가 확정될 때 별도로 설계한다.

Graph DB·outbox·projection worker·AI job·이미지 저장소는 이 초기 정본 migration에 넣지 않는다. 다른 담당 기능과의 확정 계약이 생기면 후속 migration으로 연결한다.

## 유형·영역·기존 의미

card_type은 character/location/organization/ability/object/rule/event/other 8종이다. area_code는 basic/space/history/society/culture/special/conflict 7종이다. 자유 분류·태그와 별도이며 같은 축으로 합치지 않는다.

기존 JSON의 kind/predicate/polarity/대상 ID/조건/topics/원문 근거는 명시적 import 계약이 생기면 semantic metadata와 적절한 관계 구조에 보존한다. claim/undetermined/note를 other로 일괄 변환하지 않는다. 이번 독립 초기 설계는 기존 H2/Content 데이터를 자동 이관하거나 새 ID로 교체하지 않는다.

## 무결성과 저장

- 같은 world의 카드만 관계 endpoint와 manifest에 연결한다. world/card/version 식별자 관계를 복합 FK로 보장한다.
- 초안 자동저장과 명시 저장을 분리한다. world_draft.draft_revision을 비교해 충돌을 감지하고 실패하면 기존 초안·확정본을 유지한다.
- 명시 저장은 소유권·초안 revision·멱등 hash 검증, 새 카드/관계 버전 생성, manifest 조립, revision 확정과 현재 포인터 갱신을 한 트랜잭션으로 실행한다.
- 조립 중 revision은 커밋할 수 없게 하고 확정 뒤 manifest와 버전은 수정·삭제할 수 없게 한다. 복원은 새 version/revision이다. 구체 봉인 trigger는 새 V1 SQL에서 테스트한다.
- 활성 관계의 양 endpoint는 같은 revision의 활성 카드여야 한다. 관계 입력은 선택적이며 미등록을 관계 없음의 확정 사실로 해석하지 않는다.
- 카드·관계 삭제는 lifecycle tombstone을 새 버전에 기록한다. 과거 version/manifest를 삭제하지 않는다.
- 카드 초안과 불변 버전 모두 `visibility`를 가지며 기본값은 `private`다. `public` V2에서 `private` V1을 복원하면 V3에 V1의 비공개 정책도 복사한다. 명시 저장은 발행이 아니며 카드의 public만으로 독자 접근을 허용하지 않는다. 카드의 공개는 하나의 설정으로 정한다(DEC-53): `semanticMetadata.revealFromEpisode`('N화부터 공개')가 있으면 그 값, 없고 `visibility=public`이면 1화, 그 밖은 작가 전용이다. 공개 세계관·독자 설정 위키·가져오기·Fork는 마지막 저장 버전의 활성 카드 중 그 회차가 기준 회차(연결된 소설의 발행된 마지막 회차, 소설이 연결되지 않았으면 1) 이하인 것과 그 카드끼리의 기준 회차 시점 관계만 보인다([계약](public-world-contract.md#카드-공개-기준-일원화--dec-53)). 새 저장은 `revealFromEpisode`만 쓰고 `visibility`는 값이 있으면 `public`, 없으면 `private`로 맞춰 저장한다. 인물별 지식·상태의 회차별 공개는 이후 계약으로 연결한다.

## 인증과 회차 연결

인증은 Core의 검증된 Principal을 사용한다. world 소유자는 요청 body의 ownerId나 체험 actor로 결정하지 않는다. `owner_subject`는 PostgreSQL `uuid`이며 Auth/Content FK는 없다. 현재 `auth/entity/AuthMember.kt`는 UUID ID를 사용하고 `SessionService.user/access`는 이를 `UUID.toString()`으로 JWT subject에 발급한다. `SessionController`와 `ProfileController`는 검증된 Jwt.subject를 `UUID.fromString`으로 읽는다. UUID 값으로 저장하므로 대소문자 문자열 비교나 임의 trim/lowercase 정규화는 하지 않는다. 이메일·닉네임·Content member ID로 변환하지 않는다.

JWT 서명·만료 검증과 Principal→UUID 변환은 호출 계층의 책임이다. 독립 Service는 UUID subject를 인자로 받아 모든 읽기/쓰기에서 소유 world를 먼저 잠그고 대조한다. DB 소유자 컬럼이나 FK 부재가 HTTP 인증 완료를 뜻하지 않는다. SQL 관리자 권한으로는 소유권 검사를 우회할 수 있다. 이번에는 독립 Entity·JpaRepository·Service까지만 연결하며 HTTP Controller·기존 작업실 UI는 연결하지 않는다.

### 집필 회차의 기준 세계관 (기능 87)

2026-11-10 사용자 결정에 따라 작가는 소유한 WorldStudio의 봉인된 버전을 집필 회차의 기준으로 선택·조회·변경한다. Content는 회차에 세계관 UUID와 버전 UUID를 함께 기록한다. WorldStudio는 소유권과 해당 세계관의 봉인된 버전을 확인하며 작품·회차를 참조하지 않는다. 두 스키마의 검증과 기록은 각각의 트랜잭션에서 수행하고 회차 선택을 저장할 때 작품 소유권과 회차 수정 가능 여부를 다시 확인한다.

- `GET/PUT /api/v1/works/{id}/episodes/{number}/world-basis`는 소유자의 선택과 변경을 처리한다. 선택 전 응답에는 `basis: null`과 수정 번호가 들어 있다. 수정 번호가 바뀐 상태에서 다른 버전을 선택하면 409로 응답한다. 같은 버전의 재시도는 현재 선택을 돌려준다. 원작에서 상속한 회차는 기준 세계관을 조회·선택하지 않으며 두 요청 모두 403이다.
- `GET /api/v1/world-studios/{id}/revisions`는 소유한 세계관의 봉인된 버전 목록을 반환한다. 집필실에서 기존 확정 저장 API로 현재 저장된 인물·설정을 새 버전으로 만들 수 있고, 기준으로 선택한 버전의 설정은 기존 버전 상세 API로 읽는다.
- 적용 범위는 집필실의 회차 참조다. 발행본·Fork 기준·집필 AI 문맥과 Neo4j 관계의 과거 상태는 이 참조에 포함하지 않는다. 기존 회차는 기준 선택 없이 열 수 있다.

## 새 SQL 작성 전 확정할 항목

1. 전용 schema `worldstudio` 및 독립 Flyway 이력 사용.
2. Auth UUID subject를 보존하되 외부 테이블 FK 없이 저장. API의 소유권 검사 구현은 별도 작업.
3. 초기 비공개 버전과 향후 회차 공개 정책의 연결 경계. 이번에는 회차 공개 정책을 구현하지 않는다.

위 설계 기준으로 새 독립 V1을 작성하고, 빈 PostgreSQL에서 Content 없이 생성/저장/revision/rollback을 먼저 검증한다. 다음으로 기존 Auth/Content가 있는 별도 일회용 DB에서 기존 이력·건수·ID·원문·버전이 변하지 않는지 확인한다. 두 경우 모두 migrate/validate/재실행 0건과 새 연결 재조회를 검증한다.

공용 개발 DB 적용은 이 PR 범위에서 제외한다. 이전 배포 시도는 인증·접속 확인 실패로 중단했고 백업/migration을 수행하지 않았다. 실제 적용 상태는 미확인이며 [배포 사전 확인](../deployment/worldstudio-v1-rollout.md)에 기록했다. SQL과 독립 JPA 구현은 작업 브랜치에 커밋·일반 push하여 팀 리뷰용 일반 PR로 제출한다. #86·#76과 원본 UX worktree는 변경하지 않는다.

**PR 병합만으로 자동 마이그레이션이 실행되는지는 미확정이다.** 현재 WorldStudioConfig는 validate만 수행하고 migrate를 자동 호출하지 않는다. 실제 개발 DB 적용 여부, 배포 시 Flyway의 명시 실행 주체/시점/권한과 기능 활성화 순서는 팀원 검토가 필요하다.

템플릿 보완의 `semanticMetadata.studio`는 정본 카드 필드와 일치하며, `templateOrder`로 읽기 순서를 보존한다. 프런트는 빈 메타데이터의 기존 카드만 정본 필드로 해석하고 손상된 studio는 거절한다. 사건 area는 `history`다.

기존 역사 카드의 제품 리소스는 원문·SOUL을 포함하지 않고 세계관별 고정 요청 hash와 카드 ID·순서별 canonical payload SHA-256만 보관한다. 저장된 초안과 버전을 지문 및 고정 요청 이력과 대조한 경우에만 기존 세계관 확장을 시작하며, 과거 중단 요청은 계속 보류한다. 지문 대조는 인용이나 권리 승인을 뜻하지 않으며 #425의 권리·독립 감수 및 5,143건 보류 조건은 유지한다.
