# 실제 저장 흐름에 맞춘 샘플 보완

## 저장 계약

- EpisodeVersionService.saveVersion → WorldService.snapshot → capture 흐름에 맞춰 각 장르에 content_only 체크포인트 1개를 둡니다.
- checkpoint_episode는 해당 장르의 저장된 미발행 1화 버전만 연결합니다. 발행된 앞 회차가 없으므로 추가 연결은 없습니다.
- checkpoint_setting은 1화 시점의 모든 확정 설정 버전을 연결합니다. selectSettings의 public 기본값은 false이므로 비공개 설정도 소유자의 스냅샷에 포함됩니다. 공개로 전환하지 않습니다.
- 일반 설정 저장 때 생성되는 setting_visibility_range를 1화 시작·종료 없음·private로 추가했습니다. 설정 초안은 확정 후 제거되는 흐름이므로 만들지 않습니다.
- episode_draft는 저장 버전과 같은 제목·본문·revision을 보존합니다. 이것이 없으면 현재 편집 원고의 본문이 빈 값으로 조회될 수 있습니다.
- ContentIdentityHelper의 UTF-8 NUL 연결 문자열 → MD5 UUID(version 3) 계산에 맞춰 회차·회차 버전·설정 문서/버전·태그 ID와 모든 참조를 수정했습니다. 설정 revision은 0부터 연속이며 world.revision은 확정 설정 수로 맞췄습니다.

## 추가로 확인한 빈 테이블

- publication_event: 발행하지 않은 예시이므로 비어 있습니다.
- fork / fork_source_setting / fork_world_reference: 독립 원작이므로 비어 있습니다.
- setting_reading_*: 원문을 일반 설정으로 보존하므로 rich 독서 카드 상세는 없습니다.
- 관계 및 인물의 과거 스냅샷: content_only 계약에 포함되지 않으며 Neo4j 데이터를 생성하지 않았습니다.
- work_world_history, work_publication_history, fork_policy_history, 설정 공개 정책 및 태그 참조는 유지했습니다.

## 적용 및 한계

장르별 데이터는 Flyway 버전 SQL로 제공합니다. 적용 순서와 서비스별 이력 경계는 FLYWAY.md에, 문서별 분류는 CATEGORY_MAPPING.md에 설명합니다. CSV는 확인용 스냅샷입니다.

기존 미적용 준비본을 대체합니다. 이전 준비본을 이미 DB에 적재했다면 새 INSERT를 그대로 중복 적용하지 마세요. ID 및 revision 정정은 ON CONFLICT DO NOTHING으로 갱신되지 않으므로 별도의 데이터 이관이 필요합니다. 이 작업에서는 DB 적용을 수행하지 않았습니다.

합성 데이터로 저장 직후 상태를 구성한 것이며 실제 저장 API 실행 이력은 아닙니다. 고정 timestamp와 비활성 샘플 소유자를 사용합니다. 앱 로그인 사용자의 소유권 연결이나 기본 템플릿 선택 UI는 별도 작업입니다. 원문전체와 항목별 문서의 중복은 보존되며 LLM 입력 시 중복 선택을 피해야 합니다.

단위 검증은 CSV/SQL, 서비스 ID 계산, 장르별 참조, 편집 초안 및 저장 스냅샷 상태, 원문 보존을 확인합니다. 실제 DB·HTTP·브라우저 동작은 검증하지 않습니다.

Git 공백 검사에서는 원문 Markdown의 줄바꿈용 끝 공백 경고가 발생합니다. 원문 해시 보존을 위해 삭제하지 않았습니다.
