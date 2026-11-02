# 세계관 작업실 PR 독립 검증 (2026-11-02)

## 판정
변경 관련 로컬 검증은 통과했습니다. 검토용 PR 준비와 병합 가능 판정은 구분합니다. 최신 develop에도 존재하는 목업 테스트 4개 실패와 원격 Required CI 미실행 때문에 전체 검증 완료·병합 가능으로 표시하지 않습니다. 이번 수정과 검증 보고는 기존 통합 커밋 `f70855a` 후속 변경으로 개인 통합 브랜치 `feature/moonsungho-world-studio`에 공유합니다. PR 생성과 develop 병합은 수행하지 않습니다.

## 기준과 방법
- 최신 develop: `09f3c9bc03109cfaba32b09d8cf45033ba1ad396` (원격 조회·fetch 확인).
- 별도 소스 폴더에 01, 01+02, 01+02+03, 01+02+03+04를 각각 적용했습니다. 다른 단계의 통과를 중간 단계 결과로 사용하지 않았습니다.
- 순차 의존 PR입니다. 02~04를 각각 develop에서 독립 기능처럼 바로 적용하는 구성은 아닙니다. 앞 PR 반영 후 다음 PR을 올리거나 의존 브랜치를 명확히 해야 합니다. 새 브랜치는 사용자 승인 후 생성합니다.
- 기존 설치 의존성을 재사용했습니다. 클린 설치·Linux·원격 CI는 미검증입니다.
- 산출물: 로컬 `output/share-ready/manifest.json`, 패치별 SHA-256, `independent-results.json`, `corrected-results.json`.
- 검증 소스·로그: 프로젝트의 `tmp/world-studio-verified-20261102/pr1`~`pr4`. DB·로그·증거는 Git 대상에서 제외합니다.

## 결과
| 단계 | 관련 프런트 테스트 | Core 전체 테스트 | AI 전체 테스트 | 타입·린트·Vite·Core JAR |
|---|---:|---:|---:|---|
| 01 직접 작성·저장 | 36 통과 | 61 통과 | 해당 없음 | 통과 |
| 02 조회·권한·복원 보호 | 43 통과 | 61 통과 | 해당 없음 | 통과 |
| 03 선택적 분석·승인 | 43 통과 | 67 통과 | 13 통과 | 통과 |
| 04 확정 표시 | 44 통과 | 67 통과 | 13 통과 | 통과 |

프런트는 App.world-studio, App.library, App.create-flows, HttpWorldStudioRepository, Library/Studio UseCase, studioSections, world/new-work ViewModel, useAsyncData 회귀를 실행했습니다. Core는 각 단계에서 `gradlew test bootJar --no-daemon --max-workers=2`, AI는 해당 단계 코드에서 기존 개발 venv의 `python -m pytest`를 실행했습니다.

## 이번 수정과 재검증
1. 실제 부정 관계가 관계도 제목에 긍정으로 표시되는 오류를 회귀 테스트로 재현했습니다. `polarity=denied`면 제목에 `아님`을 표시하도록 한 줄 수정했습니다. 후보·편집 중 값 제외, 승인 후 관계·사건 표시, 분석 실패 후 설정 보존 테스트가 통과합니다.
2. App.world-studio 테스트의 Testing Library getByRole에 지원되지 않는 `exact` 옵션이 타입 검사를 실패시켰습니다. 기본 문자열 정확 일치를 유지하며 옵션만 제거했습니다. PR1·2 메뉴 테스트와 타입 검사를 다시 실행하여 통과했습니다. PR3·4는 수정 후 전체 관련 검증을 실행했습니다.
3. 커밋 후에는 누락되는 기존 패치 생성기를 기준 커밋 대비 diff+미추적 파일로 수정했습니다. 최신 develop의 환경 예시를 보존하고 04 테스트를 04에만 배정했습니다. 문서의 trailing whitespace도 수정했습니다.

## 실제 API·DB 검증
PR1의 실제 Core JAR를 8092 포트의 별도 H2 DB로 실행했습니다. 생성→저장→수정→재조회, 빈 이름 저장 409와 기존 확정 데이터 보존, 서버 종료·재기동 후 항목 ID `stable-item`·본문·버전 3 재조회가 통과했습니다. 검증 요청의 authorText도 실제 UI처럼 본문과 함께 갱신했습니다. 사용자 preview DB는 사용하지 않았습니다.

## 브라우저 검증
Aside의 별도 QA 탭 `http://127.0.0.1:5177` → Core 8091 → 별도 H2 DB, 가짜 AI 서버 8111을 사용합니다. 사용자 5175/8086 화면·DB는 그대로 유지합니다.
인물 2명, 신뢰 관계, 부정 적대 관계, 역사 사건 합성 데이터를 사용했습니다. 관계 제목 `가람 → 신뢰 → 나래`, `가람 → 적대 아님 → 나래` 표시, 승인 전 후보의 시간선 제외, 후보 명시적 승인 후 `등대 건립` 표시, 강제 422 분석 실패 진단 표시를 확인했습니다. 실제 모델 호출은 0회입니다.

## 기존 develop 실패와 제한
전체 프런트 실행에서 `src/index-html.test.js`의 아래 4개가 실패했습니다. 별도 최신 develop 원본에서도 동일하게 30 통과/4 실패가 재현되었습니다. 공통 원인은 존재하지 않는 버튼에 대한 `.click()`입니다. 이번 세계관 코드 변경으로 생긴 회귀는 아닙니다.
- opens character chat management and starts a fork chat
- keeps a chapter-by-chapter selection when every chapter is allowed
- shows the policy page when forking from a novel detail page
- shows the creation policy on every visit to the new story button
전체 실행은 이후 장시간 종료되지 않아 중단했고 관련 범위로 분리했습니다. 전체 테스트 통과로 표현하지 않습니다. 범위 밖 목업 코드를 수정하거나 테스트를 삭제하지 않았습니다. 이 실패는 팀에서 기준 브랜치 수정/원격 재현 여부를 확인해야 합니다.

## Issue·범위
#7 조회 경로, #29 이전 대상 데이터, #30 소유권·비공개 규칙, #33 복원 결과의 관련 회귀가 02에서 통과했습니다. 번호 전체 요구사항 종료 여부는 별도이며 이번에 Issue를 수정·종료하지 않았습니다. #48은 직접 작성/저장/조회와 선택적 AI 흐름의 부분 구현입니다. 실제 인증, PostgreSQL, 항목·회차 공개, 이미지/URL, 자동저장, 복원 UI는 남아 있습니다. #49 작품 생성 정책과 #10 기존 작품 사전 대기열은 범위 밖·미해결입니다.

## 리뷰
ponytail-review로 변경된 표시 코드, 호출 ViewModel, HTTP 경계, 회귀 테스트와 분리 패치를 대조했습니다. 신규 의존성·추상화는 추가하지 않았습니다. 기존 로컬 체험 세션/H2 용도에서 검토했으며 운영 인증·다중 인스턴스 운영 준비로 판정하지 않습니다. Graphify 그래프/CLI가 없어 관련 소스 직접 추적으로 영향 범위를 확인했습니다.

## 추가 브라우저 결과와 증거
분석 실패 후 관계 목록과 시간선에 기존 확정 자료가 유지됐습니다. 390px 뷰포트에서 시간선 버튼을 포커스하고 Enter로 전환했습니다. 새로고침 시 데모 로그인 상태는 초기화되며 데모 재진입 후 같은 세계관과 승인한 사건이 DB에서 재조회됩니다.
스크린샷은 CDP timeout으로 실패하여 픽셀·시각적 반응형 검증은 완료하지 못했습니다. DOM/키보드 흐름 확인과 시각 검증을 구분합니다.
Aside 증거 위치: `C:/Users/MoonSungHo/.aside/u/0/sessions/2026-11-02_zR4IDRY54BSRrPn9/artifacts/`의 analysis-failure, relations-after-failure, timeline-mobile-keyboard, wiki-after-reload, relations-after-reload 텍스트입니다.
최종 패치 코드와 독립 실행 소스의 일치는 `output/share-ready/final-source-audit.json`에 기록했습니다. 문서 갱신 이외 코드가 다르지 않은지 확인했습니다.
