# 최초 세계관 구축 UI·사용자 E2E — 2026-11-17

기존 `initial-world-two-path-qa` 미커밋 작업 위에서 수행했다. 기준 HEAD `6b4b3e19b04ea533b46e652b866928902faa1d60`, 브랜치 `feat/initial-world-build-integration`. 이 HEAD 자체에 아래 변경이 커밋됐다는 뜻은 아니다. 기존 V9와 백엔드 구조를 유지했으며 이번 추가 제품 변경은 프런트 연결이다. 커밋/PR/push/병합/배포/유료 모델 호출 없음.

## 판정

**격리 QA에서 작가가 실제 로그인·파일 업로드·명시적 시작·실패 후 같은 작업 재개·카드/인물 문서/관계 편집·서버 저장·명시적 확정·재로그인 재조회까지 수행했다: PASS.** 실배포와 실모델 품질 판정은 아니다.

| 항목 | 실제 브라우저 | HTTP·DB 근거 |
|---|---|---|
| 실로그인·작품 생성·4 TXT 업로드 | PASS | 실제 Core 로그인, 작품 생성 201, bulk 업로드 200: 4/4 성공, 발행 0 |
| 명시적 시작·진행 조회 | PASS | 업로드 직후 제공사 호출 0. 동의 후 POST 202, GET running/failed/loading/completed |
| 실패 이유·서버 재시작·동일 작업 재개 | PASS | 2화 AI_TIMEOUT, 1/4 저장. QA Content restart 후 동일 job과 1화 result 유지. 재개 호출 순서 1,2,2,3,4 |
| 초안 열기·인물 문서 편집·저장 | PASS | 카드 5개 파싱, IDENTITY/SOUL 편집, PUT draft 200 |
| 관계 조회·편집·저장 | PASS | 최신은 4화 종료로 0개, 1화는 길동→활빈당 1개. 설명 편집·저장 후 같은 UUID/끝점/근거, 4화 ended 기록 유지 |
| 명시적 확정·확정본 조회 | PASS | POST revisions 200, 상세/목록 GET 200, 확정 버전 1 생성 |
| 로그아웃·재로그인·재조회 | PASS | 실제 로그아웃/로그인 200 후 동일 완료 job/5카드/확정 버전 1 재조회, 새 구축 POST 없음 |
| 출처·첫 등장/공개 분리 | PASS | 카드 5개 manuscriptBuild 메타데이터 완전 일치, 모두 private, revealFromEpisode 미설정. 관계 근거도 일치 |
| 기존 직접 등록 경로 | 회귀 API 근거는 이전 단계 | 이번엔 원고 브라우저 흐름에 집중. 기존 HTTP 어댑터 99개 회귀 통과, 직접 등록 실로그인 브라우저 전체 재실행은 NOT TESTED |

## 식별자와 재현 환경

- QA 작품: `ef742e9c-a0f3-4b2b-bc69-b22fb4491160` / QA 브라우저 최초 구축 4화 1117
- 세계관: `c156dafc-259b-445d-a305-703697f4a34a`
- 최초 작업: `ac2df3b4-f79d-42c1-8cd1-1bd610dc5a70`
- 요청 key: `722a151a-174d-4347-be60-4abe49c5e2e1` (인증 비밀 아님)
- 확정 버전: `a39c4a92-5b9f-4f1c-9266-043064e8699b`
- 길동 카드: `9fbaefe8-4b86-3552-9224-1ce1ceb42aa8`
- 활빈당 카드: `c3b88364-8003-3e21-9ad6-7b99d0ff7a79`
- 관계: `18d844f5-9334-31a7-9356-650ee20e0e7e`
- Vite `127.0.0.1:5187`, 실제 Core `18080`, Content `18081`, 제공사 대역 `8769`.
- Docker 프로젝트 `storyfork-initial-build-qa-20261117`, 전용 PostgreSQL의 qa_core/worldstudio_test, 전용 Neo4j. 기존 사용자 DB·다른 컨테이너는 수정하지 않았다.
- [QA Compose](compose.browser.yaml)를 기존 compose.qa.yaml 위에 사용. 실행 jar는 [빌드 스크립트](build-browser.sh)로 생성했다. 초기 qa_core DB는 QA PostgreSQL에만 생성. sample writer로 실제 로그인했다.
- 제품의 manuscript-build 기본 비활성 유지. QA Content 명령 인자에서만 명시적으로 활성화. 실제 FastAPI 추출/구조화 경로에 제공사 함수만 합성 결과 대역으로 교체했다.

## 이번 구현과 발견 결함

- 작품 관리의 원고 진입 버튼과 세계관·설정집 패널, 동의·시작·상태·재개·초안 링크를 추가했다.
- 기존 CSRF/인증과 Web Lock 재사용. 계정·작품별 key를 전송 전에 보존하며 실패 시 유지한다. 서버 상태/receipt 검증 전 성공으로 표시하지 않는다.
- 실제 브라우저에서 **비공개 업로드 원고가 있는데 공개 episodes.length가 0이라 시작이 막히는 오류**를 재현했다. 실패 테스트 확인 후 그 조건만 제거했다. 저장 원고 유효성은 Content가 판단한다.
- 완료 job을 다시 볼 때 이미 확정했을 수 있어 '아직 확정하지 않았다'는 단정을 '초안 생성만으로 확정하거나 공개하지 않는다'로 수정했다.
- 저장 모델·V9·일반 WorldStudio 저장·직접 등록 후보 승인 계약은 재설계하지 않았다. 프런트 메타데이터 어댑터를 새로 바꾸지 않고 실제 저장 왕복을 검증했다.

## 실행 증거

- [HTTP 흐름](browser-evidence/flow-http.ndjson): 브라우저가 발생시킨 Content 요청 method/URL/응답 status/body. 로그인은 status만 기록. 인증 토큰·쿠키·비밀번호는 제외했다. 요청 본문 네트워크 캡처는 포함하지 않으며 원래 key/manifest/payload는 아래 PG 기록으로 대조한다.
- [Content 재시작 로그](browser-evidence/content-restart.txt), [재시작 후 실패 기록](browser-evidence/after-restart-failed.json), [최종 PG](browser-evidence/final-postgres.json): job 1개 completed, 추출4+정체1+payload1=6 결과, load_step 2개 applied/receipt. 최초 1화 결과 ID 유지.
- [편집 전 카드](browser-evidence/cards-before-edit.json), [편집 후 카드](browser-evidence/cards-after-edit.json), [비교 판정](browser-evidence/roundtrip-check.txt).
- [카드 저장 후 Neo4j](browser-evidence/neo4j-after-card-save.txt), [관계 편집 후 Neo4j](browser-evidence/neo4j-after-relation-edit.txt), [관계 비교 판정](browser-evidence/relation-roundtrip-check.txt).
- [제공사 호출](browser-evidence/provider-calls.json): 1화 재호출 없음. 실패 2화만 재처리하고 뒤의 3/4화 처리.
- [실패 화면](browser-evidence/manuscript-failed.txt), [완료 화면](browser-evidence/manuscript-complete.txt), [확정 화면](browser-evidence/confirmed-screen.txt), [재로그인 확정본](browser-evidence/relogin-revision-screen.txt), [관계 편집](browser-evidence/relation-edited-screen.txt). 실제 Aside 브라우저 접근성 스냅샷이며 API 테스트의 대체 화면이 아니다.
- Aside screenshot은 CDP timeout으로 PNG를 확보하지 못했다. 정지 이미지 기반 픽셀·레이아웃 판정은 하지 않는다.

## 테스트와 한계

- TDD: 초기 repository/panel 부재 실패 → 구현 통과. 비공개 원고 시작 차단 회귀 1개 실패 확인 → 최소 수정 통과.
- 선택 실행 **115개 PASS**: HTTP manuscript 5, WorldStudio HTTP 99, panel React 4, WorkManagement React 7. [JUnit](browser-evidence/ui-tests.xml). 단위 104와 React 통합 11을 구분한다.
- 최종 안내 문구 변경 후 panel React 4개 재실행 PASS: [JUnit](browser-evidence/ui-final-copy-tests.xml).
- 변경 파일 Oxlint PASS. ponytail-review: 신규 프레임워크·일반화 계층 없이 기존 DI/인증/저장 경로를 재사용하며 추가 삭제 권고 없음.
- TypeScript `tsc -b --noEmit` PASS, `git diff --check` PASS(기존 파일 LF/CRLF 경고만).
- 기존 [4화·10화 HTTP/DB 검증](final-connection.md)은 보존하며 이번 브라우저 4화 증거와 구분한다. 백엔드 전체 테스트/CI를 이번에 다시 실행한 것으로 보고하지 않는다.
- 실제 재시작은 **실패 상태에서 Content 정상 restart** 후 동일 job 재개다. 실행 중 kill -9/호스트 재부팅/브로커 장애·다중 탭 실경합/브라우저 통신 유실 주입은 이번 브라우저에서 NOT TESTED. unknown 동일 key 복구는 어댑터 단위와 기존 PG/Neo4j 통합 근거다.
- 모바일 레이아웃·전체 키보드 동선·스크린샷 품질 검증은 NOT TESTED.
- 10화 브라우저, 실제 배포, 유료 모델 품질, 20~30/100화 성능은 NOT TESTED/범위 제외.
- key가 없는 다른 브라우저에서 실패 job 재개는 지원하지 않는다. 원래 브라우저를 안내하며 새 key를 자동 생성하지 않는다.
- 미발행 작품의 집필 AI 채팅은 준비/조회 오류 안내 상태로 유지하며 이번 범위에서 호출하지 않았다.
- 확정 상세의 '관계 과거 상태를 저장하지 않는다' 문구는 DEC-51 회차 조회와 오해 소지가 있다. 확정 버전 자체의 관계 복원 미지원이라는 기존 경계를 뜻하며, 이번 연결 변경에서는 해당 팀원 UI를 수정하지 않았다.

기본 활성화/실배포 승인은 별도다. 사용자가 직접 만드는 QA 경로는 완료됐지만 실모델 결과의 의미적 정확성은 검증하지 않았다.
