> 이 문서는 앞선 단계의 증거를 보존한 기록입니다. 최종 연결 작업의 현재 결과는 [final-connection.md](final-connection.md)를 기준으로 확인하세요.

# 초기 세계관 두 경로 QA — 부분 실행 결과

> 아래는 최초 조사 당시의 보존 기록이다. 이후 Docker/JDK 차단을 해결하고 저장 구조 구현 및 실제 DB/HTTP 검증을 진행했다. 현재 결과는 [구현·QA 진행 기록](implementation-status.md)을 본다.

2026-11-17. **전체 통합 QA 완료 아님. 제품 코드·스키마·공유 DB 변경 없음.**

## 기준과 격리

- develop: `6b4b3e19b04ea533b46e652b866928902faa1d60`
- QA 브랜치: `test/initial-world-two-path-qa`, 해당 develop에서 분리.
- #304 병합 커밋: `dca777a8e4bd82bb1ce57b29d3eda0a9b990596f`.
- #349 병합 커밋: `3f4afece976fc024c8142e17d9611a930013e800`.
- #351: CLOSED, HEAD `c1ecc7404d60c09548c4cbc51562ca7c10717c1f`. 병합 완료로 해석하지 않음.
- #428: OPEN, HEAD `7a7ec7aea6f8bb09dcb32ed772b0b4e0f0610365`, base `feat/344-ai-preprocessing-pipeline`.
- #428 AI 디렉터리는 위 SHA의 git archive로 별도 임시 폴더에 추출했다. 최신 develop에 제품 코드를 통합하지 않았다.
- 기존 worldstudio-stack worktree의 7개 미커밋 정책 변경은 그대로 보존했다. 테스트는 정책 변경 전 #428 원본을 사용한다.

## 결과

| 시나리오 | 상태 | 실제 확인 및 미확인 |
|---|---|---|
| 1. 직접 등록 → 분석 → 승인 → 반영 → 확정 | BLOCKED | 기존 Controller/Service/DB 테스트 소스 존재. Docker 엔진 연결 불가로 QA DB를 만들지 못함. API·실저장 미실행 |
| 2. TXT/EPUB 업로드 → 저장 버전 | BLOCKED | API와 저장 경로 확인. 4회차 TXT/EPUB 준비. Content 테스트는 JVM loopback 오류로 시작 실패. 실제 업로드·버전 ID 미확인 |
| 2. #428 추출 → 통합 → Payload | PASS | 제공사 대역, 실제 세 함수 실행. 카드 5개, 관계 시작/종료 기록 2개, 참조 key 유효, 입력 순서 반전에도 동일 Payload |
| 2. 원고에서 WorldStudio 실제 적재 | BLOCKED | 최신 develop에 preprocessing_episode_read/progress/load 도구 없음. 매핑·예약·receipt도 구현됐다고 가정하지 않음 |
| 3. 기존 직접 등록 카드와 원고 결과 결합 | BLOCKED | #428은 기존 WorldStudio UUID를 입력받지 않음. 기존 카드 식별·충돌 검토·중복 방지 연결이 없음 |
| 4. 1~100 짧은 합성 회차 분석 | PASS | 메모리상의 100개 입력, 100개 카드, 정렬 독립성, 기존 정체 결과에서 한 회차 누락 시 거절. 저장된 Job Manifest 검증은 아님 |
| 4. 1~100 저장 후 101화 작성 | NOT TESTED | EpisodeService.create가 마지막 번호+1을 사용하므로 코드상 가능. 실제 API/DB 실행 전 |
| 4. 과거 회차 없이 101화로 시작 | BLOCKED | CreateEpisodeRequest는 title만 받음. create는 last+1, import도 앞 회차 없는 번호를 거절. 별도 기능 필요 |
| 4. 비공개·확정·근거 DB 추적 | NOT TESTED | 실제 적재 연결 및 QA DB 부재 |

PASS는 해당 좁은 대역 검증만 의미한다. API/DB 전체 흐름이 PASS인 시나리오는 없다. 확인된 제품 실행 실패(FAIL)는 없으며 환경 차단과 미구현을 구분했다.

## 실행 증거

- #428 원본 `tests/preprocessing`: **46 passed, 1 deselected**. integration 제외, 유료 모델 호출 없음.
- [probe.py](probe.py): provider 함수를 대역으로 바꿔 실제 service를 실행. `evidence/results.json`, 추출 원문/해시/근거, 정체 통합 결과, LoadPayload를 출력한다.
- [결과](evidence/results.json), [추출](evidence/four-extractions.json), [정체](evidence/four-identity.json), [적재 Payload](evidence/four-load-payload.json), [100회차 원문](evidence/hundred-sources.json), [100회차 해시](evidence/hundred-source-hashes.json).
- TXT 4개와 EPUB 1개는 **업로드 대기 Fixture**다. EPUB의 실제 서버 파서 호환성도 미검증이다.
- Docker: `dockerDesktopLinuxEngine` named pipe 부재. 엔진에 연결되지 않았다.
- Content 선택 단위 테스트: `java.io.IOException: Unable to establish loopback connection`, 테스트 실행 전 Gradle 실패.
- 따라서 실제 API 요청·응답, WorldStudio/카드/관계 UUID, 저장 버전 ID, PostgreSQL 행, Neo4j 조회 결과는 **없다**. 대역 key나 hash를 DB 저장 증거로 사용하지 않는다.
- Required CI는 이번 QA 브랜치에서 실행하지 않았다. 기존 PR의 CI 성공을 이번 결과로 전용하지 않았다.

재현: 격리한 #428 AI 환경의 Python으로 다음을 실행한다. DB 환경변수나 API key는 필요하지 않다.

```text
python probe.py --ai-root <428-checkout>/backend/ai-service --output <qa-output>
```

## 저장 모델·승인·출처 경계

직접 등록은 WorldStudio world/world_draft, setting_card/setting_card_draft, setting_card_version/world_revision 및 초기 분석·검토·반영 기록을 사용한다. 분석 후보 승인과 초안 반영, 확정은 별도 Controller 호출이다. 관계는 기존 카드 UUID를 끝점으로 하는 DEC-51 저장 경로다.

원고 경로도 같은 정본을 사용하는 것이 목표지만 #428은 작업 내 key만 생성한다. Content가 job/world/key별 UUID 예약과 DEC-51 관계 시작·종료 매핑을 수행해야 한다. 이름이 같다는 이유로 기존 UUID와 연결하면 안 된다. 지금 생성한 Payload에는 실제 저장 UUID가 없고, 기존 사용자 카드와 동일성 검증을 수행하지 않았다.

첫 등장 정책은 사용자 승인대로 `firstAppearanceEpisode`를 출처 메타데이터에 보존하고 독자 공개용 `revealFromEpisode`는 쓰지 않으며 visibility=private를 유지해야 한다. **#428 원본 출력은 아직 옛 이름 revealFromEpisode를 사용한다.** evidence는 원본 그대로 남겼고 이를 공개 승인으로 해석하지 않는다. 별도 보존한 로컬 정책 변경과 Content 소비자 계약을 함께 반영해야 한다. 기존 작가 공개 설정은 변경 대상이 아니다.

직접 입력 경로의 후보별 승인 기록을 원고 전처리의 시작 승인 기록으로 대체하지 않는다. 원고 결과가 승인 후보 이력을 가진 것처럼 initial_application을 재사용하지 않는다.

## 현재 기능 분류

1. **구현 존재 / 실행 확인 구분:** 직접 등록·초기 후보 검토/반영·확정 API와 TXT/EPUB 저장은 develop에 존재하지만 이번 실저장은 미검증. 실제 실행 PASS는 #428 대역 의미 로직뿐이다.
2. **연결 가능한 부분:** 저장된 원고 버전 조회, 검증된 Payload를 기존 카드·인물 문서 형식으로 매핑, 기존 WorldStudio 부분 추가/DEC-51 저장 호출. 단순 함수 연결만으로 안전한 적재 완료가 되지는 않는다.
3. **저장 계약 확장 필요:** 고정된 최초 작업 manifest, 성공 추출·통합 결과 영속화, key→UUID 예약, 단계별 복구/receipt, 근거→결과 카드 추적. 새 DB 도입을 뜻하지 않으며 스키마는 여기서 결정하지 않는다.
4. **신규 구현 필요:** #345 Content 작업/MCP, 기존 직접 등록 카드와 원고 엔터티를 연결하는 식별·충돌 검토, 과거 회차 없는 시작 번호 지원(요구 확정 시). 신규 회차 자동 증분/Fork 동기화는 제외.

## 다음 QA 재개 조건

- QA 전용 PostgreSQL·Neo4j와 실행 가능한 Content 테스트 JVM/격리 CI 준비. 기존 develop DB 연결 금지.
- 테스트 1은 기존 분석 HTTP 제공사 대역과 실제 저장·검토·반영·확정 API를 연결해 요청/응답 및 양 DB 증거 수집.
- 테스트 2는 `/api/v1/works/{id}/manuscript-imports` 또는 `/bulk` 업로드 후 실제 반환 버전 ID와 저장 본문을 대조. `/bulk`는 파일 20개 한도이므로 100개 파일을 한 번에 보내지 않는다.
- TXT는 CRLF/CR→LF 정규화, EPUB은 마크업/공백 처리 후 본문 추출을 수행한다. 파일 바이트 해시와 저장 본문 해시를 별도로 기록하고, AI 근거는 **저장 본문** 기준으로 검증한다.
- #345 연결 전까지 실제 원고 적재·중복 복구·기존 카드 결합을 BLOCKED로 유지한다.
- 100화 검증은 짧은 인물 하나씩의 합성 입력이다. 실제 장편 분량/문맥 크기, 동명이인 100화 정체 품질, 비용/속도, 실모델 성능을 증명하지 않는다.

제품 수정·PR 병합·배포·DB 초기화·자동 전처리 활성화·실모델 호출은 수행하지 않았다.
