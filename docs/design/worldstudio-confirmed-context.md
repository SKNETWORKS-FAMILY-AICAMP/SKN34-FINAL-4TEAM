# WorldStudio 확정 설정 Context — 9-A

## 범위와 기준

`WorldStudioService.confirmedContext(worldId, subject, revisionId)`는 Content 내부 읽기 전용 구성 함수다. #288 보완 HEAD `6abb5ab1f96ab7d3d41b86a408761af03f0d1010`을 기반으로 한다. 최신 develop `b0398b691dd95c79ae04705aea386cf7bd8e2245`와 대조했다. 선행 #219/#225/#235/#262/#266/#270/#284/#285/#286/#288은 Draft·미병합이다. 기존 `context/ContextService`·작품·회차 연결을 변경하지 않는다.

## 조회·출처·권한 계약

- 호출자는 기존 Core 인증 경계에서 검증된 Principal의 회원 UUID를 subject로 전달한다. 임의 요청 body의 소유자 ID나 AI가 주장한 ID를 쓰지 않는다. 함수는 기존 `revision`의 `owned` 검사 및 worldId/revisionId/sealed 조회를 재사용한다. 비소유·다른 세계관·없는 버전·미확정 버전은 기존 WorldNotFound다. 새 인증 방식이나 HTTP API는 없다.
- `worldId`, `revisionId`, `revisionNo`, 확정 당시 `name/description`을 반환한다. `authorizedSubject`는 이번 소유권 검사를 통과한 주체를 기록한 값이지 다른 API에 재사용할 인가 토큰이 아니다. 캐시를 새로 도입하지 않는다.
- `cards`는 기존 `SavedCardResponse`를 재사용한다. `versionId`가 **cardVersionId**, `versionNo`가 카드 버전 번호, `card.id`가 기존 인물·장소·조직 또는 의미 카드 ID다. 이 식별자들을 이름으로 대체하거나 재발급하지 않는다.
- 확정 버전에 저장된 활성 카드의 title/body/cardType/areaCode/classification/aliases/tags/visibility와 semanticMetadata를 그대로 보존한다. `lifecycle=removed`는 활성 Context에서 제외하고 `excludedRemovedCardCount`로 밝힌다. 원래 버전 상세에는 삭제 상태 카드도 유지된다.
- semanticMetadata의 `preprocessing`(semanticType, provenance, analysisId, candidateId, decisionSequence, basisDraftRevision, evidence, condition/timeText/polarity)과 `studio.item.subjectId/relatedIds`를 그대로 보존한다. rule/event/goal/plan 및 fact/conjecture를 다른 의미로 재분류하지 않는다. 저장된 근거의 sourceId/ownerId/field/UTF-16 좌표/quote/hash를 현재 초안 기준으로 다시 계산하지 않는다.
- `author_revision`의 빈 근거를 원래 AI 근거로 채우지 않는다. 후보·검토 테이블에서 원본 AI 후보나 pending/held/rejected 수정 이력을 가져오지 않는다. 승인만 된 후보도 포함하지 않으며 **초안 반영 후 명시적 확정된 카드**만 이 조회에 들어온다. 과거 확정 버전은 이후 검토 결정에 따라 다시 조립하지 않는다.
- 메타데이터는 해당 확정 카드의 저장값이지 현재 분석 실행·검토 상태를 재검증한 결과가 아니다. 인용문 일치는 의미적 사실성 보장이 아니며 conjecture/goal/plan은 완료 사건으로 취급할 수 없다.

## 완전성과 관계

| 필드 | 값 | 의미 |
|---|---|---|
| scope | owner_confirmed_settings | 소유자 전용 확정 설정 조각. 독자/인물에게 전달 가능한 전체 집필 문맥이 아님 |
| relationshipStatus | not_recorded | 이 확정 버전에는 과거 관계가 저장되지 않음 |
| currentRelationshipsIncluded | false | 현재 Neo4j 관계도 이 결과에 합성하지 않음 |
| completeWorldContext | false | 회차·지식·관계를 포함한 전체 Context 복원 완료가 아님 |

현재 관계는 기존 소유자용 `WorldStudioService.draft` 경로가 graphVersion과 저장 완료 상태를 확인해 조회한다. 9-A는 그 경로를 호출하지 않는다. 특정 확정 버전의 과거 관계는 지원하지 않으며, 현재 관계로 대체하지 않는다. 승인된 relation 후보가 Neo4j에 적용됐더라도 이 카드 Context에는 포함되지 않는다. 초안이나 현재 관계 저장이 이후 변경·미완료가 되어도 기존 확정 카드 버전은 유지된다.

## 팀원 연동 경계

| 이슈 | 9-A가 제공하는 것 | 팀원과 별도로 연결할 것 |
|---|---|---|
| #54 요청·권한 문맥 | 소유권 검사된 world/revision/cardVersion 출처와 scope | workId↔worldId 연결·허용 작업 범위·전체 Context Builder |
| #56 검색·근거 | 확정 원문과 저장된 근거 메타데이터 | 검색·문맥 한도·답변 근거 선택 |
| #123 관계 정합성 | 과거 관계 not_recorded, 현재 관계 미포함 표시 | graph revision 연결·이력·부분 실패 복구 |
| #124 회차/Fork 복원 | 불변 확정 카드 버전 | 회차 체크포인트·Fork·인물별 지식·적용 시점 |
| #163 MCP | 재사용 가능한 Content 내부 DTO/함수 | 도구·전송·인증 위임·공개 범위 |

과거 이슈 본문의 Core 콘텐츠 책임 표현보다 DEC-41의 Content 인가 경계가 우선한다. 위 이슈들을 이번 PR로 완료 처리하지 않는다. 새로운 공개 API, 저장소, 큐, 프레임워크, LLM 호출, graphStateRef/회차 매핑 정책은 추가하지 않는다. 소유자 전용 비공개 설정을 읽을 수 있다는 사실만으로 AI의 모든 작업이나 등장인물에게 전달할 권한이 생기지 않는다.

## 검증

단위: 지정된 확정 원문·카드 버전 ID·의미 참조/근거 유지, 같은 버전 재현, 초안·graph 상태 변경 격리, 소유권/미확정/없는 버전 거절, draft/Neo4j/저장 경로 미호출.

격리 CI: 기존 PostgreSQL/Neo4j 시나리오에 서버 재시작 후 확정 Context 조회를 추가한다. 기존 분석·검토·반영 시나리오에서 pending 수정본은 과거 Context에 유입되지 않음, 적용만으로 기존 확정 Context가 변하지 않음, 별도 확정 후 6종 의미 카드와 metadata 조회를 확인한다. 실제 개발 DB·유료 모델·새 HTTP/MCP 연동 검증은 범위 밖이다.
