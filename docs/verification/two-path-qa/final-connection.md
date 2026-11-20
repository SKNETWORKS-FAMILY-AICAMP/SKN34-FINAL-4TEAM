# 원고 최초 세계관 구축 최종 연결 검증

기준: origin/develop `6b4b3e19b04ea533b46e652b866928902faa1d60` (2026-11-17 원격 재확인).
브랜치: `feat/initial-world-build-integration`. 기존 미커밋 작업 보존. 새 커밋·push·PR·병합·배포 없음.

## 환경과 범위

독립 Compose PostgreSQL 17 / Neo4j 5.26, 실제 Content HTTP/Service/JPA/Neo4j.
인증 공급자와 AI 모델만 대역. AI HTTP Router → extract → resolve → organize는 실제 구현.
V1~V8 불변, 승인된 V9 유지. 팀 개발 서버·기존 사용자 데이터 미접근.
원고 업로드는 발행/AI 실행을 하지 않는다. 명시적 POST로만 시작하며 기본 실행 플래그는 false.
실행기·내부 HTTP는 기존 Spring/FastAPI를 사용한다. Celery·큐·새 저장소를 추가하지 않았다.

## 재현 명령

1. `provider_server.py`를 격리 QA용 AI 대역 서버로 실행한다. OPENAI_API_KEY를 제거하고 모델 함수만 대체한다.
2. `docker compose -f docs/verification/two-path-qa/compose.qa.yaml run --rm tests sh /workspace/docs/verification/two-path-qa/run.sh integrationTest --tests ai.storyfork.content.world.InitialBuildHttpIntegrationTest --tests ai.storyfork.content.world.ManuscriptBuildClientIntegrationTest`
3. AI `tests/preprocessing`, 프런트 `src/data/world-studio/http.test.ts` 선택 테스트.
4. `current-results/test-results`의 개별 XML 날짜를 확인한다. 이전 선택 실행 XML이 함께 남으므로 디렉터리 총합을 최신 실행 수로 사용하지 않는다.

## 연결과 보존

- 작품 소유자의 저장본 전체를 manifest로 고정: 회차 ID·저장 버전·제목·원문·hash.
- 회차 성공 결과를 V9에 먼저 보존하고 다음 회차 실행. 전체 결과 완전성 확인 후 identity/payload 저장.
- UUID는 Content에서 job별로 고정한다. 기존 WorldStudio 부분 추가 저장으로 카드·문서·DEC-51 관계를 적재한다.
- 첫 등장 회차는 manuscriptBuild.firstAppearanceEpisode. 공개 회차를 설정하지 않고 모두 private.
- 직접 등록 후보의 analysisId/decisionSequence를 위조하지 않는다. manuscriptBuild 원문 버전/result ID/UTF-16 근거/hash 보존.
- Neo4j 성공 뒤 PG 실패는 unknown, 동일 step/key/UUID로 복구. 최종 PG transaction에 초안과 receipt를 함께 기록.
- 완료 후 같은 요청은 원래 receipt. 작가 수정·추가 확정 뒤에도 이전 확정 버전 불변.

## 이번 연결에서 재현·수정한 결함

1. 진행 상태 조회가 world lock 전 JPA job entity를 읽어 optimistic lock 500 발생: scalar worldId 조회 후 world→job 잠금 순서로 통일.
2. JSONB 객체 순서로 예약 요청 hash가 달라짐: 원고 적재 요청에 한해 재귀 key 정렬로 예약/복구 hash 일치.
3. 신규 Controller가 기존 예외 advice 범위 밖이라 충돌이 500 반환: 기존 WorldStudio advice에 포함.
4. 카드 별칭과 studio.aliases 불일치로 프런트 응답 거절: 매퍼 양쪽 필드를 일치시킴. Zod 제거 없음.
5. AI HTTP timeout/출력 오류/입력 거절이 모두 미확인으로 표시됨: 구체 코드 구분, 자동 재시도 없음.

6. 파일명용 00/03 기억 키를 그대로 저장하면 화면에서 인물 문서가 제거됨: 원고 result는 보존하고 정본 매퍼에서 DEC-47 숫자 키 0/3으로 변환.

## 실행 결과

| 항목 | HTTP·저장 경로 상태 | 실행 근거 |
|---|---|---|
| 최초 작업 접수 | PASS | 실제 TXT 업로드, 전체 저장 버전/본문 대조, 소유권 거절, 명시적 consent, 동일 요청 receipt, 다른 key 409 |
| AI 추출·정체·구조화 | PASS | 실제 AI 내부 HTTP, 제공사 대역, 4/10화, 완전성 검사, 독립 동명이인·회차 기억·고정 GOAL·첫 등장 검증 |
| WorldStudio 실제 초안 적재 | PASS | 4화 카드 5개/결과 6개/관계 이력 2개, 10화 카드 7개/결과 12개/관계 이력 5개 |
| DB 재조회·중복·장애 복구 | PASS | 2화 timeout → 1화 결과 재사용, 완료 실패 trigger → unknown, 동일 요청으로 모델 재호출 없이 복구, 완료 receipt 재전송 |
| 작가 수정·확정·직접 등록 회귀 | PASS (API) | 기존 초안 PUT·revisions POST/GET, 이전 확정 불변, 직접 등록의 hold/reject/edit/approve/apply 회귀. 브라우저 버튼 동작은 미검증 |

인물 기억 키 호환성 최종 보완 후 매퍼 단위 2개 및 4/10화 실제 HTTP 연결 1개를 재실행해 모두 통과했다. 최신 서버 응답을 프런트 Fixture로 갱신해 어댑터 99개도 통과했다. 전체 서비스 실행 활성화 완료를 의미하지 않는다.

- Content 선택 소스 테스트 96개: 단위 79 + 실제 DB/HTTP 17, 실패/건너뜀 0. 이어 별도 HTTP 2개 재검증 성공. test task는 QA init의 15개 선택 클래스만 사용했다(전체 저장소 테스트 아님).
- AI 43개(단위 41 + 4/10화 HTTP 2): 실패 0. ai-final.xml.
- 프런트 TypeScript: tsc -b --noEmit 종료 코드 0.
- 프런트 HTTP 어댑터 99개: 실패 0. 실제 서버 응답의 별칭·인물 문서·출처 근거·회차 관계를 읽기→작가 편집→저장→재조회한다. frontend-final.xml.
- 기존 V1~V8 migration diff 없음. V9 신규 설치와 기존 분석/검토 보존 테스트 포함.

### HTTP 및 DB 증거

- current-results/qa/connected-build-http-4.json, connected-build-http-10.json: 실제 접수·상태·복구·재조회·확정 요청/응답.
- current-results/qa/connected-build-db-4.json, connected-build-db-10.json: work/world/job/card UUID, PostgreSQL 원본 result 행, Neo4j 끝점/relationId/fromEpisode/ended.
- manuscript-upload-http-4.json 및 -10.json, manuscript-upload-db-4.json 및 -10.json: 업로드 결과와 고정 버전/원문/발행 0건.
- manuscript-epub-http.json 및 manuscript-epub-db.json: 별도 4화 EPUB 업로드/저장 원문 비교.
- direct-http.json/direct-db.json: 직접 등록 경로 검토/초안 반영/확정, PostgreSQL 카드·검토 이력과 Neo4j 관계.
- manuscript-step-db.json: 준비된 UUID의 분산 실패 복구·이후 수정 뒤 receipt 재조회.
- manuscript-draft-episode1.json: 기존 프런트 어댑터로 왕복하는 실제 서버 응답. frontend/src/data/world-studio/http.test.ts에서 source result/evidence·인물 문서·관계 보존을 검사한다.

## 최소성 점검

ponytail-review 기준으로 신규 실행 프레임워크·큐·DB·범용 이벤트 계층은 추가하지 않았다. 기존 Spring 실행기, RestClient, FastAPI, Pydantic, WorldStudio 저장 경로를 사용한다. CodeRabbit CLI는 현재 환경에서 발견되지 않아 실행하지 않았다.

## 한계·미검증

- 관리 화면의 최초 구축 시작/상태/재개 버튼은 #346 연동 범위이며 이번 API 수용 검증과 다르다.
- 실제 브라우저·실로그인 및 새로고침 왕복, 실제 프로세스 종료·재시작은 미검증.
- 원고 기존 카드 자동 식별·병합은 지원하지 않는다. 비어 있지 않은 세계관은 원본을 보존하고 거절한다.
- 실모델 호출/추출 품질 미검증. 자동화는 제공사 대역만 사용했다.
- 20~30화 안정성/성능은 후속, 100화 이상은 이번 범위 제외.
- 커밋·push 금지에 따라 Required CI는 미실행. 선택 테스트 성공을 전체 CI 성공으로 표시하지 않는다.

## 최종 실행 식별자

- 4화: worldId=7f55a1de-b326-4458-8579-e35347ef7784, jobId=6e583889-1f4d-48b5-bedd-a94aa8c432d5, status=completed, 완료 단계=2.
- 10화: worldId=1e1bb485-24d4-45cb-a7fd-7069b8c8b91f, jobId=13e497f4-99f5-4711-8e2d-2e2fb3a786ba, status=completed, 완료 단계=5.

최종 보완 검증: unitTest --tests ai.storyfork.content.world.ManuscriptBuildMapperTest integrationTest --tests ai.storyfork.content.world.InitialBuildHttpIntegrationTest, BUILD SUCCESSFUL (3m 22s).
