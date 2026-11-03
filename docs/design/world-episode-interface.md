# 초기 세계관 → 회차 백엔드 연동 계약 v0.1

상태: **팀 검토용 제안 계약. DTO·내부 인터페이스·저장 연동은 미구현이며 이 문서는 구현 승인이 아니다.**

기준: [초기 세계관 설계](world-studio-initial-model.md), [확정 결정 기록](decisions.md)의 DEC-26·27·33·36·37·39·40. 카드 저장 구조는 기존 설계를 재사용하며 여기서는 회차 소비자의 조회·참조·권한 계약만 구체화한다. 기존 develop의 구현 제약으로 8종 카드나 불변 버전 목표를 축소하지 않는다.

## 1. 책임과 정책 경계

| 책임자 | 소유 범위 |
|---|---|
| 초기 세계관·Core 담당 | World, SettingCard, Relationship, 설정·관계 Draft, 불변 버전, WorldRevision 및 정본 조회·권한 판단 |
| 회차 담당 | Work, Episode, EpisodeVersion, 회차별 상태·사건·관계·지식 변화, EpisodeCheckpoint 및 기준 시점별 조합 |
| 이미지 담당 | 이미지 생성·편집·업로드·삭제·저장·조회, 스토리지, 이미지 API·검증·접근 제어 |
| 공동 협의 | 논리 ID 연결, 쓰기 책임, 권한·공개 범위, 이미지 참조 안전성, Fork 상속·독립 경계, 공통 migration |

WorldRevision은 **초기 세계관의 확정 묶음**이며 EpisodeCheckpoint는 **특정 회차의 원고·설정·상태·관계·지식을 묶는 기준**이다. 동일 객체나 같은 버전 번호가 아니다. 세계관은 작품·회차 없이 생성할 수 있다는 작업실 방향을 유지한다. 회차 자동저장 정책은 별도 합의하며 설정 자동저장 정책인 DEC-40을 그대로 확대하지 않는다.

DEC-26에 맞춰 Graph DB의 관계 저장·조회 역할을 유지한다. PostgreSQL 관계 정본 + Graph DB 조회 projection은 기존 문서의 권장안이며 팀 확정안은 아니다. 아래 읽기 계약은 특정 Graph 제품이나 외부 REST API를 요구하지 않는다.

## 2. 내부 조회 인터페이스 — 제안 계약

논의용 호출: `WorldBaselineReader.getConfirmedRevision(worldId, worldRevisionId, actorContext)`.

동일 Core Service 내부의 서비스 계약이다. 구현 시 명시적 Request/Result DTO를 기능별 `service/dto`에 두되, 단순 전달 계층이나 외부 HTTP endpoint를 선제 추가하지 않는다. 아래 JSON은 내부 입출력을 설명하기 위한 표기이며 실제 API 요청·응답이 아니다.

### 입력과 읽기 보장

| 필드 | 필수 여부 / 의미 |
|---|---|
| worldId | 필수, 안정적인 세계관 논리 ID |
| worldRevisionId | 필수, 해당 world에 속하는 확정 revision ID. null·latest 별칭 허용 안 함 |
| actorContext | 필수, 서버가 검증된 Principal에서 만든 문맥. 클라이언트 body를 그대로 신뢰하지 않음 |
| actorContext.memberId | 필수, 기존 content 소유자 식별자에 매핑된 주체. Principal 식별자와 문자열이 같다고 가정하지 않음 |
| actorContext.purpose | 필수, 이 계약에서는 `AUTHOR_BASELINE`만 허용. 다른 목적은 공개용 처리 경로 사용 |

조회자는 world 전체 설정을 읽을 권한이 있는 작가 또는 명시적으로 허용된 주체여야 한다. 위 필드는 권한 부여 증명이 아니며 Core가 현재 권한을 확인한다. 세부 역할·Principal 매핑은 팀 합의 대상이다.

반환은 요청한 revision manifest의 카드·관계 버전으로만 구성한다. 초안·미승인 후보·최신 revision을 섞지 않는다. 같은 ID 조회의 텍스트 내용과 버전 연결은 불변이며 현재 접근 권한은 매번 재검증한다. 권장 PostgreSQL 정본안에서는 Graph 지연과 무관하게 정본에서 정확한 묶음을 읽는다. 정본 일부가 유실되면 부분 성공이나 다른 버전으로 대체하지 않는다.

### WorldBaselineSnapshot (Result DTO의 논리 이름)

| 필드 | 필수 여부 / 의미 |
|---|---|
| worldId, worldRevisionId | 필수, 입력과 정확히 일치 |
| revisionNo | 필수, 표시용 순번. ID나 회차 번호 대신 조인하지 않음 |
| nameSnapshot, descriptionSnapshot | 필수 문자열, descriptionSnapshot은 빈 문자열 허용. 원 설계의 revision snapshot 필드 |
| cards | 필수 배열, 빈 배열 허용. manifest에 선택된 카드 버전과 tombstone 포함 |
| relations | 필수 배열, 빈 배열 허용. 관계 입력은 선택적이며 미등록은 관계 없음의 확정 주장 아님 |

| 카드 필드 | 필수 여부 / 의미 |
|---|---|
| cardId, cardVersionId | 필수. 원 설계 SettingCard.id와 SettingVersion.id의 조회 DTO 이름. 새 ID 발급 아님 |
| cardType | 필수: `character`, `location`, `organization`, `ability`, `object`, `rule`, `event`, `other` |
| areaCode | 필수: `basic`, `space`, `history`, `society`, `culture`, `special`, `conflict`. 카드 유형과 별개 |
| title, text | 필수 문자열. 원문·줄바꿈 보존, 의미 재작성 안 함 |
| aliases, tags | 필수 문자열 배열. 없는 값은 빈 배열, 누락·자동 변환 금지 |
| lifecycle | 필수: `active` 또는 `removed`. 삭제는 이력 제거가 아닌 tombstone |
| userCategory | 선택 문자열. 자유 분류이며 cardType 복원 코드로 사용하지 않음 |
| semanticMetadata | 필수 명시적 DTO, 의미 필드가 없으면 빈 객체. 아래 보존 규칙 적용 |
| visibilityPolicy | 필수, 아래 공개 정책 DTO. 원 설계의 공개 정책을 전달하며 공개 승인 자체가 아님 |
| evidence | 필수 근거 DTO 배열, 직접 작성에 근거가 없으면 빈 배열 |

`semanticMetadata`의 선택 필드는 기존 의미에 맞게 `legacyKind`, `polarity`, `predicate`, `subjectId`, `targetId`, `condition`, `relatedIds`, `timeText`, `afterId`, `topics`, `origin`을 보존한다. 문자열·ID·배열의 원래 의미를 유지하며 실제 v1 타입과 추가 필드 목록은 변환 계약에서 확정한다. `fact`, `claim`, `constraint`, `undetermined`, `relation`을 `other`로 일괄 치환하지 않는다. 미분류 legacy를 8종으로 무손실 대응하지 못하면 확정 전 검토 대상으로 남기며 Reader에서 추측 변환하지 않는다. 기존 논리 ID와 버전 ID 대응표는 보존한다.

| 관계 필드 | 필수 여부 / 의미 |
|---|---|
| relationId, relationVersionId | 필수, Relationship.id와 RelationshipVersion.id에 대응 |
| sourceCardId, targetCardId | 필수, 같은 world의 manifest 카드 논리 ID. 이름으로 연결하지 않음 |
| category | 필수: `structural`(실제 관계), `emotional`(감정). 카드 areaCode와 별개 |
| description | 필수 문자열. 복합 관계·감정의 자유 서술, 정해진 감정 enum으로 축소하지 않음 |
| direction | 필수. 제안 코드 `directed`(source→target), `symmetric`(대칭). 최종 코드 합의 필요 |
| polarity | 필수. 주장·부정 등 기존 의미 보존. 예시 `asserted`는 기존 코드이며 전체 허용 목록은 공동 검증 대상 |
| lifecycle | 필수: active/removed. active 관계의 양 endpoint는 같은 manifest의 active 카드여야 함 |
| label | 선택 문자열, 원 설계와 동일 |
| condition | 선택 문자열, 조건부 관계의 조건. 초기 모델의 semantic metadata에 있는 condition을 조회 계약에서 명시적으로 전달하는 확장 제안이며 저장 위치는 미정 |
| visibilityPolicy, evidence | 필수, 카드와 같은 정책. 관계 자체와 양 endpoint 모두 공개 판정 대상 |

removed 관계의 endpoint는 manifest의 removed 카드도 참조할 수 있다. tombstone을 현재 상태로 사용하지 않으며 공개 결과에 삭제 사실·ID를 자동 노출하지 않는다. 미완성 nullable endpoint를 허용하는 RelationshipDraft는 이 조회에 포함되지 않는다.

### 공개 정책과 근거 DTO — 제안 필드

`visibilityPolicy`는 `defaultVisibility`(필수, 초기값 `private`)와 `episodeRanges`(필수 배열)로 구성한다. 범위 원소는 `workId`, `fromEpisodeNumber`(1 이상), `visibility`(public/private)가 필수이고 `toEpisodeNumber`는 선택이며 없으면 상한 없음이다. 범위가 없으면 기본값을 적용한다. 이는 확정 당시 정책 snapshot이며 현재 공개 권한을 대신하지 않는다. 겹치는 범위의 우선순위를 임의 추정하지 않도록 확정 단계에서 거절하는 안을 권장한다. 기존 visibility_history 연결·정책 변경 이력·실제 적용 시점과 공개 시점의 분리는 팀 결정 대기다. standalone World에는 회차 범위가 없어도 되며 초기 기본 비공개를 유지한다.

근거 원소는 `id`, `inputSnapshotId`, `quote`가 필수이고 `locator`, `offsets`는 선택이다. 원 설계 Evidence의 불변 원문 snapshot 참조를 재사용한다. 승인 후보라면 적용된 승인 결과에서 근거를 연결하며 미승인 후보를 섞지 않는다. 작가용 전체 설정 권한이 있어도 근거 원문에 별도 권한 제한이 있으면 제한된 원문은 반환하지 않으며, 해당 근거의 누락 정책·참조 전용 DTO는 공동 합의 전까지 이 Reader의 지원 대상으로 확대하지 않는다. 임의 빈 배열로 성공을 위장하지 않고 `EVIDENCE_ACCESS_DENIED`로 거절한다. 공개 결과에서는 근거 quote와 내부 식별자를 기본 제외한다.

### 입력·반환 예시 (제안 계약, 실행 결과 아님)

가독성을 위한 `world-hgd`, `wr-1` 등은 설명용 ID다. 실제 ID 형식은 기존 ID와 호환되도록 정하며 샘플 문자열로 DB 형식을 확정하지 않는다.

```json
{
  "worldId": "world-hgd",
  "worldRevisionId": "wr-1",
  "actorContext": {"memberId": "author-1", "purpose": "AUTHOR_BASELINE"}
}
```

```json
{
  "worldId": "world-hgd",
  "worldRevisionId": "wr-1",
  "revisionNo": 1,
  "nameSnapshot": "홍길동전",
  "descriptionSnapshot": "초기 세계관",
  "cards": [
    {"cardId": "gil-dong", "cardVersionId": "gil-dong-v1", "cardType": "character", "areaCode": "society", "title": "홍길동", "text": "홍 판서의 아들이다.", "aliases": ["길동"], "tags": ["주인공"], "lifecycle": "active", "semanticMetadata": {"legacyKind": "entity", "origin": "author_addition"}, "visibilityPolicy": {"defaultVisibility": "private", "episodeRanges": []}, "evidence": []},
    {"cardId": "pan-seo", "cardVersionId": "pan-seo-v1", "cardType": "character", "areaCode": "society", "title": "홍 판서", "text": "홍길동의 아버지다.", "aliases": [], "tags": [], "lifecycle": "active", "semanticMetadata": {"legacyKind": "entity"}, "visibilityPolicy": {"defaultVisibility": "private", "episodeRanges": []}, "evidence": []}
  ],
  "relations": [
    {"relationId": "father-son", "relationVersionId": "father-son-v1", "sourceCardId": "pan-seo", "targetCardId": "gil-dong", "category": "structural", "description": "친아들이지만 공적으로 인정하지 못한다.", "direction": "directed", "polarity": "asserted", "lifecycle": "active", "visibilityPolicy": {"defaultVisibility": "private", "episodeRanges": []}, "evidence": []}
  ]
}
```

샘플에는 두 인물만 들어 있으며 아래 시나리오의 전체 세계관과는 별개의 최소 입력 예다. 현재 실험 Core가 사물·기타·별칭까지 저장한다는 의미가 아니다.

### 오류 계약 (내부 오류 코드 제안)

| 코드 | 조건 / 처리 |
|---|---|
| INVALID_ARGUMENT | 필수 ID 누락·지원하지 않는 purpose. latest로 보정하지 않음 |
| UNAUTHENTICATED | 검증된 actorContext 없음 |
| BASELINE_NOT_ACCESSIBLE | world/revision 없음, 다른 world 소속 revision, 또는 세계관 읽기 권한 없음. 외부에는 존재 여부를 구별할 상세를 공개하지 않음 |
| REVISION_NOT_CONFIRMED | 접근 가능한 대상이 확정본이 아님. 초안이나 과거 확정본으로 대체 안 함 |
| EVIDENCE_ACCESS_DENIED | 위 근거 접근 경계를 충족하지 못함. 내용·quote를 오류에 싣지 않음 |
| BASELINE_INTEGRITY_ERROR | manifest 버전 누락, 중복 ID, 잘못된 endpoint 등. 부분 snapshot 반환 안 함 |
| BASELINE_UNAVAILABLE | 정본 읽기 실패. 재시도 가능 여부 전달, 성공·빈 결과로 위장 안 함 |

오류 Result는 `code`, `retryable`을 필수로 제안한다. 내부 감사 로그는 비밀 원문 없이 실제 원인을 구분하고, 호출자는 외부 응답에 맞게 안전하게 변환한다. HTTP 상태 코드는 이 내부 계약에서 선제 확정하지 않는다.

## 3. 회차 연결과 변경 추적

1. 작가가 standalone World에서 카드와 선택적 관계를 작성한다. 승인된 LLM 후보도 동일 초안에 반영한다.
2. 명시 저장으로 확정 WorldRevision을 만든다. 자동저장 초안은 회차 기준으로 선택할 수 없다(DEC-40).
3. 작품에 사용할 `worldId`를 연결한다. world를 소유하지 않은 사용자의 임의 연결은 권한 검증에서 거절한다. 작품 연결이 설정 공개를 뜻하지 않는다.
4. 회차 초안을 만들 때 선택한 `worldId`, `worldRevisionId`를 고정한다. 2화도 사용한 기준을 명시하며 이전 화와 같은 revision을 사용할 수 있다.
5. 집필 중 생사·소속·사건·감정·지식 변화는 회차 담당의 변경 이력으로 기록한다. cardId/relationId를 참조하며 초기 카드/관계 버전을 덮어쓰지 않는다. 회차에서 새로 생기는 대상의 ID 할당·논리 world 소속은 별도 공동 계약이다.
6. 원고 버전 저장 시 실제 사용한 기준과 변경 이력 버전을 함께 고정한다. 기준 교체가 필요하면 작성자가 명시 선택하고 차이·삭제된 endpoint·참조 충돌을 검사한다. 동시 수정 검사 후 새 기록을 남기며 과거 원고 버전을 갱신하지 않는다.
7. EpisodeCheckpoint는 선택한 회차 버전과 그 시점의 설정·상태·관계·지식을 별도로 묶는다. 생성 트리거·완전성 기준은 합의가 필요하며 WorldRevision으로 대체하지 않는다.

| 소비 대상 | 보존할 논리 식별자 (제안) | 변경 시 처리 |
|---|---|---|
| Work | workId, 연결 worldId | world 교체는 명시 작업. 기존 회차 버전 참조를 연쇄 덮어쓰지 않음 |
| 회차 초안 | episodeId, worldId, worldRevisionId, 초안 동시성 revision | 선택한 확정본을 사용. 최신 world 자동 교체 금지; 명시 변경 시 변경 전후 기준 추적 |
| EpisodeVersion | episodeVersionId, worldId, worldRevisionId, 사용한 회차 변경 이력의 불변 식별자 집합 | 원고 저장 시 한 묶음으로 고정. 정확한 필드명·FK/manifest 위치는 미정 |
| EpisodeCheckpoint | checkpointId, episodeId, episodeVersionId, worldId, worldRevisionId, 시점별 변경 이력 참조 | 기본 설정과 회차 변화가 일치하는지 검증. 정정은 새 버전·새 체크포인트, 기존 기록 보존 |
| Fork 최초 기준 | 원작 workId, 기준 episodeId/episodeVersionId, checkpointId 및 당시 worldRevisionId | 최초 기록은 보존. 이후 추종 참조와 분리(4절) |

기준 revision이 달라졌을 때 회차 변화의 적용 순서·동일 속성 충돌·참조 제거를 해결하기 전에는 변경 적용 완료로 표시하지 않는다. 저장·체크포인트 간 원자성 경계와 기존 콘텐츠 버전 revision 숫자의 의미는 회차 담당과 합의한다.

## 4. 읽기 범위·권한·Fork

작가용 WorldBaselineSnapshot은 비공개 설정을 포함할 수 있으므로 **독자·Fork·AI에 그대로 전달하는 DTO가 아니다.** 회차 담당의 별도 공개 조회는 요청 work·episode·episodeVersion/Checkpoint와 현재 actor 권한을 확인하고, 해당 시점에 적용·공개된 설정·상태·관계·지식만 구성해야 한다. 현재 최신 세계관을 읽고 화면에서만 숨기는 방식은 허용하지 않는다.

- 작가 전체 조회와 독자 공개 조회의 반환 DTO·권한 경계를 분리한다. 공개 소비자는 AUTHOR_BASELINE 목적을 직접 지정할 수 없다.
- 공개 항목이라도 미래 회차 변화는 제외한다. 독자가 아는 사실과 특정 인물이 아는 사실은 다르므로 인물 시점/AI 문맥에는 인물별 지식 제한을 추가 적용한다.
- 관계는 자체 공개 정책과 양 endpoint의 공개 여부를 모두 검증한다. semanticMetadata의 연결 ID·조건·본문·태그·별칭·근거도 유출 경로다. 한 항목에 비밀이 섞이면 DEC-36에 따라 항목을 나누며 숨겨진 ID나 quote를 그대로 반환하지 않는다.
- 공개 범위가 미정이거나 판정할 수 없으면 공개하지 않는다. 과거 공개 이력만으로 현재 접근 권한을 우회하지 않는다. 공개 철회·권리 제한과 기존 Fork의 권한 처리 세부는 공동 합의 대상이다.

**고정된 최초 기준과 현재 추종 상태를 구분한다(DEC-37).** Fork 생성 당시 기준 회차·원고 버전·Checkpoint·허용된 세계관 기준은 보존한다. 독자 최초 수정 전에는 기준 회차에 영향을 주고 그 시점에 공개되는 원작 변경을 추종한다. 예컨대 10화 작업 중 추가했어도 1화에 적용·공개된 정정은 1화 Fork의 추종 대상이 될 수 있다. 단순히 생성 시간이 늦다는 이유로 제외하지 않는다.

추종은 Reader가 wr-1 요청을 wr-2로 바꾸는 동작이 아니다. 회차/Fork 서비스가 적용·공개 범위를 판정하고 **현재 참조 기록을 새로 선택·기록**하는 별도 작업이다. 최초 수정 시 허용된 기준 회차 세계관 전체(상태·지식·관계 포함)를 독자 소유로 분리한다. 독립 뒤에는 원작 변경을 알리고 사용자가 선택한 경우에만 반영하며 거절한 변경도 나중에 선택할 수 있다. ID 복사 대응·충돌·알림·현재 포인터 저장 모델은 미정이다. 원작의 미공개 내용까지 복사하지 않는다.

## 5. 이미지 계약의 경계

DEC-39는 설정당 최대 10개 이미지, MinIO(S3 호환), RDB URL 저장 및 **과거 이미지 파일의 변경 이력 미보존**을 확정했다. 이를 이미지 버전 영구 보존으로 바꾸지 않는다. WorldRevision의 텍스트 복원이나 EpisodeCheckpoint 재조회가 당시 이미지 파일 복원을 보장하지 않는다.

이 문서는 이미지 테이블·DTO·API·URL/ID 필드를 추가하지 않는다. 이미지 담당과 협의할 항목은 연결 식별 방식, 참조 중인 자산의 삭제·정리 시점, 권한/공개 범위, 과거 회차·Fork에서 이용 불가한 이미지의 표시, 최신 이미지로의 교체 허용 여부다. 과거 파일이 없을 때 최신·비공개 이미지를 자동 대체 노출하지 않는 방향을 권장한다. 불변 텍스트 참조와 이미지 파일 생존을 혼동하지 않는다. 이미지 없이도 카드·회차 텍스트 이용은 가능해야 한다. 실제 이미지 구현 상태는 이번 문서 검증 대상이 아니다.

## 6. 홍길동전 사용 예시 — 목표 흐름, 실행 결과 아님

| 단계 | 기준과 처리 |
|---|---|
| 초기 V1 | 홍길동·홍 판서 인물, 활빈당 조직, 초기 부자 관계·복합 감정을 카드/관계 버전으로 저장하고 `wr-1`로 묶는다. 초기 기본 비공개 |
| 원작 1화 | 작품에 world를 연결하고 1화 초안이 wr-1을 선택. 작가가 1화에 공개할 인물·관계를 지정한다. 활빈당의 미공개 활동·지식은 공개하지 않음 |
| 1화 확정 | 원고 버전 e1-v1이 wr-1과 당시 변경 이력을 기록. CP1은 1화 상태·관계·지식 기준을 묶는다. 실제 생성 시점은 팀 합의 후 구현 |
| 2화 변화 | 홍길동이 활빈당에 합류하고 홍 판서에 대한 감정이 변한다. 2화 변경 이력에 적용 시점을 기록하며 wr-1의 카드/관계는 그대로 둔다 |
| 1화 조회 | e1-v1/CP1에 따른 공개 범위를 사용한다. 2화 합류·감정·지식은 1화 결과에 포함하지 않는다 |
| 1화 Fork | CP1 및 1화까지 허용된 세계관 전체를 기준으로 시작한다. wr-1 전체를 그대로 공개하지 않는다. 이후 1화에 적용·공개되는 정정은 독립 전 추종하고 독립 후 알림·선택 반영 |

V1의 작가용 내부 조회에 미래 구상이나 비공개 활빈당 카드가 포함될 수 있어도 공개 조회는 이를 제외한다. 이후 1화 소급 정정은 단순한 2화 진행 정보와 구분하여 DEC-37로 처리한다.

## 7. 기존 구현과 통합 차이

기존 설계가 확인한 develop `ae00f47633647877ca671fde593b772068870732`를 참고 기준으로 사용한다. 최신 원격 소스 전체를 이번에 재검증했다는 뜻은 아니다. 현재 작업 트리의 content 조회·저장 구조를 참고하되 목표 모델 구현 완료로 간주하지 않는다.

| 대상 | 현재/제안 구분 | 통합 시 확인 |
|---|---|---|
| world, setting_document, setting_draft, setting_version | 기존 테이블 재사용 후보 | 카드 논리/버전 ID 매핑, 8종·7영역·별칭·legacy 의미, 독립 world 조회 및 같은 writer 규칙 |
| checkpoint, checkpoint_episode, checkpoint_setting | 기존 회차 테이블 | WorldRevision 자체로 대체하지 않음. 회차 동적 상태·지식·관계의 완전성 및 참조 확장 필요 |
| world_revision 및 manifest·관계 버전 | 초기 설계 문서의 신규 제안 테이블 | 이번 PR에서 생성하지 않음. 팀 승인·공통 Flyway 담당과 순서 합의 필요 |
| 회차 draft/version의 기준 참조 | 이 문서의 논리 계약 제안 | 기존 content version과 WorldRevision의 ID·revision 순번 구분. FK 위치와 추가 컬럼은 미정 |
| WorldBaselineReader / Snapshot | 새 내부 계약 제안 | 기존 외부 작업실 PUT/GET이나 회차 API가 이 계약을 제공하는 것은 아님 |

물리 테이블 목록은 [초기 설계의 재사용·확장 및 신규 제안](world-studio-initial-model.md)을 따른다. 새 SettingCard 전용 테이블이나 EpisodeCheckpoint 동명 테이블을 중복 생성하지 않는다.

## 8. 합의 상태와 후속 검증

| 구분 | 내용 |
|---|---|
| 확정된 설계 방향 | 사용자 방향인 8종/7영역·독립 world·관계 선택·WorldRevision, DEC-27/33의 불변 이력·새 버전 정정, DEC-36의 기본 비공개, DEC-37의 Fork 추종/독립, DEC-39의 과거 이미지 미보존, DEC-40의 설정 초안/명시 저장 분리 |
| 권장 계약 | 정확한 확정 revision만 내부 조회, 회차 초안에서 기준 고정·명시 변경, 원고 버전별 기준 추적, PostgreSQL 관계 정본 + Graph projection, 작가/공개 DTO 분리. 팀 최종 확정 아님 |
| 팀 합의 필요 | Principal 매핑·읽기 역할, setting writer 책임, FK/manifest 위치·원자성, 회차 변경 이력 식별자·적용/공개 시점, direction/polarity 코드·조건 저장 위치, visibility 범위·근거 접근 정책, Checkpoint 생성/완전성, Fork ID 복사·추종 충돌, 이미지 참조 안전성, migration 담당·순서 |
| 후속 구현 | 합의 뒤 Core 내부 DTO/조회·권한 검증과 회차 연동 구현, 기존 데이터 무손실 변환, 공동 DB migration, Graph projection 및 오류 처리. 이번에는 수행하지 않음 |

후속 수용 테스트: 8종·7영역·별칭·legacy 필드 왕복, 요청 revision 고정, 초안/권한 없음/다른-world/누락 manifest 거절, 1화 조회에 2화 정보 제외, 관계 endpoint·근거 유출 차단, 동시 기준 교체 충돌, 최초 Fork 기준 보존과 독립 전후 추종, 과거 이미지 부재 시 비공개 최신 이미지 미노출. 이는 테스트 계획이며 통과 기록이 아니다.

이번 변경의 검증은 두 문서의 필드·버전 의미·정책 일관성, JSON 예시 구문, Markdown·링크, diff 공백에 한정한다. 문서만 변경하여 앱 테스트·DB 테스트·브라우저 E2E는 제외한다.
