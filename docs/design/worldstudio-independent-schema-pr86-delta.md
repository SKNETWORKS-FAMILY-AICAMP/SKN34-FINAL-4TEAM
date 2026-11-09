# PR #86 설계와 독립 초기 스키마의 차이

[메인 README](../../README.md) · [문서 목록](../README.md)

> **작성 시점 기록:** PR #86 시점의 비교 기록입니다. 현재 관계 계약은 [WorldStudio 현재 관계 MVP 계약](worldstudio-independent-schema.md#현재-관계-mvp-계약--132)을 따릅니다.

원본 문서 두 개는 수정하지 않는다. 비교 대상은 `world-card-classification` worktree의 `docs/design/world-studio-initial-model.md`, `world-episode-interface.md`이다. 아래 문구는 후속 공동 검토용 교체안이며 #86에 반영된 것이 아니다.

| 원본 위치 | 충돌 | 교체 문구 제안 |
|---|---|---|
| initial-model 결정 대기 목록, §4 실제 PostgreSQL 재사용·확장 대상 | Content world/setting_* 재사용과 공통 writer를 전제 | WorldStudio는 전용 worldstudio schema의 world/card/draft/version을 소유한다. Content 테이블·writer는 그대로 유지한다. 양 모델의 자동 매핑은 하지 않는다. |
| initial-model 결정 대기 목록 Principal 항목, §12 | Auth subject를 Content member.id로 매핑 | 검증된 Auth JWT의 UUID subject를 owner_subject UUID로 저장한다. Content/Auth FK는 없으며 API가 소유권을 검증한다. |
| initial-model §5 신규 제안, §7, §11 | projection/outbox와 AI 실행까지 물리 설계 범위에 포함 | 초기 migration은 합의된 12개 정본 테이블만 포함한다. Graph·outbox·AI·이미지 저장은 이번에 구현하지 않는다. |
| initial-model §6 공통 잠금과 writer | Content writer와 world writer의 동일 잠금 전제 | 독립 world writer가 world별 잠금·draft revision·멱등 키를 검증한다. Content와의 공동 쓰기/잠금 계약은 추후 합의한다. 현재 SQL만으로 API 동시성 구현을 주장하지 않는다. |
| initial-model §5 관계 polarity 제약 | asserted/denied를 물리 CHECK로 고정하는 제안 | polarity는 우선 nullable 원문으로 보존하며 코드 체계·기본값·검증은 API 공동 합의 대상으로 남긴다. 감정 본문을 polarity로 분류하거나 기존 값을 자동 변환하지 않는다. |
| initial-model §11 필요한 마이그레이션 단계 | 공통 스키마 확장·backfill·writer 전환 순서 | 독립 Flyway location, worldstudio.world_studio_schema_history, 새 V1을 사용한다. public 테이블 ALTER·자동 backfill·baseline/repair는 하지 않는다. 이미 이전 SQL을 적용한 DB는 별도 전환 설계가 필요하다. |
| episode-interface §7 기존 구현과 통합 차이의 표 및 마지막 문장 | 기존 world/setting_* 재사용, 전용 SettingCard 중복 생성 금지 | 회차 기존 테이블은 유지한다. WorldStudio 전용 setting_card는 별도 모델이며 Content와 자동 공유하지 않는다. 회차는 추후 world_id/world_revision_id를 명시적으로 연결한다. FK/DTO와 ID 변환은 공동 합의 후 구현한다. |
| episode-interface §8 합의 상태 | 공통 writer·무손실 변환·공동 migration을 하나의 구현 단계로 묶음 | 초기 스키마의 독립 검증과 회차 연동·기존 데이터 import·Graph 구현을 분리한다. SQL 검증은 회차/Fork/API 연동 완료가 아니다. |

두 문서의 불변 이력·새 버전 복원·기본 비공개·저장과 발행 분리·회차별 지식 제한 방향은 유지한다. 새 카드 초안/버전에는 visibility를 명시하여 복원 시 원래 정책도 새 버전에 복사한다.

미결정: 회차와의 실제 FK/manifest 위치·권한 DTO·Checkpoint 완전성·Fork ID 복사와 공개 범위·Graph 정본 및 동기화 계약·레거시 import·독립 migration의 운영 실행 경로. 이번 SQL은 이를 확정하지 않는다.
