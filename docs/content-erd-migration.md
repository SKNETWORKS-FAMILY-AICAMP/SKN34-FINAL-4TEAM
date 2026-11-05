# 콘텐츠 저장 구조와 최신 ERD 대응

> **범위:** 아래 Core·DB·경로·검증 이력은 분리 전 실제 구현을 설명한다. [DEC-41 목표](design/service-boundaries.md)에서 콘텐츠 정본·인가·발행·첨부는 콘텐츠 서비스로 이전하고 회원·인증·크레딧·알림은 Core에 남긴다. 기존 API·Flyway·데이터는 보존하며 이 문서 갱신은 이전 실행이나 과거 검증의 재실행을 의미하지 않는다.

기준은 `b5bcd4d`에 병합된 [143개 논리 후보 ERD](design/erd/README.md)와 [정규화 원칙](design/erd/normalization.md)이다. 사용자 확인에 따라 현재 구현된 작품·설정집·집필·발행·Fork·AI 이어쓰기 범위만 이식한다. ERD 원본을 구현에 맞춰 수정하지 않는다.

현재 Core 내부 책임 분리·JPA 전환 및 이번 검증 상태는 [#84 대응 문서](issue-84-content-boundaries.md)를 따른다. 아래 날짜별 기록은 당시 결과이며 이번 변경의 검증을 대신하지 않는다.

## 정본과 조회

`content_work.payload`를 운영 정본으로 읽거나 쓰지 않는다. 작품별 전체 JSON 덮어쓰기는 제거하고 아래 관계에 저장한다. `work_current`, `episode_current`, `setting_version_read`는 조회용 SQL VIEW이며 별도 현재값 저장소가 아니다.

| 현재 기능 | ERD의 저장 관계 |
|---|---|
| 작성자·작품 | `member`, `work` |
| 세계관 연결·공개 상태 | `world`, `work_world_history`, `work_publication_history` |
| 회차·초안·불변 저장본 | `episode`, `episode_draft`, `episode_version` |
| 발행·권리 확인 | `publication_event`, `work_rights_declaration` |
| 설정 식별·초안·버전·출처 | `setting_document`, `setting_draft`, `setting_version`, `setting_origin`, `setting_category` |
| 태그·공개 이력·회차 범위 | `setting_tag`, `setting_document_tag`, `setting_visibility_history`, `setting_visibility_range` |
| 분기 기준 | `checkpoint`, `checkpoint_episode`, `checkpoint_setting` |
| Fork 정책·참조 상태 | `fork_policy_history`, `fork_policy_episode`, `fork`, `fork_world_reference` |
| 원본 변경 선택·반영 | `fork_source_change`, `fork_change_decision`, `fork_change_application` |
| AI 작업·실제 모델 호출 | `ai_job`, `ai_model_call` |
| 요청 원문·제안·문맥 증거 | `ai_input_snapshot`, `ai_proposal`, `ai_evidence`, `proposal_evidence` |
| 제안 선택·실제 원고 반영 | `proposal_decision`, `proposal_application`, `proposal_episode_change` |

작품에 세계관·공개 상태·Fork 허용을 중복 저장하지 않는다. 회차에도 현재 제목·발행 버전 포인터를 중복 저장하지 않는다. 저장본은 생성 당시 세계관 연결 이력을 참조한다. 설정 식별 행에는 현재 이름·본문·공개 상태를 중복 저장하지 않는다. 공개·원고 적용·Fork 결정은 서로 다른 이력이다.

## 물리 구현에서 보충한 값

- ERD의 논리 `id`를 콘텐츠에는 문자열 UUID, 기존 인증 주체에는 200자 이내의 안정적인 Principal 식별자로 구현했다. `member`의 이메일·비밀번호는 외부 인증 계약 때문에 nullable이며 임의 이메일·비밀번호를 생성하지 않는다. 실제 로그인 구현을 뜻하지 않는다.
- 기존 API의 회차 번호와 설정 ID·버전 ID를 보존하기 위해 `logical_id`, `content_version_id`를 둔다. 내부 FK용 ID는 작품/세계관 경계를 포함해 결정적으로 생성하므로 Fork 사본이 원작의 행을 덮어쓰지 않는다.
- `revision`, `edit_revision`, 초안 편집 순서는 낙관적 충돌 검사용이다. FK의 소속을 검증하기 위한 작품·회차 키 중복과 원작당 작성자 1회 Fork 제약은 명시적 물리 제약이다.
- `setting_version_tag`는 기존 태그 버전 스냅샷을, `setting_knowledge_scope`는 기존 `knownBy` 이름·와일드카드와 순서를 보존한다. 이는 실제 인물 ID 기반 `CHARACTER_KNOWLEDGE_VERSION`이나 관계 그래프를 완성한 것이 아니다. 팀 문서에서 인지 단위·물리 배치를 미정으로 두므로 기존 문자열을 임의 인물·사실로 변환하지 않는다.
- `fork_source_setting`은 독립 당시 비교 기준을 보존한다. 최초 기준점, 변경 전후 기준점, 선택 이력, 실제 적용 기준점은 별도로 연결한다. 거절 후 재반영해도 과거 거절 기록을 지우지 않는다.
- AI 문맥은 당시 입력의 증거이므로 `ai_evidence.excerpt_snapshot`의 TEXT에 구조화된 JSON 문자열을 보존한다. 작품 정본 JSONB 저장과 구분한다. 키·내부 토큰은 저장하지 않는다.
- 설정 공개 범위의 미래 회차를 FK로 연결하기 위해 발행 전 `episode` 식별 행을 만들 수 있다. 이 행의 존재만으로 회차가 공개되지 않으며 발행 사건이 있는 버전만 공개 조회한다.

## 마이그레이션과 보존

기존 V1 체크섬은 변경하지 않는다. V2~V4는 최신 관계와 조회 VIEW를 준비하고, V5는 기존 JSONB의 원작을 먼저 옮긴 뒤 Fork를 이식한다. 변환 과정에서 원고·공개 회차·설정 이력을 대조하며 실패 시 해당 변환 트랜잭션을 롤백한다. V6는 기존 `content_work`에 대한 쓰기와 확정 버전·발행·결정 이력의 덮어쓰기를 차단한다. V7은 기존 생성 시각을 보존하여 이관 실행 순서에 따라 작품 목록이 바뀌지 않게 한다.

`content_work`는 이전 데이터 백업으로 남고, 새로운 저장은 관계형 테이블에만 반영된다. 자동 삭제하지 않는다. 실행 중인 구버전 Core를 중지한 후 마이그레이션해야 하며 구버전 앱으로 단순 재기동하는 것은 롤백 방법이 아니다. 복구가 필요하면 마이그레이션 전 DB 백업과 같은 버전의 앱을 함께 복원한다. V5는 변환 당시 Repository 계약을 사용하므로 이후 저장소 변경 시 구버전 fixture 마이그레이션 테스트도 반드시 유지한다.

과거 JSON에 없던 권리 확인 시각이나 Fork 조건 확인 시각은 사실처럼 만들어 채우지 않는다. 새 공개 요청과 새 Fork 생성부터 실제 확인 기록을 남긴다. 과거의 최종 Fork 허용값은 이관 시 상태를 유지하기 위한 정책 스냅샷으로 보관하며 과거 변경 시각을 복원했다고 주장하지 않는다.

## 범위와 검증 경계

기존 React HTTP 계약과 사용자 흐름은 유지한다. 세계관 선택·교체 UI, 회차별 Fork 허용 선택 UI, 기존 발행본 교체·공개 중단, 원고 이미지, 실제 인물 상태·지식 ID 모델, 그래프, 회원가입, 결제·크레딧·피드백·운영 기능은 이번 현재 기능 이식에 포함하지 않는다. 빈 미래 기능 전체를 위해 143개 테이블을 모두 생성하지 않는다.

초기 로컬 작성자 규모의 트랜잭션 직렬화는 유지한다. 큰 목록의 페이지네이션과 다중 작가 부하 검증은 아직 하지 않았다. 실제 모델 유료 호출도 하지 않는다. Aside E2E와 Docker 실제 기동은 사용자 요청 및 디스크 용량 사유로 보류이며, Required CI의 실제 성공 확인 전 전체 검증 완료로 표시하지 않는다.

## 2026-11-02 로컬 검증 기록

- 선택한 Service·Authorization·Postgres·Migration 테스트 14개 통과. V7 생성 시각 회귀는 실패를 확인한 뒤 수정하여 Migration 테스트 1개를 재실행해 통과했다.
- 별도 로컬 PostgreSQL 17의 `content_integration`을 백업하고 V7까지 이관했다. 기존 16개 작품과 이관된 16개 작품 수가 일치한다. 원본 JSON 행은 보존한다.
- 기존 화면의 작품 3개에서 초안·공개 회차·설정 이력·분기 모드·기준 설정을 API 응답으로 이관 전후 대조하여 모두 일치했다.
- `http://127.0.0.1:5173/content`에서 분기 작품의 독립 상태, 설정 원문 및 설정 버전 2개를 일반 브라우저로 확인했다. 이는 Aside E2E 완료를 뜻하지 않는다.
- 로컬 증거는 저장소 밖 `C:\Users\playdata2\Documents\ChatGPT\Final Project\episode-prototype\evidence`에 보관한다: `content-before-erd-20261102-164017.dump`, `erd-preservation-result.json`, `erd-migrated-settings.jpg`. 원고가 들어 있는 백업·화면은 커밋하지 않는다.
- ponytail-review에서 설정 순서에 따른 비교 토큰 변화, 이관 생성 시각, 확정 이력 변경 방지, 실제 모델 완료와 후속 문맥 충돌의 상태 구분을 확인하고 회귀 검증을 반영했다. 다중 작가 부하·실제 모델·Aside·Docker·Required CI는 미검증이다.
- Graphify AST 갱신을 실행했다. SQL 추출기 의존성이 없는 환경이므로 DB 관계는 SQL·Repository·PostgreSQL 테스트를 직접 대조했다.
