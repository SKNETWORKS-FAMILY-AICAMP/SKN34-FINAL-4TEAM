# 세계관 작업실 통합본

`feature/moonsungho-world-studio`는 코드 공유용 개인 통합 브랜치입니다. 운영 배포·develop 병합 준비 완료를 뜻하지 않습니다. `Refs #48`의 부분 구현이며 #49는 연계 참고입니다.

## 동작과 구조

Frontend View → ViewModel → WorldStudioUseCase → WorldStudioRepository → Core 공개 API를 사용합니다. Core가 소유자·기준 버전·정본 저장을 판단합니다. 직접 작성은 AI 없이 가능하고 AI는 저장본에서 후보를 제안합니다. 사용자가 고른 후보만 확정 settings에 들어갑니다.

- `/worlds/:worldId?`: 목록/생성, 인물·장소·기본 설정·시공간·역사·사회·문화·특수 규칙·갈등·메모의 작성/조회/수정.
- 저장 상태: 편집 중 변경과 마지막 저장본을 분리합니다. 실패 시 입력/저장본을 유지합니다. 저장은 독자 공개·발행이 아닙니다.
- AI: 서버 flag와 사용자 동의가 필요합니다. 실패/중단·미승인 후보는 정본에 섞지 않으며 직접 입력한 ID/분류/태그를 보존합니다.
- 설정집/인물 관계/초기 역사 시간선은 저장된 settings만 읽습니다. 관계는 명시적 목록이며 그래프 DB/시각화가 아닙니다.

## Core API와 설정

| API | 용도 |
|---|---|
| POST `/api/v1/studio/session` | 로컬 체험 actor 세션(author/reader1/reader2), 운영 인증 아님 |
| GET/POST `/api/v1/studio/worlds` | 소유자 목록/생성 |
| GET/PUT `/api/v1/studio/worlds/{id}` | 상세/기준 버전 확인 후 새 revision 저장 |
| GET `/api/v1/studio/worlds/{id}/history` | 소유자 확인 후 revision 조회, 사용자 revert UI 없음 |
| GET `/api/v1/studio/worlds/capabilities` | AI 활성 상태 |
| POST `/api/v1/studio/worlds/{id}/analyze` | 선택적 후보 생성 |
| POST `/api/v1/studio/worlds/{id}/approve` | 선택 후보 승인, 참조/기준 버전 검사 |

루트 `.env`의 서비스별 allowlist만 native launcher에 전달합니다. `STUDIO_ENABLED`, `STUDIO_DB_URL`은 Core용이고 `WORLD_STUDIO_AI_ENABLED`는 Core/AI에만 전달합니다. 모델 키는 AI에만 두며 브라우저에 전달하지 않습니다. AI 기본값은 false입니다. 

사용자와 QA는 서로 다른 DB/포트를 사용합니다. 로컬 preview는 기존 사용자 데이터용, QA는 합성 자료용입니다. DB 파일·JAR·PID·로그·브라우저 자료는 Git에 넣지 않습니다. 첫 생성에는 예시 데이터를 자동 저장하지 않습니다.

## 범위와 제한

[#48 대조표](world-studio-direct.md)를 기준으로 실제 인증·PostgreSQL·항목/회차 공개·고정 카테고리 합의·이미지 10개/MinIO·참고 URL·자동저장·사용자 이력/revert UI는 미구현/부분 구현입니다. 10개 메뉴/자유 분류와 LLM topics는 고정 카테고리 정책이 아닙니다. AI 호출은 #48 필수가 아닙니다.

기존 작품·회차·Fork·가져오기는 메모리 데모로 유지합니다. 새 원작에 세계관 하나를 연결하는 #49 정책과 현재 다중 선택 데모의 차이는 후속 담당자 참고이며 이번 작업에서 바꾸지 않습니다. 실제 작품 API/연결 유일성/영속 저장은 없습니다.

## 검증과 공유

기존 통합 회귀(프런트 25개 등)와 Core/AI mock 확인은 단계별 독립 검증을 대체하지 않습니다. 최근 Origin 구성 일치 회귀 4개는 통과했습니다. 최신 develop `1c749b17cb6cb64a3dffffb9c805628ad57cf986`을 읽기 확인했고 코드 변경은 없고 문서 변경만 확인했습니다. 사용자 작업을 reset/rebase하지 않았습니다.

현재 독립 단계 검증은 진행 중입니다. [단계별 상태](world-studio-sharing.md)와 [검토용 PR 본문](pr-preparation/01-direct.md)에 실제 명령/결과를 기록합니다. 실제 모델/제공사 호출, 운영 환경, 원격 CI, 병합/배포는 검증 완료로 표시하지 않습니다.
