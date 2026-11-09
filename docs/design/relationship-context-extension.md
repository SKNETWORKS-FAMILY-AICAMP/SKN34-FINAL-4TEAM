# 관계 시점·회차 Context 최소 확장안 — #123 / #124

2026-11-09 develop `51b7024a` 소스 및 열린 #123/#124/#132/#163 기준. **설계 제안이며 구현·migration 승인 문서가 아니다.**
#132의 현재 상태 CRUD는 그대로 유지한다. 초기 세계관 추출 #219/#225 및 #223 UI와 별도 PR이다.
새 DB·큐·워커·프레임워크 없이 기존 Content/PostgreSQL/Neo4j를 사용한다.

## 현행과 변경점

| 근거 | 현재 확인 | 확장안/영향 |
|---|---|---|
| Neo4jRelationshipRepository.read/replace | world UUID 단위 현재 payload 교체, CAS version 증가. 제거 payload=null, 이력 없음 | 현재 CRUD 유지 + 변경 시 immutable graph revision/change 추가. 현재 version을 과거 조회 키로 소급 해석 금지 |
| WorldStudioService.edit | PG 준비 → Neo4j replace → PG finalize, incomplete 재시도 | revision별 request key/hash와 완료 상태 연결, 분산 rollback 가정 금지 |
| WorldStudioService.revision/restore | 관계 not_recorded, 과거 복원 미지원 | 도입 이후 완전한 관계 이력만 정확 조회. 이전 버전 미지원 유지 |
| CheckpointEntity.graphStateRef | nullable, capture는 content_only이며 graph 참조 미설정 | 기존 Context snapshot의 불변 graph 참조로 재사용 가능. 빈 값을 현재 그래프로 채우지 않음 |
| DEC-43 / publication_event | 발행 publish/applied가 회차 체크포인트, 저장 버전 생성과 구분 | 발행 이벤트와 Context snapshot 연결 필요. 옛 checkpoint 테이블을 발행 정본으로 재정의하지 않음 |
| WorldService/ForkService | content world(String)·설정 이력·following/independent 구현 | 독립 WorldStudio UUID와 자동 연결돼 있지 않다. 명시적 work→studio world binding 및 ID mapping 필요 |

**가장 큰 위험:** content.world / worldstudio.world는 다른 모델·EM/transaction manager다. 같은 DataSource라는 이유로
ID나 트랜잭션이 같다고 취급할 수 없다. 기존 Fork 텍스트 복사를 Studio graph 복사 완료로 보고하면 안 된다.

## DEC-32~43 및 이슈 정합성

- DEC-32/37: 기준 회차에 적용·공개된 세계관만 추종. 최초 수정 전 원본 소급 정정도 허용 범위 안에서 추종한다.
- DEC-33/42: 설정·상태·지식 이력 유지, 삭제/정정은 새 기록. #132의 현재 관계 교체·제거 예외를 관계 이력 도입 범위에서만 재논의한다.
- DEC-34: 독립 후에는 알림·명시적 선택 반영. 부모나 형제 상태를 자동 합치지 않는다.
- DEC-35/38: 작품 Fork 허용과 공개 정책 검사. 타인 세계관 직접 재사용으로 확장하지 않는다.
- DEC-36: 적용 시점·공개 범위·인물 지식은 별개. 기본 비공개, Content가 인가한다.
- DEC-39: 원문/분류/태그·첨부 계약 유지. 이미지 과거 복원 보장을 추가하지 않는다.
- DEC-40: 초안, 승인, 확정, 발행을 구분. 후보 approve만으로 graph checkpoint 생성 금지.
- DEC-41: Content가 소유권·조회 범위·반영 결정, AI는 허용 문맥만 사용.
- DEC-43: Fork의 **원고**는 생성 시 1~기준 회차 활성 발행 이벤트에 고정. 원작 재발행/되돌리기를 추종하지 않는다.
  **세계관**은 DEC-37에 따라 following이 가능하다. 이 두 포인터를 하나로 축약하지 않는다.
- #123은 graph revision/저장소 정합성 계약, #124는 회차 Context·전체 독립 전환의 소비자다.
- #132의 구현 완료 범위에 이력·과거 복원을 소급 포함하지 않는다. 새 계약 검토 후 별도 확장 PR로 진행한다.
- #163은 읽기 전용 MCP 전송 후보다. Context DTO와 인가는 전송 방식과 분리한다. MCP SDK/외부 공개를 이번에 선택하지 않는다.
- #163의 “원작 후속 변경 제외”는 미래 사건/권한 밖 정보 차단으로 해석한다. 기준 회차에 적용되는 소급 정정을 무조건
  차단하면 DEC-37과 충돌하므로 following 조회 모드와 고정 재현 모드를 명시적으로 분리해야 한다.

## 최소 Neo4j 모델 제안

관계 정본은 계속 Neo4j다. 현재 materialization과 과거 revision 모두 같은 저장소의 사실을 사용한다.

- GraphRevision: graphScopeId, revisionId, parentRevisionId, requestKey/hash, recordedAt, actor/승인 참조.
- RelationshipChange: revisionId, stable relationId, upsert/remove, endpoints, payload, 적용 구간, 공개/지식 참조.
- 관계의 실제 정규화 payload가 바뀔 때만 revision/change를 추가한다. 카드만 저장하거나 동일 요청 재시도면 graph revision 재사용.
  현재 graphVersion은 edit마다 증가할 수 있으므로 **현재 CAS counter와 새 역사 revision ID를 분리**한다.
- revision은 작업 단위 묶음, change는 바뀐 관계만 저장한다. 삭제는 tombstone, 정정/되돌리기는 새 revision.
- 도입 시 현재 관계를 기준 baseline으로 한 번 기록한다. 회차마다 전체 그래프를 복제하지 않는다.
  최소 조회는 baseline+지정 revision까지 change replay. 대규모 성능 보강/주기 snapshot/별도 index 서버는 제외한다.
- payload에는 기존 방향/대칭·구조/감정·복수 관계·설명·ID·근거를 보존한다. graphScopeId가 다른 relation은 같은 ID로 덮어쓸 수 없다.

**시간축:** 이야기상 effectiveFrom/To(회차 또는 검증된 관측 위치), 공개 시작/끝, 실제 approvedAt/recordedAt,
그리고 인물 acquiredAt/knownBy를 분리한다. AI의 timeText를 임의 회차로 바꾸지 않는다.
경계 미정 자료는 unknown으로 두고 정확 시점 Context의 complete에서 제외한다.
늦게 기록된 사건도 effectiveFrom이 10화면 3화 Context에 들어갈 수 없다.
소급 정정은 새 revision과 과거 effective 범위를 함께 기록한다. 원본 checkpoint를 수정하지 않는다.

## 식별·체크포인트 연결

```json
{
  "workId": "콘텐츠 작품 ID",
  "studioWorldId": "명시적으로 연결된 WorldStudio UUID",
  "forkWorkId": null,
  "basisPublicationEventId": "publish-applied ID",
  "basisEpisode": 3,
  "worldRevisionId": "승인된 설정 버전 ID",
  "graphScopeId": "원작 또는 독립 Fork 범위",
  "graphRevisionId": "불변 revision ID",
  "contextSnapshotId": "설정·상태·지식·사건 manifest ID",
  "coverage": {"relationships": "complete", "knowledge": "partial"}
}
```

위는 제안 DTO이며 현재 API가 아니다. 단순 episodeNumber만으로 조회하지 않는다.
`CheckpointEntity.graphStateRef`에는 versioned opaque ref(예: neo4j:v1:<scope>:<revision>)를 기록할 수 있다.
파싱 후 work/world/scope/revision의 소속을 서버에서 대조해야 한다. 임의 클라이언트 문자열을 Neo4j query에 넣지 않는다.
DEC-43의 publication_event와 이 content snapshot의 연결은 별도 binding/manifest가 필요하다.
기존 checkpoint는 불변 snapshot으로 재사용하고 소급 정정 시 새 snapshot을 만든다. 기존 기록/행/빈 graphStateRef는 유지한다.
발행 이벤트를 대체하는 새 “발행 checkpoint” 테이블은 만들지 않는다.

## 원작 3화 Fork 대 원작 10화

1. Fork 생성 때 원고 1~3화의 publication event 목록은 고정한다. 4~10화 원고 및 다른 Fork 데이터는 제외한다.
2. 세계관 following은 원작 허용 revision에서 **3화 적용·공개 범위**만 계산하고 그 결과 graph revision 참조를 별도로 보관한다.
3. 10화에 기록한 관계라도 적용/공개가 10화라면 제외. 3화의 오류를 소급 정정했고 3화에 공개되는 관계라면 following에 반영 가능.
4. 과거 생성 순간 재현(exact_checkpoint)은 최초 참조를 사용한다. following은 최신 허용 정정 참조를 사용한다. 응답에 모드를 명시한다.
5. 최초 설정 수정 시 허용된 설정·상태·지식·사건·관계의 일관된 원본 기준을 먼저 고정한다.
   fork 전용 graphScope와 Studio world/엔터티/관계 ID 매핑을 한 번 예약한다. 기존 부모 revision을 덮어쓰지 않는다.
6. 독립 초기 baseline은 **Fork 생성/독립 때 한 번의 허용 상태 복사**다. 매 회차 복제가 아니다. 부모 미래 change를 상속하지 않는다.
7. PG·Neo4j 둘 다 준비/완료되기 전에는 independent로 표시하거나 첫 수정을 완료시키지 않는다.
   재시도는 같은 scope/ID/payload 사용. 기존 원고 기준 publication 이벤트는 바꾸지 않는다.
8. 독립 후 소급 정정도 알림·선택 반영만 한다. 반영/거절 기록을 남겨 나중에 재선택 가능하게 한다.

## 부분 실패 및 읽기 안전성

| 단계/장애 | 보존·복구 |
|---|---|
| PG 준비 전 | 정본 변경 없음. 권한/기준/요청 hash 검사 후 ID 예약 |
| PG 준비 후 Neo4j 전 | pending operation과 고정 scope/revision/change payload 보존, 같은 key만 재개 |
| Neo4j tx 성공 | change+revision+현재 projection을 한 Neo4j tx로 저장, request receipt로 중복 방지 |
| 응답 유실/timeout | unknown. PG에서 rollback됐다고 선언하거나 새로운 ID 발급 금지 |
| Neo4j 성공 후 PG finalize 실패 | 기존 receipt/hash 조회 후 finalize 재개. PG 연결 포인터/완료 상태가 확정되기 전 complete Context 노출 금지 |
| PG 성공 후 HTTP 응답 유실 | 동일 key receipt를 먼저 반환, 현재 최신 revision으로 과거 성공을 stale 처리하지 않음 |
| Fork 독립 도중 실패 | 부모는 그대로, 자식 준비 상태는 외부 비노출. 같은 ID로 재개, 자동 삭제/repair 금지 |

Content의 서로 다른 EM/transaction manager도 하나의 tx로 가정하지 않는다. work binding/Fork 포인터가 Content tx에 있고
Studio receipt가 Studio tx에 있는 경우 단계별 완료 장벽을 두고 읽기 시 양쪽 상태를 검증해야 한다.
최소 범위에서는 동일 scope의 미완료 작업이 다른 쓰기를 막는다. 큐 대신 명시적 동일 요청/조회 시 복구를 사용한다.
이미 연결된 불변 이전 revision은 정확 조회 가능하지만, pending인 최신 관계를 과거/완료로 가장하지 않는다.

## 이전 데이터·마이그레이션 위험

- 현재 그래프 도입 시점 baseline 이전 관계는 history_unavailable/not_recorded. 원고·AI·기존 PG 관계 사본에서 추측 backfill 금지.
- 이미 참조되는 과거 checkpoint에 현재 baseline을 끼워 넣지 않는다. coverage와 baseline 시작을 공개한다.
- 미래 migration은 additive여야 한다. 현재 Neo4j 라벨/관계 전체 교체, 기존 V1/V2 SQL 수정, 자동 Flyway repair 금지.
- 고정 ID의 world 범위, graph revision parent chain, request 중복 제약을 검증한 뒤 staged 전환한다.
- 대상 데이터/도입 baseline 시점·쓰기 중지 범위는 별도 승인·계획이 필요하다. 이 문서로 배포/데이터 이관을 수행하지 않는다.

## 읽기 전용 Context 인터페이스 제안

요청은 workId, basisPublicationEventId, perspective(author/reviewer/character/reader), characterId?,
mode(current_authoring/exact_checkpoint/following_world), 요구 coverage를 포함한다.
Content가 인증/작품 소유·발행·Fork 정책을 검증하고 world/scope/manifest를 직접 해석한다.
AI가 임의 graphRevisionId나 다른 worldId를 지정해 권한을 넓힐 수 없게 한다.

응답은 원고 판본, 승인 설정/상태/지식/사건, graph ref, sources/evidence, coverage/missingReasons를 포함한다.
인물 perspective는 그 인물이 아는 자료만 제공한다. 독자 공개라고 인물이 아는 것은 아니다.
숨겨진 endpoint·관계 설명·태그·검색 결과 개수·근거 원문도 함께 필터링한다. 누락을 빈 관계 성공으로 숨기지 않는다.
권한 밖은 기존 거부 정책, 복원 불가능은 명시적 unsupported/partial. exact 요청을 current로 fallback하지 않는다.
후보·미승인 초안은 승인 Context에서 제외한다. authoring 초안 문맥은 명시적 별도 모드로만 허용한다.
MCP(#163)는 이 인터페이스의 전송 adapter 후보일 뿐이며 별도 승인 전 도입하지 않는다.

## 검증 시나리오·권장 PR

1. **계약 PR(#123/#124, 현재 문서):** ID binding, 3개 시간축, DEC-43 vs 37, coverage·오류·독립 경계 검토.
2. **Neo4j additive revision PR(#123):** 무변경 재저장 시 revision 미증가, change replay, 삭제/정정, 같은 key 재시도,
   concurrent CAS, 현재 CRUD 결과 보존, baseline 전 unsupported, PG finalize 실패 후 복구를 CI 검증.
3. **회차 manifest/Context PR(#124):** publication event 연결, 미검수 구간 partial, 원작10화→3화 누출 차단,
   소급 정정 exact/following 분리, 원고 발행본 고정, 인물별 지식/비공개/근거 필터 검증.
4. **Fork 독립 PR(#124):** 첫 수정 중단/재시도·같은 ID, 부모/형제 불변, 원본 추종→독립 전환,
   독립 후 선택 적용/거절/재선택, 소프트 삭제된 원작 접근 정책 회귀.
5. **읽기 전용 전송 PR(#163):** 위 Context를 재사용. MCP 선택 시 SDK·인증·전송·내부 노출 범위를 먼저 확정.

아직 결정할 항목: 적용 시점의 최소 단위(회차/장면), 불완전 Context에서 허용할 AI 작업,
발행 이벤트와 snapshot binding의 정확한 스키마, legacy world→Studio 연결/독립 ID 매핑,
baseline 이관 승인 시점. 권장안은 우선 회차 단위·exact Context는 완전성 부족 시 거부·독립 binding·명시적 baseline이다.
이 미정 항목을 임의로 runtime 정책으로 확정하지 않는다. 초기 세계관 추출은 이 결정과 독립 진행 가능하다.
