# 이미지 비동기 생성 계약 (#332)

2026-11-16 사용자 채택. Content가 작업 기록·인가, AI API가 Celery 접수, 별도 worker가 생성·검증·S3 업로드를 담당한다. RabbitMQ는 기존 인스턴스를 사용한다. 화면은 Content를 3초 간격으로 조회한다.

모델은 `gpt-image-2.6-flare`, 품질은 `high`, 출력 PNG다. character_profile 1024×1024, world_cover/work_cover 1152×1536, illustration 1536×1024. 결과는 실제 디코딩과 5MiB 상한으로 검증한다. 잘못된 결과를 자동 재생성하거나 크롭하지 않는다.

요청 키와 같은 입력은 기존 작업을 반환하고 다른 입력은 409다. 입력·모델·품질·템플릿 v1은 접수 때 고정한다. 자동 생성 재시도는 없고 명시적 재생성은 새 키를 쓴다. 큐는 ID만 전달하고 Content의 원자적 선점으로 중복 실행을 막는다. accepted → queued → running → succeeded. 실패는 failed, 결과 불명확·실행 시한 초과는 interrupted. S3 업로드와 Content 결과 등록까지 끝나야 succeeded다. 실행 시한을 지난 워커의 콜백은 거부한다.

키·회원 토큰·원문·모델 응답은 로그에 남기지 않는다. 내부 상태 API는 기존 /internal/v1/ai/** 인증 체인을 사용한다. 조회·미리보기는 소유자만 가능하다. 생성 성공은 적용·저장·발행 완료와 구분한다. 일러스트 제안은 UC-11에 따라 소유자 삭제 전까지 보관한다.

프롬프트 상세 설계·그림체 프리셋·품질 평가 기준은 이번 결정에 포함되지 않는다. 기본 입력을 그대로 모델에 전달하며 템플릿 버전만 기록한다. 생성 기록 목록·크레딧 차감·자동 fallback은 #332 범위 밖이다.

## 실행·검증

`docker compose up --build`의 image-worker는 AI 서비스와 같은 이미지를 사용하고 `celery -A app.images.worker:app worker --concurrency=1`로 실행한다. local/dev는 기존 RabbitMQ·MinIO를 사용하며 production은 기존 환경의 CORE_RABBITMQ_*와 ATTACHMENT_S3_*를 공급한다. API·worker·Content는 같은 INTERNAL_TOKEN과 버킷을 쓴다. 모델 키는 worker 서버 환경에서만 읽는다.

공개 경로는 `/api/v1/image-generations`, 내부 실행 콜백은 `/internal/v1/ai/image-generations/{id}`다. 전자는 Content 인증·CSRF, 후자는 기존 AI 내부 토큰 체인을 따른다. 모델 timeout 180초, 저장소 연결/읽기 5/30초, 콜백 15초. Content는 30초마다 5분 이상 갱신 없는 작업을 interrupted로 표시한다. 브로커 등록 실패도 자동 재발행하지 않는다. uploaded 결과의 보고 복구는 운영자 확인 후 동일 job의 complete 요청으로 처리하며 이미 interrupted면 새 생성 없이 별도 복구 계약이 필요하다.

현재 화면 연결은 작품 생성·작품 표지 편집·세계관 표지 편집이다. 세 화면은 소유자 인증으로 생성 바이트를 받아 명시적 선택 뒤 기존 파일 저장 흐름에 전달한다. generationId로 대상에 직접 연결하는 API, 인물 프로필의 영속 이미지 필드, 원고의 선택 장면·회차 기반 삽입 UI는 별도 연결이 남는다. 현재 UI 상태는 화면 Hook과 탭 sessionStorage의 사용자별 jobId로 복구한다. 영구 생성 이력 목록·다른 기기의 진행 작업 복구는 제공하지 않는다. 생성 결과 보관·소유자 삭제 API는 네 목적 모두 동일하며 채택한 사본은 기존 저장소 계약으로 보존한다.

실제 유료 모델 호출·DB migration·RabbitMQ·MinIO 통합은 로컬 단위 검증과 구분한다. 단위 테스트는 SDK/저장소 대역을 사용한다.

## 현재 검증 기록

AI 단위 9개, Content 단위 7개(JUnit 직접 실행, JVM 시작 시 Mockito agent 지정), Frontend UseCase 단위 2개 통과. Content 소스·테스트 컴파일 확인. 로컬 Windows의 C 드라이브 공간 부족으로 worktree·의존성을 D 드라이브로 이동했다. Gradle 테스트 executor 메모리·self-attach 문제로 동일 단위 테스트를 작은 단일 JVM에서 실행했다. 전체 TypeScript 검사는 384/512MiB 힙 한도로 완료하지 못했다. HTTP·DB·브로커·스토리지 통합, UI 렌더링 테스트, 실제 모델 생성은 아직 검증하지 않았다. 이 기록은 #332 전체 수용 완료를 뜻하지 않는다.
