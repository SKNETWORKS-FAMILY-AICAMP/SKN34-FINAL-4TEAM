# 세계관 직접 작성·저장·재조회 — 첫 Draft PR

Refs #48. 최신 원격 develop `a8d44ffc77e4b91cc21a9a6a3e3644177917e404`에서 전용 브랜치 `feat/world-studio-01-direct`를 만들었다. 개인 통합 브랜치를 merge/cherry-pick하지 않았다. 기존 01 패치 기준은 `09f3c9b`, SHA-256은 `ce5ee9105da828f359708e913ceb2b13ad144adfabc0264463a3061fced715b2`다. 01의 코드만 참고해 최신 #68 라우트·DI와 충돌을 직접 정리했으며 과거 검증은 이번 결과로 계산하지 않는다. 과거 통합 문서와 07/08 전체 패치는 포함하지 않았다.

## 기능과 계층

세계관 생성·목록·선택·이름/설명 수정, 인물·장소 등 기존 10개 작성 메뉴, 항목 이름·원문·자유 분류·태그, 명시 저장·재조회·이력 보존·기준 버전 충돌 검사를 제공한다. 빈 메뉴를 채우거나 AI를 호출할 필요가 없다. 인물/장소는 이름만으로 저장할 수 있다. 저장은 공개/발행이 아니다. 원문과 ID를 보존하며 실패하면 마지막 저장본과 작성 중 값을 유지한다.

- `WorldStudioPage`와 공통 CSS: 직접 작성 화면·독립적인 목록 접기, 현재 페이지의 상태 유지, 접근성 버튼·반응형. 후속 탭·그래프 import는 없다.
- `useWorldStudioViewModel` → `WorldStudioUseCase` → `HttpWorldStudioRepository`: View→VM→UseCase→Repository→Core, Zod 응답 검증과 오류·미저장 상태 보호.
- `WorldStudioController`·`WorldStudioAccessFilter`: opt-in 로컬 체험 세션과 소유자 범위 API. 세션은 운영 인증이 아니다.
- `WorldStudioService`·`WorldStudioStore`·`WorldStudioConfig`: 입력·소유자·version 검사, 현재 정본과 불변 revision을 트랜잭션으로 저장. 기존 설정 제거는 허용하지 않는다.
- 루트 `.env.example`과 native launcher: 작업실 설정만 Core 허용 목록에 추가하고 콘텐츠/AI의 기존 설정 전달을 유지한다.

## 실행과 데이터 경계

루트 개인 `.env` 한 곳에 `STUDIO_ENABLED=true`, `STUDIO_DB_URL=jdbc:h2:file:/절대경로/개인파일`을 명시한다. 기본은 비활성이다. JDK 21에서 Core와 Node 24/pnpm 11.22의 web을 기존 native launcher로 실행하고 `/worlds`에 들어가 사용자 데모·체험 환경 안내의 작업실 연결을 사용한다. 프록시 대상과 CORS Origin은 실제 web/Core 주소에 맞춘다. QA는 항상 별도 포트와 별도 H2 파일을 지정한다. 사용자 DB를 테스트 데이터로 초기화하지 않는다.

H2는 로컬 개발용이며 PostgreSQL 운영 저장 구현이 아니다. 작업실만 소유하는 DriverManagerDataSource/JdbcTemplate/transaction을 구성하고 공통 DataSource bean·spring.datasource.*·기존 Flyway 경로를 등록/변경하지 않는다. `STUDIO_DB_URL`은 embedded H2 file/mem URL만 허용한다. 기본 비활성 Core가 DB 없이 기동하며, 별도 Core DataSource가 있어도 이를 대체하거나 studio 테이블을 만들지 않는 회귀 테스트를 추가했다.

## 팀 통합 검토

- #68: 2026-11-03 조회 시 병합됨, merge SHA `a8d44ff`. 콘텐츠는 별도 PostgreSQL 연결과 `content_schema_history` Flyway를 사용한다. 기존 `/content`, `/studio/:id`, Episode DI 등록을 보존한다. 콘텐츠 스키마와 migration 파일은 수정하지 않는다.
- #71: 조회 시 open, head `c695b8765dca897ed12459bdcc5f2d98c76f8cbb`. 공통 PostgreSQL/Flyway, JWT와 CSRF, STATELESS 및 anyRequest denyAll을 추가한다. 현 작업실의 HttpSession/로컬 actor 선택은 실제 회원 identity가 아니다. #71을 병합하면 studio 요청은 기본 거부되며 프런트 토큰·CSRF 연계도 없다. 임의 permitAll이나 CSRF 예외로 우회하지 않는다.
- Ready 전 `/api/v1/studio/*` 정책, 회원 Principal/소유자 ID 매핑, CSRF·세션 대체 및 운영 저장 방향을 인증 담당자와 합의해야 한다. 선택 가능한 체험 actor는 로컬 검증만 위한 것이므로 공개/역방향 프록시 운영에서 이 플래그를 켜면 안 된다. 운영 인증/데이터 격리가 완료됐다고 표시하지 않는다.

## 제외 및 Ready 조건

AI 분석·후보·승인, 설정집·관계도·시간선·전체 지도, 카드/감정 편집·삭제·undo, 회차 상태·Fork 동기화·이미지/MinIO는 추가하지 않는다. 기존 develop의 콘텐츠 설정/분기 데모는 건드리지 않는다. #48 전체 해결이나 #49 완료로 표시하지 않는다.

Ready 조건: 최신 Required CI 실제 성공, #71 인증/접근 정책 및 DB 운영 연계 합의, 팀 변경과의 합성 검증, 아직 남은 실제 브라우저/서버 재시작 검증 결과 확인. Draft를 Ready로 바꾸거나 병합하지 않는다.

## 이번 실행 결과

- Frontend 관련 9파일 37테스트 통과. 목록 접기 테스트는 후속 탭 없이 직접 작성 메뉴 전환과 미저장 입력 보존을 검사한다.
- Core 선택 19테스트 통과: 작업실 서비스/접근 필터·DataSource 분리, 기본 context, CORS, #68 콘텐츠 권한/서비스.
- TypeScript 검사·관련 oxlint·Vite 빌드·Core bootJar 통과. 기존 Vite 메인 번들 500kB 경고가 남는다.
- PostgreSQL 실제 콘텐츠 migration/coexistence 및 #71 JWT 통합 실행은 아직 미검증이다. 위 회귀를 실제 PostgreSQL 동시 구동 검증으로 표현하지 않는다.
- 이번 QA: web 5183 → Core 8099 → worktree `output/direct-qa/worlds` 새 H2 파일. 기존 5175/5181 및 사용자 DB/환경 파일은 보존했다. 첫 기동은 Windows 긴 JVM 임시 소켓 경로로 실패해 QA JVM에만 짧은 임시 경로를 지정했다.
- 브라우저/실제 HTTP·재시작 결과는 수행 후 갱신한다. 로그·스크린샷·QA JSON은 로컬 `output/`에 보관하며 커밋하지 않는다.
