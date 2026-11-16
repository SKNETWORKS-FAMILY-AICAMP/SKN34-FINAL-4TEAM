# 관계 시점·회차 및 Fork Context — 현행 구현과 남은 확장

2026-11-16 원격 develop `0e55c6d703c03069467281b19bded9b41eccc13a`의 코드를 대조했다.
**구현됨은 소스에서 확인한 범위**이며 실제 배포·공유 DB 이전·실모델 품질 검증 완료를 뜻하지 않는다.
이 문서는 스키마·API·DEC-51 정책을 변경하거나 마이그레이션 실행을 승인하지 않는다.
관련 작업: [#123](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/123), [#124](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/124), [#163](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/163).

## 1. 대체된 전제와 유지할 결정

- [DEC-51](worldstudio-independent-schema.md#회차별-관계--dec-51)이 #132의 '현재 관계만 저장·시점 조회 없음'을 대체했다. 발행 snapshot과 변경 replay 중 A/B를 고르는 제안은 철회한다. 회차마다 그래프 전체를 복제하지 않는다.
- [DEC-46·47](decisions.md): 세계관–소설 1:1 연결, 카드 공개·독자 공개 회차, 인물 문서가 구현됐다. 다른 공개 세계관의 카드 **가져오기**는 복사이며 추종이 아니다. DEC-46은 원작을 이어받는 **작품 Fork의 DEC-32·37 정책을 유지**한다.
- **DEC-43**: Fork 원고는 생성 당시 기준 회차까지의 발행 체크포인트에 고정된다. 원작의 재발행·되돌리기를 자동 추종하지 않는다. 세계관 추종과 하나의 포인터로 합치지 않는다.
- [DEC-49 / Content MCP](content-mcp-contract.md)는 이미 존재한다. MCP를 미래의 읽기 전용 전송 계층으로 설명하지 않는다. 기존 사용자 권한으로 Service를 호출하며 초기 세계관 AI 추출의 후보 생성·검토·반영 구분은 그대로다.

## 2. 현재 구현과 정확한 조회 범위

| 영역 | 코드에서 확인한 구현 | 완료로 간주하면 안 되는 범위 |
|---|---|---|
| DEC-51, [#339](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/339) (병합됨) | `Neo4jRelationshipRepository.read/replace`, `relationsAsOf`, `episodeEdges`가 회차별 관계를 저장·선택 | 같은 회차 정정 이력, 발행 당시 관계의 불변 snapshot, 세계관 전체 복원 |
| 관리 화면, [#348](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/348) (병합됨) | `RelationEpisodePicker`, `useWorldStudioViewModel`의 관계 기준 회차 선택과 조회·저장 연결 | 회차 선택으로 카드 원문까지 과거 상태로 바뀌는 기능 |
| DEC-46 | `WorkWorldService.link`와 `work.world_studio_id` UNIQUE로 소유 작품–세계관 1:1 연결. `PublicWorldService.detail/readerCards`가 확정 카드의 공개 범위를 선택 | 작품 Fork의 WorldStudio 자동 연결·복사, 공개 카드의 자동 추종 |
| DEC-47 | 카드 본문=IDENTITY, `semanticMetadata.characterDocs`의 SOUL·GOAL·회차 기억. 구형 `memory`는 읽을 때 00회차 앞에 합치고 다음 저장에서 제거 | 문서가 있다는 사실만으로 회차별 카드 상태·공통 지식 모델이 완성된 것은 아님 |
| 확정 설정 Context | `WorldStudioService.confirmedContext`가 소유자와 봉인 revision을 확인하고 활성 확정 카드·cardVersionId·메타데이터 반환 | 회차·인물 필터나 관계 snapshot은 없음. `WorldConfirmedContextResult`는 `completeWorldContext=false`, `relationshipStatus=not_recorded` |
| 기존 회차 Context | `ContextService.read`는 `WorldService` 설정 이력·발행 원고·회차/인물 필터를 사용 | WorldStudio 확정 카드와 DEC-51 관계를 결합한 공통 Context가 아님 |
| 인물 시뮬레이션 | AI `simulation/service.py`가 MCP `world_studio_list/read`로 연결 세계관·회차 관계를 읽고 인물 문서·회차 기억 및 시점 필터 사용 | 조회 카드는 현재 초안. 확정 revision 기반 전체 세계관 Context나 Fork 격리를 보장하지 않음 |
| DEC-43 / 기존 Fork | `ForkService.create`, `EpisodeVersionService.capture`가 원고 기준을 보존. `WorldService`의 following/detach, `ForkService.decideChange`에 기존 설정집 추종·독립·선택 반영 경로 존재 | 기존 Content 설정집 모델의 구현이다. WorldStudio UUID 카드·인물 문서·Neo4j 관계의 전체 복사 완료로 확대 해석하지 않음 |

### 관계 저장 계약 (재설계하지 않음)

```text
(:StudioCard)-[:RELATED {relationId, worldId, fromEpisode, ended, payload}]->(:StudioCard)
```

- N화 조회는 각 relationId에서 `fromEpisode <= N` 중 가장 최근 연결을 선택하고 `ended=true`면 제외한다. 변경 회차에만 연결을 추가하며 같은 관계·같은 회차는 덮어쓴다. N화 수정으로 이후 회차 연결을 삭제하지 않는다.
- 회차는 연결 소설의 `episode.sequence`이며 연결이 없으면 1화다. 회차 생략은 최신 관계 기준이다. 회차 삭제·재배치 시 번호를 자동 이동하지 않는다.
- 관계 정본은 Neo4j 하나다. `graphVersion/relationshipVersion`은 CAS·정합성 token이며 과거 조회 revision이 아니다. 관계 회차 조회와 확정 카드 revision 조회를 혼동하지 않는다.
- PG 준비 → Neo4j CAS → PG 완료 및 같은 요청 key/hash 복구를 유지한다. 두 DB의 원자적 롤백을 가정하지 않는다.
- 카드 삭제는 회차를 생략한 최신 편집에서만 허용한다. 새로 만들거나 바뀐 관계는 활성 카드를 참조해야 하며 과거 관계의 삭제된 카드 끝점은 보존될 수 있다. 상세 검증은 DEC-51 계약을 따른다.

### 실제 API·MCP 진입점

| 호출 | Service / 범위 |
|---|---|
| `GET /api/v1/world-studios/{id}?episode=N` / `world_studio_read(id, episode)` | `WorldStudioService.draft`: 소유자의 **현재 카드 초안 + N화 관계**. 완전한 과거 세계관 응답이 아님 |
| `PUT /api/v1/world-studios/{id}/draft` / `world_studio_edit_draft` | `WorldStudioService.edit`: 요청 `episode` 시점 관계 저장 |
| `GET /api/v1/world-studios/{id}/revisions` 및 `/{revisionId}` / `world_studio_revisions`, `world_studio_revision_read` | `revisionSummaries/revision`: 소유자 전용 확정 카드 목록·상세. 현재 관계를 확정 당시 관계로 섞지 않음 |
| `PUT /api/v1/works/{id}/world-studio` | `WorkWorldService.link`: 본인 작품과 본인 세계관 연결·해제 |
| `GET /api/v1/public/works/{id}/world-cards?upto=N` | `WorkWorldService.readerCards` → `PublicWorldService.readerCards`: 발행 회차 상한, 확정 카드의 `revealFromEpisode`, 같은 회차 관계. 카드 값 자체의 과거 복원은 아님 |
| `world_studio_public_list/read` | `PublicWorldService.list/detail`: 공개 세계관의 공개 확정 카드 및 양 끝 공개 카드 사이의 최신 관계 |

Content MCP의 소유자 조회는 검증된 호출자 토큰으로 기존 Service 인가를 거친다. 공개 세계관 조회, 독자 위키 공개 회차, 인물의 지식 범위는 서로 다른 필터다. 공개·독자 응답에는 IDENTITY만 제공하며 작가용 문서 전체를 노출하지 않는다.

## 3. 남은 요구사항 분류

| 요구사항 | 상태 | 확인된 기반 / 남은 범위 |
|---|---|---|
| 회차 기준의 전체 세계관 Context 구성 | **부분 구현** | 회차 관계·독자 위키·기존 Context·시뮬레이션은 존재. WorldStudio의 설정·상태·지식을 묶는 공통 결과와 완전성 판정은 남음 |
| 확정 카드 버전·회차 관계·인물 지식의 일관된 시점 결합 | **미구현** | 확정 카드 조회와 회차 관계 조회는 별개. 회차 선택 `EpisodeWorldBasisService`도 발행/Fork/AI 전체 Context를 고정하지 않음. 동일 회차 정정 후 재현 기준은 결정 필요 |
| Fork 독립 전 원작 세계관 추종 | **부분 구현** | 기존 `WorldService` 설정집 following은 존재. WorldStudio 카드·문서·관계까지 기준 회차의 허용 범위만 추종하는 연결은 남음 |
| 최초 Fork 세계관 수정 시 독립 복사 | **부분 구현** | 기존 설정집 `detach`는 존재. WorldStudio 전용 UUID 매핑·관계 복사·PG/Neo4j 완료 확인은 남음 |
| 독립 후 원작 변경의 선택적 반영 | **부분 구현** | 기존 `decideChange/applySourceChange` 및 결정 기록 존재. WorldStudio 변경 비교·충돌·선택 반영과 지식 범위 처리는 남음 |
| 권한·독자 공개·캐릭터 지식 범위 필터 | **부분 구현** | Service 소유권·공개/독자 필터·기존 Context/시뮬레이션 필터 존재. 공통 WorldStudio/Fork Context에서 같은 정책으로 합성·검증하는 계약은 남음 |
| 기존 데이터 이관과 미완료 상태 처리 | **부분 구현** | DEC-51 이전 스크립트·조회 불일치·저장 미완료 오류 및 같은 키 재시도 존재. 실제 공유 DB 적용 상태는 이번에 미검증. Fork 독립 복사 실패 복구는 미구현 |
| 생성 당시 재현과 최신 정정 추종의 기준·불완전 Context 허용 | **결정 필요** | DEC-37 추종 정책은 유지하되 카드 revision·관계 회차·지식 기준의 결합 및 누락 시 AI 실행 허용 여부를 팀이 결정해야 함 |

## 4. 유효한 Fork 정책과 후속 설계 쟁점

1. 원작 3화 Fork에는 원작 10화에서만 적용·공개되는 정보나 다른 Fork의 정보를 넣지 않는다. 10화 작업 중 한 수정이라도 3화 범위에 적용·공개되는 정정은 DEC-37의 독립 전 추종 대상이다.
2. 원고는 DEC-43대로 고정하고 세계관은 DEC-37대로 추종한다. DEC-51은 같은 회차를 덮어쓰므로 '3화 관계 조회'만으로 'Fork 생성 당시의 3화 관계'를 재현한다고 약속하지 않는다. 발행 `publication_event`나 nullable `CheckpointEntity.graphStateRef`가 WorldStudio 전체 상태를 고정한다고도 가정하지 않는다.
3. 최초 수정 시 당시 허용 범위를 독립 복사한다는 정책을 유지한다. 기존 1:1 연결과 충돌하지 않는 Fork 전용 world/card/relation 식별자 매핑, 양 DB 준비·완료·재시도 상태는 **후속 설계**다. 모두 완료되기 전 독립 완료로 표시하지 않는다.
4. 독립 후 원작 변경은 알림·사용자 선택으로만 반영하며 거절한 변경도 다시 선택할 수 있다는 DEC-34·37 정책을 유지한다. 실제 비교 단위와 충돌 UI는 이 문서에서 확정하지 않는다.
5. 이야기상 적용 회차, 독자 공개 회차, 승인·기록 시점, 인물이 아는 범위는 구분한다. 숨긴 endpoint뿐 아니라 설명·근거·개수에서도 권한 밖 정보를 누출하지 않는 검증이 필요하다.
6. `confirmedContext`의 `not_recorded`는 **그 확정 버전에 관계가 고정되지 않았다**는 뜻이다. DEC-51 회차 관계 자체가 미구현이라는 뜻으로 읽지 않는다. 누락된 기준을 현재 초안·최신 관계로 조용히 대체하지 않는다.

## 5. 이관·복구와 최소 후속 작업

- 기존 데이터 이전은 [DEC-51 스크립트](../../infrastructure/neo4j/dec51-relationship-edges.cypher)와 계약을 따른다. 기존 관계를 `fromEpisode=1`로 옮기는 것이며 기록되지 않은 과거를 복원하는 작업이 아니다. 끝점 누락·count 불일치는 조사 대상이며 자동 삭제·repair하지 않는다. 공유 DB 실행은 별도 승인 대상이다.
- 저장 중 미완료, migration 필요·불일치를 빈 관계 성공으로 바꾸지 않는다. 현재 HTTP/MCP의 409·503 및 같은 key/hash 복구 계약을 유지한다. 향후 Fork 복사도 결과 미확인 상태에서 새 ID로 자동 재실행하지 않는 방향으로 별도 계약화한다.
- 후속 순서: ① WorldStudio/Fork 모델 연결과 공통 Context 기준·권한·완전성 계약 → ② 기존 조회 함수의 Context 합성 및 시점 검증 → ③ Fork 추종·최초 독립 복사·부분 실패 복구 → ④ 독립 후 선택 반영. 각각 별도 PR이며 기존 관계 모델 재설계나 회차 원고 전처리 구현을 섞지 않는다.
- 수용 시나리오: 원작 3화 Fork/10화 정정 격리, 같은 회차 정정, 원고 고정과 세계관 추종 구분, 최초 독립 중 PG/Neo4j 실패·동일 요청 재개, 비공개/미래 기억/타 Fork 정보 차단, 이관 전 불일치, 확정 카드 불변성. **이번 문서 PR에서 이 후속 기능을 구현·실행한 결과가 아니다.**

## 6. 코드 근거와 검증 경계

- [관계 저장소](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/relationship/Neo4jRelationshipRepository.kt), [회차 선택 로직](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/relationship/RelationshipEpisodes.kt), [회차 선택 UI](../../frontend/src/presentation/features/worldstudio/view/RelationEpisodePicker.tsx)
- [WorldStudioService](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldStudioService.kt), [확정 Context DTO](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/dto/WorldConfirmedContextResult.kt), [회차 기준 세계관](../../backend/content-service/src/main/kotlin/ai/storyfork/content/episode/service/EpisodeWorldBasisService.kt)
- [작품–세계관 연결](../../backend/content-service/src/main/kotlin/ai/storyfork/content/work/service/WorkWorldService.kt), [공개 조회](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/PublicWorldService.kt), [공개·인물 문서 계약](public-world-contract.md), [인물 문서 변환](../../frontend/src/domain/entities/characterDocs.ts)
- [WorldStudio MCP](../../backend/content-service/src/main/kotlin/ai/storyfork/content/mcp/WorldStudioMcpTools.kt), [시뮬레이션 소비 경로](../../backend/ai-service/app/simulation/service.py), [시뮬레이션 계약](character-simulation-contract.md)
- [기존 Context](../../backend/content-service/src/main/kotlin/ai/storyfork/content/context/service/ContextService.kt), [기존 설정집](../../backend/content-service/src/main/kotlin/ai/storyfork/content/world/service/WorldService.kt), [ForkService](../../backend/content-service/src/main/kotlin/ai/storyfork/content/fork/service/ForkService.kt), [체크포인트](../../backend/content-service/src/main/kotlin/ai/storyfork/content/episode_version/service/EpisodeVersionService.kt)

소스·결정 문서·API 이름·상대 링크와 Markdown을 대조한다. 문서 전용 변경이므로 런타임 테스트·DB 이전·배포·유료 모델 호출은 실행하지 않는다. 실제 배포 상태와 새로운 Context/Fork 기능의 통합 검증은 후속 작업이다.
