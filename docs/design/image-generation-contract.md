# 이미지 비동기 생성 계약 (#332)

2026-11-16 사용자 채택. Content가 작업 기록·인가, AI API가 Celery 접수, 별도 worker가 생성·검증·S3 업로드를 담당한다. RabbitMQ는 기존 인스턴스를 사용한다. 화면은 Content를 3초 간격으로 조회한다.

모델은 `gpt-image-2.6-flare`, 품질은 `high`, 출력 PNG다. character_profile 1024×1024, world_cover/work_cover 1152×1536, illustration 1536×1024. 결과는 실제 디코딩과 5MiB 상한으로 검증한다. 잘못된 결과를 자동 재생성하거나 크롭하지 않는다.

이미지 작업 테이블은 Content의 전역 마이그레이션 `proposal/V44__image_generation_job.sql`에서 생성한다. `develop`의 `plan/V38`을 보존하기 위해 작업 브랜치에서 썼던 이미지 V38을 V44로 옮겼다. 예전 이미지 V38이 적용된 개인 검증 DB는 별도로 보존하고 병합된 코드의 검증은 새 DB에서 실행한다.

요청 키와 같은 입력은 기존 작업을 반환하고 다른 입력은 409다. 입력·모델·품질·템플릿 버전은 접수 때 고정한다. 자동 생성 재시도는 없고 명시적 재생성은 새 키를 쓴다. 큐는 ID만 전달하고 Content의 원자적 선점으로 중복 실행을 막는다. accepted → queued → running → succeeded. 실패는 failed, 결과 불명확·실행 시한 초과는 interrupted. S3 업로드와 Content 결과 등록까지 끝나야 succeeded다. 실행 시한을 지난 워커의 콜백은 거부한다.

키·회원 토큰·원문·모델 응답은 로그에 남기지 않는다. 내부 상태 API는 기존 /internal/v1/ai/** 인증 체인을 사용한다. 조회·미리보기는 소유자만 가능하다. 생성 성공은 적용·저장·발행 완료와 구분한다. 일러스트 제안은 UC-11에 따라 소유자 삭제 전까지 보관한다.

후속 사용자 채택으로 작품·세계관 표지는 고정 시각 설정과 이번 장면을 분리하고 `cover-v2` 템플릿으로 조립한다. 인물 프로필·삽화와 기존 v1 작업은 원문 전달을 유지한다. 그림체 프리셋 관리·품질 평가 기준·생성 기록 목록·크레딧 차감·자동 fallback은 이번 변경 범위 밖이다.

후속 요청의 [이미지 일관성 적용안과 프롬프트 예시](image-consistency-proposal.md) 중 작품·세계관 표지의 템플릿과 참조 이미지 편집을 채택했다. 합성과 시각 품질 검사는 별도 제안이다.

## 생성 결과 안전 검사

이미지 워커는 Flare 결과의 PNG 규격과 용량을 확인한 뒤, 동일한 이미지 바이트를 `omni-moderation-latest`의 이미지 입력으로 검사한다. 이미지 판정을 통과하면 로컬 Tesseract(`eng+kor`)로 문구를 읽고, 문구가 있으면 같은 검사 모델에 텍스트로 별도 요청한다. 두 검사 모두 해당 입력에 적용된 `sexual` 판정이 명시적으로 `false`여야 `uploading`으로 진행한다. 글자가 없는 경우에는 이미지 판정만 적용한다. OCR과 각각의 검사 요청은 10초 타임아웃을 사용하며 자동 재시도는 하지 않는다. Flare의 제공자 필터는 기본 설정을 유지한다.

| 판정 | Content 응답과 저장 |
|---|---|
| 통과 | 기존 저장 경로로 올리고 완료 후 `succeeded` 및 소유자 미리보기를 제공 |
| 성적 콘텐츠 감지 | `failed` / `output_blocked`. 결과 파일 없이 콘텐츠 기준 안내 표시 |
| OCR·검사 오류 또는 판정 누락 | `failed` / `moderation_unavailable`. 결과 파일 없이 검사 실패 안내 표시 |

두 실패 단계에서 저장·완료 콜백을 호출하지 않는다. 기존 실패 처리에서 임시 참조 사본을 정리하며, 상태 재조회는 모델을 다시 호출하지 않는다. 판정 점수, 이미지 데이터, OCR 문구, 제공자 응답 본문은 상태와 로그에 저장하지 않는다. 이 검사는 `sexual` 항목을 대상으로 하며 작은 글자나 장식 서체처럼 OCR이 읽기 어려운 문구는 놓칠 수 있다. Docker 이미지에는 OCR 실행 파일과 언어 데이터가 포함된다. 워커를 직접 실행하는 환경은 `tesseract`를 `PATH`에 두고 `tesseract --list-langs`에 `eng`와 `kor`가 모두 표시되어야 한다.

## 표지 참조 이미지 (2026-11-19 사용자 채택)

작품 생성·작품 표지 편집·세계관 표지 편집의 AI 생성창은 내장 원화 `landscape-v1`(해 질 녘 산길)을 기본 참조로 선택한다. 사용자는 `내 이미지 참고`에서 현재 저장된 표지 또는 PNG·JPEG·WebP 파일 한 장(최대 5 MiB)을 선택한다. 현재 표지가 없으면 새 이미지 업로드를 사용한다. 사용자 참조의 목적은 그림체·색감 또는 인물·장소 외형이다. 업로드는 생성 접수 시 이루어지며, 결과를 명시적으로 선택해 저장하면 최종 표지가 바뀐다.

기본 원화는 버전으로 조회하고 교체할 때 새 버전을 추가한다. 화면과 워커는 Content에 내장된 같은 원화 바이트를 사용한다. 공개 조회 범위는 서비스에서 등록한 기본 원화다.

- 기본 원화·현재 표지에는 기존 JSON 접수로 `reference`를 전달한다. 새 파일은 `POST /api/v1/image-generations/with-reference`의 JSON `request` 파트와 바이너리 `file` 파트로 함께 접수한다. 사용자 파일을 선택하기만 했을 때는 업로드하지 않는다.
- Content는 기존 대상·표지 소유권을 확인하고 참조 모드·목적·버전·실제 바이트 해시를 접수 시 고정한다. 사용자 파일과 현재 표지 사본은 작업 전용 비공개 객체로 큐 등록 전에 저장한다. 동일 키와 동일 요청은 기존 작업을 반환하며, 모드·목적·버전 또는 업로드 파일이 달라지면 409다. 현재 표지를 갈아 끼워도 이미 접수한 작업은 기존 사본을 사용한다.
- 새 참조 작업은 `cover-v3`에서 기존 고정 설정·장면과 참고 역할을 조립한다. 워커는 작업을 선점한 후 내부 토큰과 작업 ID로 참조 바이트를 읽고 실제 디코딩한 뒤 Flare `images.edit`로 전송한다. 참조 필드가 없는 기존 호출과 접수된 v1·cover-v2 작업은 기존 `images.generate`를 사용한다. 결과 규격·검사·상태 조회·저장은 기존 계약대로 동작한다.
- 완료·실패·중단 후 사용자 참조 사본을 정리하고, 저장소 삭제가 실패하면 운영 로그에 작업 ID를 남긴다. 작업을 삭제할 때 다시 정리할 수 있다. 로그에 파일 바이트·원문·키를 싣지 않는다. 워커와 Content를 갱신한 뒤 웹을 갱신해야 신규 화면의 참조 작업을 처리할 수 있다.

원화는 Codex 내장 이미지 생성으로 제작한 3:4 수채 과슈풍 산길 풍경이다. 남청색 산과 청록색 안개, 낮은 황금빛을 사용하고 인물·특정 랜드마크·문구는 배제했다. 참조로 새 장면을 그릴 때 외형이 완전히 같아지는 보장은 없으며, 픽셀 단위 일치가 필요한 요소는 승인 원화 합성이 별도 제안으로 남아 있다.

<details>
<summary>기본 원화 생성 프롬프트</summary>

> Create ONE polished vertical 3:4 editorial illustration used as a general-purpose style reference for Korean storytelling web app cover generation, not as a final book cover. Depict a quiet broad landscape at blue hour with layers of soft indigo hills, dusty teal mist, warm muted amber light in a break in the clouds, understated textured stone and grasses along a foreground path. Painterly digital gouache, gentle brush grain, atmospheric depth and natural lighting, restrained rich palette. Simple skies in upper fifth, balanced midtones, no strong iconic landmark, no figures, no distinctive prop. No typography, lettering, frame, border, panels, logos or watermark. Full-bleed. Portrait 3:4 aspect ratio.

</details>

## 표지 프롬프트 입력 분리 (2026-11-16 사용자 채택)

작품 생성·작품 표지 편집·세계관 표지 편집의 공용 생성창에 `고정 시각 설정 (선택)`과 `이번 장면`을 둔다. `visualSettings`는 최대 6,000자, 기존 `prompt`는 필수 장면 설명으로 최대 12,000자다. 그림체·색감·반복 인물 외형·랜드마크 등 유지할 사항을 전자에, 장소·행동·시간·감정을 후자에 입력한다. 세계관의 비공개 설정 카드를 자동으로 조회하거나 모델에 추가하지 않는다.

Content는 두 입력을 기존 작업 JSON에 분리 저장하고 새 작품/세계관 표지 작업의 `template_version`을 `cover-v2`로 고정한다. 고정 설정도 요청 해시에 포함되므로 같은 키에서 설정만 바꾸면 409다. 빈 새 필드는 저장 JSON에서 생략해 기존 v1 요청의 해시를 유지한다. 기존 작업의 버전·상태를 일괄 변경하지 않으며 스키마 변경도 없다. 표지가 아닌 요청에 고정 설정을 보내면 거절한다.

AI worker는 접수 스냅샷의 버전에 따라 `app/images/prompt.py`에서 공통 원칙·용도별 세로 3:4 구도·고정 설정·장면을 조립한다. 두 자유 입력은 JSON 문자열로 구분한다. 고정 설정과 장면이 충돌하면 고정 설정을 우선하도록 지시하지만 의미 충돌의 자동 탐지나 강제 보장은 구현하지 않는다. 빈 고정 설정에는 특정 장르·그림체를 임의로 넣지 않는다. v1은 기존 프롬프트를 그대로 전달하며, 이후 템플릿 문안을 바꿀 때는 새 버전을 도입해 기존 접수 작업의 의미를 보존한다.

화면 입력은 해당 대상의 생성창이 마운트된 동안 유지해 장면만 바꾸어 새 생성할 수 있다. 대상이 바뀌면 두 입력을 비운다. 입력의 영구 프리셋 저장·세계관 간 공유·새로고침 뒤 입력 자동 복구는 제공하지 않는다. 기존 jobId 기반 상태 복구와 결과의 명시적 선택·표지 저장은 유지한다. 정확한 얼굴·구조·상단 20% 여백은 텍스트 지시만으로 보장하지 않는다. 모델·high·1152×1536 PNG·5MiB 검사·180초 timeout·자동 재시도 없음은 그대로다.

## 실행·검증

`docker compose up --build`의 image-worker는 AI 서비스와 같은 이미지를 사용하고 `celery -A app.images.worker:app worker --concurrency=1`로 실행한다. local/dev는 기존 RabbitMQ·MinIO를 사용하며 production은 기존 환경의 CORE_RABBITMQ_*와 ATTACHMENT_S3_*를 공급한다. API·worker·Content는 같은 INTERNAL_TOKEN과 버킷을 쓴다. 모델 키는 worker 서버 환경에서만 읽는다.

공개 경로는 `/api/v1/image-generations`, 내부 실행 콜백은 `/internal/v1/ai/image-generations/{id}`다. 전자는 Content 인증·CSRF, 후자는 기존 AI 내부 토큰 체인을 따른다. 모델 timeout 180초, 저장소 연결/읽기 5/30초, 콜백 15초. Content는 30초마다 5분 이상 갱신 없는 작업을 interrupted로 표시한다. 브로커 등록 실패도 자동 재발행하지 않는다. uploaded 결과의 보고 복구는 운영자 확인 후 동일 job의 complete 요청으로 처리하며 이미 interrupted면 새 생성 없이 별도 복구 계약이 필요하다.

현재 화면 연결은 작품 생성·작품 표지 편집·세계관 표지 편집이다. 세 화면은 소유자 인증으로 생성 바이트를 받아 명시적 선택 뒤 기존 파일 저장 흐름에 전달한다. generationId로 대상에 직접 연결하는 API, 인물 프로필의 영속 이미지 필드, 원고의 선택 장면·회차 기반 삽입 UI는 별도 연결이 남는다. 현재 UI 상태는 화면 Hook과 탭 sessionStorage의 사용자별 jobId로 복구한다. 영구 생성 이력 목록·다른 기기의 진행 작업 복구는 제공하지 않는다. 생성 결과 보관·소유자 삭제 API는 네 목적 모두 동일하며 채택한 사본은 기존 저장소 계약으로 보존한다.

실제 유료 모델 호출·DB migration·RabbitMQ·MinIO 통합은 로컬 단위 검증과 구분한다. 단위 테스트는 SDK/저장소 대역을 사용한다.

## 현재 검증 기록

### 기본·사용자 참조 이미지 실검증 (2026-11-19)

AI 이미지 29개, Content 이미지 14개, 프런트 이미지·공용 스타일 27개 등 관련 테스트 70개, TypeScript 검사, AI·Content·웹 Docker 빌드를 통과했다. CodeRabbit 구현 리뷰는 지적 0개였다.

D:의 격리된 Linux Compose에서 기본 원화의 썸네일 바이트가 서버 등록본과 일치했다. 현재 표지 변경 뒤에도 접수한 참조 사본을 내부 워커 경로에서 읽을 수 있었고, 내부 토큰 없이 접근하면 거절됐다. 같은 키·파일의 중복 접수는 기존 작업을 반환했으며, 다른 파일은 409, 누락되거나 잘못된 파일은 422였다.

기존 API 키로 Flare `images.edit`를 2회 호출했다. 업로드 참조를 사용한 세계관 표지는 워커 실행 약 13.06초에 성공했다. 결과는 1152×1536 PNG, 2,895,906 bytes이며 기존 표지 저장 API로 저장한 바이트가 생성 결과와 일치했다. 기본 참조를 사용한 작품 표지는 HTTP 200 뒤 응답 본문 수신이 시간 제한을 넘어 약 204.58초에 `interrupted`가 됐다. 작품 표지의 이번 실호출 생성 완료·저장은 확인하지 못했다. 자동 모델 재호출은 없었다.

검증 작업의 사용자 참조 사본이 객체 저장소에서 정리됐고, 테스트 컨테이너 구성과 로그에 제공된 키 값이 없음을 확인했다. 결과는 로컬 `D:/Codex/image-live-verification/cover-reference-v3/`의 `result.json`, `audit.json`에 보관한다.

### 표지 템플릿 입력 분리 (2026-11-18)

작품·세계관 표지의 고정 시각 설정/장면 입력과 `cover-v2` 조립을 검증했다. 변경 단위 테스트는 AI 이미지 26개, Content 이미지 13개, Frontend 이미지 9개가 통과했고 TypeScript `--noEmit`과 AI·Content·Web Docker 빌드도 통과했다. CodeRabbit 변경분 리뷰는 지적 0개였다.

D:의 격리된 Linux Compose에서 실제 화면으로 접수한 입력이 `visualSettings`와 `prompt`에 각각 원문 그대로 저장되는 것을 확인했다. 같은 키·같은 입력은 기존 작업을 반환했고, 고정 설정만 바꾼 동일 키는 409, 6,001자 설정은 422였다. 기존 v1 작업의 원문 전달과 빈 새 필드의 요청 해시 호환성은 단위 테스트로 확인했다. 키는 worker 프로세스에만 주입했으며 컨테이너 설정·변경 파일·검증 로그에 키 값이 없는지 검사했다.

기존 키를 사용한 실제 모델 요청은 이번 검증에서 **3회**였다. 세계관 1회는 성공했고 작품 2회는 응답 수신 timeout으로 `interrupted`가 됐다. 작품 재요청은 화면의 생성 버튼으로 새 키를 만든 명시적 요청이며 자동 재시도는 없다.

| 실제 화면 요청 | 결과 | 확인 내용 |
|---|---|---|
| 세계관 표지 | 성공 | worker 약 13.07초(큐 대기 포함 접수→완료 약 138.31초), PNG 1152×1536, 2,733,531 bytes. 미리보기→명시적 선택→저장→새로고침 유지 확인. 저장 바이트가 생성 원본과 같고 공개 경로는 404였다. |
| 작품 표지 최초 | 중단 | 약 182.76초, DNS·TCP·TLS·요청 본문 전송 뒤 응답 헤더 대기에서 ReadTimeout. |
| 작품 표지 명시적 재요청 | 중단 | worker 약 192.24초, HTTP 200 헤더 뒤 이미지 본문 수신에서 ReadTimeout. 화면은 오류로 전환하고 입력을 유지했다. |

11개 테스트 컨테이너는 실행 중이었고 OOM은 없었다. 위 기록만으로 제공자와 네트워크 중 어느 쪽이 지연 원인인지 단정하지 않는다. **이번 템플릿의 작품 표지 생성 성공·선택·저장 검증은 미완료**다. HTTP 200이나 Celery 태스크 정상 반환만으로 이미지 생성 성공이라 판단하지 않고 Content의 작업 상태와 실제 이미지 바이트를 확인한다. 기존 180초 SDK timeout은 네트워크 읽기 단계에도 적용되어 전체 경과 시간이 180초를 넘을 수 있다. timeout·모델·품질을 임의 변경하지 않았다.

검증 원본은 로컬 `D:/Codex/image-live-verification/cover-template-v2/`의 `result.json`, `jobs.json`, `worker-*.log`, `world-saved.jpg`, `work-timeout.jpg`에 보관한다. 정확한 과금액은 제공자 사용량 내역으로 별도 확인해야 한다.

이 검증은 표지 입력 분리의 기능 검증이며, 앞선 30분 부하 검증을 새로 수행한 것은 아니다. 영구 프리셋·참조 이미지 편집·이미지 간 동일성 보장은 포함하지 않는다.

### 기존 비동기 생성 검증

AI 단위 14개, Content 관련 단위 14개(이미지 10개·공통/세계관 오류 처리 4개, Gradle `unitTest`, 로컬 JVM에 Mockito agent 지정), Frontend UseCase 단위 2개 통과. Core·Content 최신 소스 빌드, 전체 TypeScript `--noEmit`, 변경 TypeScript 14개 파일의 문법 검사도 통과했다. CodeRabbit 리뷰의 내부 DTO 검증·중복 호출 테스트·화면 전환·재생성 미리보기 경합 지적을 반영했다.

2026-11-16 사용자 요청으로 실제 OpenAI 호출과 기능 검증을 수행했다. 키는 worker/검증 프로세스 환경에만 주입했으며 저장소·로그·브라우저에 기록하지 않았다. 실제 생성 요청은 총 6회(규격별 직접 호출 3회, 비동기 경로 3회)이며 자동 모델 재시도는 없었다. 비동기 첫 실행은 생성 후 S3 업로드 코드의 오류로 실패했고, 수정 뒤 API와 브라우저 흐름에서 각각 성공했다. 정확한 과금액은 사용량 청구 내역으로 별도 확인해야 한다.

| 규격별 실호출 | 결과 | 경과 시간 | PNG 크기 |
|---|---|---|---|
| character_profile 1024×1024 | 성공 | 16.64초 | 1,755,612 bytes |
| work_cover 1152×1536 | 성공 | 18.23초 | 2,747,756 bytes |
| illustration 1536×1024 | 성공 | 11.84초 | 2,892,095 bytes |

격리한 PostgreSQL 18·RabbitMQ 4.1·MinIO와 실제 Core·Content·AI API·Celery worker를 연결해 다음을 확인했다. Docker/WSL 기동 오류 때문에 Windows 네이티브 서비스와 Celery `solo` pool을 사용했으며 production 실행 설정은 변경하지 않았다.

- 로그인·CSRF → 202 접수 → queued/running/succeeded → 비공개 PNG 조회. 최종 API 검증에서 접수 0.156초, worker 기동·폴링을 포함한 완료 확인 22.188초, 생성 이미지 2,616,446 bytes.
- 같은 요청 키 재사용 시 동일 job, 입력 변경 시 409, 잘못된 목적 422, 미인증 조회 401, 완료 작업의 중복 선점 거절, 요청 키로 결과 재조회.
- 실제 작품 생성·표지 업로드·다운로드의 바이트 일치. 생성 결과 삭제 후 404·같은 키 재접수 410, 이미 채택한 작품 표지는 유지.
- Chrome에서 실제 생성 버튼 클릭, worker를 잠시 멈춘 상태에서 페이지 새로고침 후 같은 대기 작업 복구, worker 재개 후 미리보기·명시적 선택·비공개 작품과 표지 저장. 저장된 표지가 생성 결과와 같은 1152×1536 PNG임을 API로도 확인했다.

실검증에서 발견한 공통 예외 처리 대상 누락(409/404 등이 500으로 변환됨)과 boto3 클라이언트 context manager 오용(업로드 전 TypeError)을 수정했다. 오류 처리 대상·상태 코드, 실제 SDK 클라이언트의 성공/실패 시 close를 검증하는 회귀 단위 테스트를 먼저 실패시킨 뒤 통과시켰다.

세계관 표지는 아래 후속 화면 검증에서 확인했다. Linux Docker의 prefork worker와 제한된 동시 부하는 아래 후속 검증에서 확인했다. 인물 프로필 저장 UI, 원고 삽화 삽입 UI는 실검증에 포함하지 않았다. 프로필·삽화는 모델 실호출과 규격 검증까지다. 이 기록은 #332 전체 수용 완료를 뜻하지 않는다.

### 세계관 표지 화면 검증 (2026-11-16)

격리 환경에 프로젝트와 같은 Neo4j Community 5.26.0을 연결하고 Chrome에서 비공개 테스트 세계관을 만들었다. 세계관 정보 편집 → AI로 생성 → 장면 설명 → 생성 요청 → 미리보기 → 이 이미지 선택 → 저장 → 새로고침까지 실제 화면에서 통과했다. 새로고침 후에도 저장한 표지가 표시됐다. 세계관 설정 버전 저장은 표지 저장과 별개이며 공개 발행은 수행하지 않았다.

- 기존 키로 `world_cover`, `gpt-image-2.6-flare`, `high`를 실제 호출했다. 추가 유료 생성 1회, 누적 7회이며 재시도 없이 성공했다.
- 접수부터 완료 등록까지 28.73초, PNG 1152×1536, 3,772,980 bytes로 5MiB 이하를 확인했다.
- 인증 API로 조회한 세계관 표지와 생성 원본의 바이트가 일치했다. 표지 응답은 `private, no-store`, 비공개 세계관의 공개 표지 경로는 404였다.
- 테스트 세계관 `7052b462-6c76-42a4-baaf-e38ea968b978`, 생성 작업 `b55bcd5a-32bd-48c9-846f-559b967cddc0`. 이미지 SHA-256: `b5acdc471e710f96d3da1db9288ff8b5d474da8fd0e725eae1d9459a3b7cc4e3`.
- 이번 검증에서 새 기능 오류는 발견하지 않았고 제품 코드는 변경하지 않았다. 키는 worker 실행 환경에만 주입했다. Windows 네이티브 서비스·Celery solo pool 검증이며 Linux/Docker 검증을 대체하지 않는다.

## 후속 코드 리뷰 (2026-11-16)

ponytail 기준의 직접 점검과 CodeRabbit의 develop 기준 전체 52개 파일 리뷰를 수행했다. 직접 재현한 두 오류는 다음과 같이 수정했다.

- 만료 후보 조회와 잠금 후 상태 확인의 트랜잭션을 분리했다. 동일 영속성 문맥의 오래된 엔티티가 먼저 완료된 작업을 interrupted로 덮어쓰는 문제를 실제 Hibernate·H2 트랜잭션으로 재현하고, 완료 상태 보존과 실제 만료 작업 중단을 확인했다.
- 브라우저에 저장한 작업이 삭제돼 404가 오면 저장된 jobId와 대기 상태를 비워 새 생성을 허용한다. 통신 오류·503은 삭제로 취급하지 않고 작업 기록을 보존한다. 결과 없음 판정은 HTTP Repository가 맡고 화면 Hook은 업무 계약의 null을 처리한다.

CodeRabbit의 경미한 지적 1건인 모델 실행 추적 누락도 보완했다. 기존 `app/tracing.py`의 `observe`를 사용해 모델·품질·규격·용도·템플릿 버전·사용량·안전한 실패 유형만 기록하며 worker에 기존 LANGFUSE_* 환경 변수를 전달한다. 프롬프트·이미지/base64·키·제공사 예외 본문은 기록하지 않는다. Langfuse 키가 없으면 기존 규칙대로 추적을 끈다. 외부 Langfuse 전송 검증은 수행하지 않았고 테스트에서는 메모리 exporter만 사용했다.

후속 검증: AI 이미지·추적 단위 18개, Content 이미지 단위 10개와 만료 동시성 통합 1개, Frontend 이미지 단위·Hook 6개와 전체 TypeScript 검사 통과. 각 오류/누락 테스트의 실패를 먼저 확인한 뒤 수정했다. 변경 13개 파일의 CodeRabbit 재검토에서 새 지적은 없었다. 새 유료 모델 호출이나 새 의존성은 추가하지 않았다.

## Linux Docker·동시 요청 검증 (2026-11-16)

사용자 요청으로 WSL2 Ubuntu 26.04의 독립 Docker Engine 29.9.3에서 검증했다. Docker Desktop은 디스크 부족으로 기동이 불안정해 D:의 테스트 전용 ext4 저장소와 별도 daemon을 사용했다. WSL의 서비스만으로 배포판 수명이 유지되지 않는 문제는 테스트용 실행 세션으로 해결했다. 준비 중 중단된 다운로드의 불완전한 RabbitMQ 이미지는 같은 공식 버전을 다시 받아 확인했다. 이 준비 과정에는 유료 모델 호출이 없었다.

AI의 실제 Dockerfile과 고정 uv.lock으로 Linux 이미지를 빌드했다. Core·Content Dockerfile은 Gradle 메모리·병렬도만 낮춰 같은 소스를 빌드했고, MinIO도 프로젝트 고정 소스 버전을 빌드 병렬도만 낮춰 사용했다. PostgreSQL 17.12, RabbitMQ 4.1.0, Neo4j 5.26.0, MinIO, Core, Content, AI API, worker를 모두 Linux 컨테이너로 실행했다. 애플리케이션 네 컨테이너는 Dockerfile의 비루트 `storyfork` 사용자다.

실행은 테스트용 host network와 루프백 주소를 사용했다. 실제 Compose 설정의 병합·검증과 worker 명령 일치를 확인했지만 기본 Compose bridge/DNS·nginx를 포함한 전체 배포 검증은 아니다. worker는 배포 설정과 같은 `--concurrency=1` 및 Linux 기본 `prefork` pool을 사용했다. 로그 검증용 INFO 수준만 별도로 지정했다. API 키는 worker exec의 표준입력으로 전달한 뒤 프로세스 환경에만 주입했고 Docker 컨테이너 설정·로그·검증 산출물에 저장하지 않았다.

| 검증 | 결과 |
|---|---|
| 같은 요청 키로 20개 동시 POST | 모두 202, 작업 ID·DB 작업은 하나, p95 약 984ms / 최대 약 1,000ms |
| 같은 키로 입력 변경 | 409 |
| 서로 다른 실제 작업 3개 | 작품 표지 2개·세계관 표지 1개, 모두 queued → running → succeeded |
| 생성 중 동시 조회 | 최대 20개 요청 병렬, 총 900건, HTTP 오류 0건, p50 약 188ms / p95 약 531ms / 최대 약 734ms |
| RabbitMQ 중복 메시지 10개 추가 | 총 13개 메시지 처리, 실제 OpenAI POST 성공은 정확히 3회 |
| 완료 작업의 동시 선점 20개 | 모두 claimed=false, 재생성 없음 |
| 이미지 실제 디코딩 | 3개 모두 1152×1536 PNG, 각각 2,584,811 / 3,591,580 / 3,285,697 bytes, 5MiB 이하 |
| 종료 상태 | 이미지 큐 ready/unacknowledged 모두 0, 실행 중 컨테이너 OOM·재시작 0 |

실제 모델은 `gpt-image-2.6-flare`, `high`였으며 이번 추가 호출 3회, 앞선 검증을 포함한 누적 10회다. worker 시작부터 세 작업 완료 확인까지 54.14초였고 관찰된 동시 실행은 1개다. 첫 검증 스크립트는 앞선 요청에서 갱신된 CSRF 쿠키를 재사용해 403을 받았으며, 실제 클라이언트처럼 각 요청 세션의 새 토큰을 사용하도록 검증 도구만 수정했다. 해당 시도에는 생성 작업·모델 호출이 없었다.

제품 코드는 변경하지 않았다. 이 결과는 제한된 로컬 동시 부하의 기능 검증이며 운영 최대 처리량·장시간 부하·다중 worker 수평 확장·기본 Compose 네트워크 검증을 대신하지 않는다. 컨테이너와 테스트 daemon은 검증 후 종료한다.

## 기본 Compose 네트워크·30분 부하·worker 확장 검증 (2026-11-16)

**전체 판정은 미통과다.** 기본 네트워크·조회 부하·중복 억제·worker 확장은 동작했지만, 후반 실제 생성 3건 중 2건이 모델 연결/시간 초과 예외 경로로 interrupted가 됐다. 이를 HTTP 조회 성공이나 Celery task 처리 성공과 혼동하지 않는다.

사용자가 선택한 30분, 실제 생성 시도 최대 6회 범위로 실행했다. 같은 독립 Linux Docker Engine에서 저장소의 `docker-compose.yaml`과 `docker-compose.local.yaml`을 병합하고 테스트 전용 포트·메모리 제한·로컬 빌드 이미지 override를 사용했다. Frontend와 Operations도 실제 Dockerfile로 빌드했다. 11개 서비스가 Compose 기본 bridge `sf-image-compose_default`를 사용하며, Core·Content·RabbitMQ·MinIO·PostgreSQL·Neo4j의 서비스 이름이 각 컨테이너 IP로 해석됨을 확인했다. 모든 사용자 기능 요청은 실제 nginx의 `http://127.0.0.1:15173`을 거쳤다.

기존 API 키는 worker exec 표준입력에서 프로세스 환경으로만 주입했다. 이를 위해 테스트 override의 worker 기본 명령은 대기 명령으로 두고, 컨테이너 안에서 실제 Celery `--concurrency=1 --loglevel=INFO` 명령을 실행했다. 기본 Linux prefork와 비루트 사용자는 유지했다. 따라서 이 검증은 네트워크·업무 처리 검증이며 기본 컨테이너 명령의 종료 신호 전파·자동 재시작 검증은 아니다. Langfuse와 이번 기능에 관계없는 알림 relay는 껐다.

20개 가상 사용자가 각 1초 간격으로 작업을 조회했다. 매분 같은 키로 20개 동시 재접수와 완료 작업의 큐 중복 메시지 10개를 보냈다. 초반 3개 생성 완료 후 약 5분에 worker 3→1, 약 15분에 1→3으로 바꿨고, 약 25분에 새로운 작업 3개를 접수했다. 각 신규 작업에도 중복 메시지 8개를 추가했다. 축소는 실행 중 생성이 없는 시점에 수행했다.

| 검증 | 관찰 결과 |
|---|---|
| 30분 조회 부하 | 35,792건, HTTP·통신 오류 0건. 약 19.9건/초 |
| 응답 시간 | 마지막 저장 체크포인트(29분, 34,716건)의 누적 p95 40.20ms. 전체 최종 p95는 저장되지 않아 확정하지 않음 |
| 같은 요청 키 동시 재접수 | 총 600건, 모두 202와 기존 jobId 유지 |
| 큐 중복 메시지 | 348개 추가, 원래 6개를 포함한 354개 task 처리. 중복 생성 성공 응답 없음 |
| worker 확장 | 3→1→3, 종료 전 소비자 3개, 실제 작업 running 최대 3개 관찰 |
| 실제 모델 생성 | 시도 6회, HTTP 200 및 저장 완료 4회, generating 단계 interrupted 2회 |
| 인증 유지 | 10분·20분에 실제 refresh 성공, 부하 계속 진행 |
| 종료 상태 | 큐 ready/unacknowledged 0, 컨테이너 재시작·OOM 0, slice OOM/oom_kill 0 |
| 이미지 조회·적용 | 성공 4개 모두 비공개 1152×1536 PNG, 5MiB 이하. 중단 2개 content 조회는 409 |
| 세계관 표지 저장 | nginx를 통한 실제 multipart 저장·재조회 바이트 일치, 비공개 공개 경로 404 |

성공 이미지 크기는 2,843,323 / 2,769,879 / 2,896,363 / 2,706,960 bytes다. 모델·품질은 여섯 작업 모두 `gpt-image-2.6-flare`·`high`로 기록됐다. 앞선 검증까지 포함하면 생성 시도는 누적 16회다. 이번 두 중단 요청은 제공사 응답이 기록되지 않아 제공사 도달·과금 여부를 확정할 수 없다. 추가 생성이나 자동 재시도는 하지 않았다.

중단 작업은 `e84e82ff-ea99-4e19-83d8-6792d629aa58`(작품 표지, 접수 후 약 9.61초), `8446eda9-da6e-4c53-af39-8ce2ad1c7689`(세계관 표지, 약 8.07초)다. 5분 stale 종료가 아니라 worker의 `APITimeoutError`/`APIConnectionError` 처리 경로에 해당한다. Docker daemon 로그에는 13:17:36~43 KST에 WSL DNS 서버 `10.255.255.254:53`으로 보낸 `api.openai.com` A/AAAA 질의의 UDP timeout이 10건 기록됐다. 두 작업의 중단 시각 13:17:40.9·43.4와 일치해 외부 DNS 장애가 유력 원인이다. 다만 worker 로그에 개별 예외 하위 체인이 없어 각 요청과의 직접 연결까지 확정한 것은 아니다. 내부 서비스 DNS 성공과 외부 DNS 안정성을 구분한다.

이후 각 worker에서 키 없는 `/v1/models` GET을 5회씩 수행한 총 15회는 DNS/TLS 연결 뒤 예상한 401 응답을 받았다. 이 무과금 검사는 장애 이후 연결 회복만 확인하며, 30분 안정성이나 생성 성공을 대신하지 않는다. 호스트 DNS 설정을 임의 변경하거나 고정 IP로 모델 주소를 우회하지 않았다.

전체 slice의 3,200MiB 제한에서 메모리 회수와 swap 사용은 있었다. OOM이 없었다는 결과를 메모리 여유나 장기 누수 부재의 증거로 해석하지 않는다. 또한 단일 호스트·30분·생성 두 묶음의 검증이므로 다중 호스트, 지속적인 대량 생성, 진행 중 worker 강제 종료, 8~24시간 안정성은 미검증이다.

원래 검증 도구는 모든 이미지 검증 뒤 최종 통계를 저장하도록 돼 있어 중단 작업에서 assertion이 실패한 뒤 전체 지연 분포를 남기지 못했다. 원본 `soak-result.json`의 failed 판정과 30개 분 단위 체크포인트를 보존하고, 별도 읽기 전용 사후 점검으로 DB·큐·worker 로그·이미지를 대조했다. 최종 요청 수는 실행 프로세스의 종료 출력이다. 실패 판정을 성공으로 덮어쓰지 않았다.

로컬 증거는 `D:/Codex/image-live-verification/compose-soak/`의 `soak-result.json`, `reconciled-result.json`, `audit-final.json`, `adoption-result.json`, `egress-probes.json`, `daemon-dns-failure.log`와 worker 로그·PNG다. 키가 컨테이너 설정·검증 텍스트 산출물·staged 문서에 없는 것도 검사했다. 제품 코드·의존성은 변경하지 않았고 PR은 만들지 않았다. 변경 문서 두 개는 CodeRabbit 0.9.2 리뷰에서 지적 0건이었으며, 실검증 수치와 추가 DNS 기록은 별도로 증거와 직접 대조했다. 종료 후 테스트 프로젝트 컨테이너·네트워크와 독립 daemon을 종료하고 backing disk를 정상 해제했다. 이미지·볼륨·검증 산출물은 보존했으며 `cleanup-result.json`에 확인 결과를 남겼다.

남은 확인은 테스트 환경의 외부 DNS 안정화, 연결 실패의 안전한 진단 메타데이터(예외 종류·단계·경과 시간 등) 확보와 별도 호출 범위에서의 생성 재검증이다. 본문·키를 로그에 추가하거나 생성 자동 재시도를 도입하는 방식으로 해결하지 않는다.

## 외부 DNS 조치·중단 입력 재생성 (2026-11-16 후속)

사용자가 DNS 조치와 실제 재검증을 요청해 기존 키로 두 입력을 각각 한 번씩 새로 생성했다. 이전 30분 검증의 실패 기록은 보존하며, 이번 결과로 그 실행을 성공으로 변경하지 않는다.

이 환경의 `/etc/resolv.conf`는 WSL 가상 DNS `10.255.255.254`를 사용했고, Windows 네트워크 어댑터에 설정된 실제 DNS는 `168.126.63.1`·`8.8.8.8`이었다. WSL에서 각 주소에 A/AAAA 질의를 10회씩 보내 모두 응답함을 확인한 후, 독립 테스트 daemon 시작 스크립트 `D:/Codex/image-live-verification/start_compose_engine.sh`에 다음 옵션만 추가했다.

```text
--dns=168.126.63.1 --dns=8.8.8.8
```

이 조치는 WSL 가상 DNS 경유를 피하고 이미 호스트에 설정된 upstream으로 질의하도록 한다. 각 worker의 실제 `/etc/resolv.conf`에서 내부 resolver는 `127.0.0.11`, ExtServers는 위 두 주소임을 확인했다. Compose 기본 bridge와 서비스 이름 해석은 유지했다. Windows·WSL 전역 DNS, 제품 Compose, 애플리케이션 코드, 이미지 모델·품질은 변경하지 않았다. 재시작 때도 같은 테스트 스크립트로 적용되지만, 다른 네트워크·VPN에서는 그 환경의 승인된 DNS 주소를 다시 확인해야 한다. 이 주소를 공통 배포 설정에 하드코딩하지 않는다. [Docker DNS 동작](https://docs.docker.com/engine/network/), [WSL DNS tunneling 설정](https://learn.microsoft.com/en-us/windows/wsl/wsl-config#experimental-settings)

중단된 작업의 상태를 직접 고치거나 기존 큐 메시지를 재실행하지 않았다. 동일한 purpose·prompt·worldId를 새 요청 키로 실제 nginx API에 접수하고, worker 3개 환경에서 두 생성이 동시에 running인 것을 확인했다.

| 용도 | 기존 interrupted 작업 | 새 succeeded 작업 | 접수~완료 등록 | PNG 크기 |
|---|---|---|---|---|
| 작품 표지 | e84e82ff-ea99-4e19-83d8-6792d629aa58 | a76a2f79-6691-4067-bc96-0b0d83e2c1d7 | 38.196초 | 2,731,665 bytes |
| 세계관 표지 | 8446eda9-da6e-4c53-af39-8ce2ad1c7689 | 6782d30b-80b7-4c59-bb9b-0e25b5d35a22 | 32.878초 | 2,962,057 bytes |

두 이미지 모두 `gpt-image-2.6-flare`·`high`, 1152×1536 PNG, 실제 디코딩 성공·5MiB 이하·`private, no-store`를 확인했다. 세계관 표지는 기존 비공개 테스트 세계관에 실제 multipart로 저장했고 재조회 바이트가 생성 원본과 일치했으며 공개 경로는 404였다. 원래 두 작업은 interrupted로 남았다. 생성 중 병렬 조회 420건에서 오류 0건, p95 650.15ms였고 worker 시작 이후 두 작업 완료 확인까지 27.782초였다.

worker 3개에서 각각 5분 동안 60회씩, 총 180회 내부 서비스 DNS·외부 DNS·HTTPS 연결을 반복 검사했다. 매회 키 없이 `/v1/models`에 요청해 예상한 401 응답을 받았으며 DNS/연결 오류는 0건이었다. 이는 이미지 생성 호출에 포함되지 않는다. 새 daemon 실행의 전체 로그에서도 resolver 오류가 없었다. 컨테이너 재시작·OOM 0건, 종료 점검 시 큐 ready/unacknowledged 0과 소비자 3개를 확인했다.

실제 이미지 호출은 추가 2회 모두 HTTP 200이었다. 작업마다 중복 메시지 8개씩을 넣어 총 18개 task가 처리됐지만 추가 생성 호출은 없었다. 기존 기록을 포함한 생성 시도는 누적 18회다. 실제 키가 컨테이너 설정·검증 텍스트 산출물에 없는 것도 점검했다.

후속 증거는 `D:/Codex/image-live-verification/dns-retest/`의 `upstream-probes.json`, `resolv-*.txt`, `dns-probe-*.jsonl`, `dns-duration-result.json`, `retry-result.json`, `audit-result.json`, worker 로그·PNG에 별도로 보존했다. 이전 `compose-soak`의 실패 보고서는 덮어쓰지 않았다.

CodeRabbit 0.9.2의 변경 문서 검토에서 지적은 없었다. 검증 뒤 테스트 컨테이너·네트워크·독립 daemon을 종료하고 디스크를 정상 해제했으며, 결과·이미지·볼륨은 보존했다. 종료 확인은 같은 디렉터리의 `cleanup-result.json`에 남겼다. PR은 생성하지 않았다.

이번 검증은 외부 DNS 경로 변경과 중단 입력 두 건의 재생성 확인이다. 이전 30분 부하 전체를 다시 실행하거나 장시간 장애 부재를 보장한 것은 아니다. 원본 예외의 세부 분류를 안전하게 기록하는 제품 코드 변경도 이번에는 하지 않았다.

## DNS 수정 환경의 30분 재검증·D: 이전 (2026-11-16 후속)

### 재검증 중 확인한 환경 장애

DNS 수정 후 첫 재실행(`compose-soak-fixed-dns`)은 14:24:33에 시작해 1,513.16초에서 실패했다. 조회 29,997건은 모두 HTTP 200이고 통신 오류도 없었지만, 후반 세계관 표지 접수는 503이었다. 실제 생성은 초반 3건과 후반 작품 표지 1건, 총 4건만 HTTP 200·저장 완료됐으며 503 접수에는 모델 호출이 없었다. 새 생성 시도 누적은 앞선 18회에 이 4회를 더한 22회다. 실패한 실행의 전체 지연 분포와 보고서는 보존했다.

원인은 이 실행에서 Neo4j 컨테이너가 14:26:34에 OOM으로 종료된 사실과 연결된다. Docker 상태의 `OOMKilled=true`, 종료 코드 137, 커널 OOM 기록을 확인했고, 세계관 조회도 `RELATIONSHIP_STORE_UNAVAILABLE` 503을 반환했다. 조회 부하 대상인 이미지 작업 조회가 계속 200인 것만으로 서비스 전체의 정상 여부를 판정할 수 없었다.

검증 도구의 `compose ps -q`가 종료된 컨테이너를 누락하는 결함도 발견했다. `compose ps -a -q`로 바꾸고 서비스 11종·단계별 worker 수·모든 컨테이너의 실행/건강 상태·OOM·재시작을 확인하도록 보완했다. 실패 시에도 요청 수와 원시 지연 표본을 저장한다. 제품 코드 변경은 아니다.

테스트 override의 Neo4j healthcheck에는 별도 JVM 메모리 한도를 지정했다. `JAVA_OPTS`로 heap 8/32MiB, metaspace 64MiB, direct/code cache 각각 16MiB, CPU 1개, stack 256KiB를 사용하고 `exec`로 cypher-shell을 실행한다. 간격 15초·timeout 10초·시작 유예 45초로 조정했다. 서버 heap 64/192MiB, page cache 32MiB, 컨테이너 512MiB와 전체 slice 3,200MiB 제한은 유지했다. 반복 probe와 서버가 함께 쓰는 메모리를 제한한 조치이며, probe가 OOM의 유일한 원인이었다고 단정하지 않는다.

이후 성공 이미지 4개를 재사용하도록 준비했던 실행(`compose-soak-resource-fixed`)은 180.38초, 조회 3,570건 모두 200에서 제어 명령 timeout으로 중단됐다. 이 실행은 새 이미지 접수·모델 호출이 0회였다. 당시 C: 여유가 0바이트였고 WSL 루트 디스크 I/O 오류와 Neo4j 종료 코드 135가 확인됐다. D: 테스트 ext4에는 여유 공간이 남아 있었다. 앞선 OOM과 이번 디스크 오류를 같은 장애로 취급하지 않는다.

### 테스트용 WSL 저장소 이동

사용자가 기존 성공 이미지를 재사용하지 않고 **새 이미지 6회로 동일 조건 재검증**하도록 선택했고, 이어 WSL도 D:로 옮겨 계속하도록 승인했다. 테스트 서비스를 정지하고 전용 ext4를 해제한 뒤 읽기 전용 `e2fsck -fn` 검사에서 종료 코드 0을 확인했다. 데이터·볼륨·앞선 실패 보고서는 보존했다.

WSL의 `--manage Ubuntu-26.04 --move`로 테스트용 배포판을 `D:/Codex/wsl/Ubuntu-26.04`에 이동했다. 배포판 종료 직후에는 VHD 사용 중 오류가 있었으므로 모든 배포판이 정지 상태임을 확인하고 WSL VM을 종료한 뒤 이동을 완료했다. 다른 배포판의 저장 위치는 변경하지 않았다. 등록된 `BasePath`와 이동 후 파일 쓰기·동기화를 확인했다.

`C:/Users/playdata2/.wslconfig`의 기존 `networkingMode=mirrored`를 유지하면서 `swapFile=D:\\Codex\\wsl\\swap.vhdx`를 지정했다. 이 설정은 WSL 2 전체에 적용되며 Windows pagefile 설정과는 별개다. 원래 설정은 새 검증 디렉터리에 백업했고 D:에 실제 swap VHD가 생성됐음을 확인했다. [Microsoft WSL 설정](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)

이동 후 독립 daemon을 기존 DNS 옵션으로 시작하고, 테스트 컨테이너와 기본 Compose 네트워크를 다시 만들었다. DB·이미지 볼륨은 재사용했다. 유료 생성 전에 기존 세계관 읽기 HTTP 200, worker 3개의 내부 DNS·키 없는 외부 HTTPS 401, 모든 서비스의 실행·건강 상태를 확인했다. 최종 재실행 증거는 `D:/Codex/image-live-verification/compose-soak-final-six/`에 별도로 기록한다.

### D: 이전 후 첫 재실행 결과: 미통과

15:18:58에 시작한 `compose-soak-final-six`는 초반 실제 생성 3건이 모두 generating 단계에서 interrupted가 되어 5분의 생성 완료 조건을 통과하지 못했다. 실제 부하 시간은 309.12초, 조회 6,131건 모두 HTTP 200·통신 오류 0건, p50 27.08ms / p95 288.41ms / p99 980.35ms / 최대 1,986.15ms였다. SQL에서 동시 running 3건을 관찰했다. worker 3→1→3과 후반 3건 생성은 수행하지 못했으며 30분 검증 통과로 보지 않는다.

| 생성 작업 | 최종 상태/단계 | 접수~상태 등록 |
|---|---|---|
| 2931df5e-2c6d-4b06-8d1d-ae392a87b0e0 | interrupted / generating | 209.104초 |
| bc63a761-5267-45c1-b895-34c9b27953d6 | interrupted / generating | 204.450초 |
| 021d4310-956d-45b7-a6b1-51bf5a0b2582 | interrupted / generating | 201.508초 |

해당 Celery task 실행은 각각 약 183초였고, 모델 SDK의 제한은 180초였다. 생성 HTTP 응답은 worker 로그에 한 건도 기록되지 않았다. 제품 코드상 `APITimeoutError` 또는 `APIConnectionError` 처리 경로이지만 두 예외의 구분과 하위 원인은 현재 로그만으로 확정하지 않는다. Celery task 87개의 succeeded 로그는 중복 메시지와 interrupted 처리까지 정상 반환됐다는 뜻이며 이미지 생성 성공을 의미하지 않는다. 기존 12개 작업의 상태는 그대로 보존됐다.

실패 직후 컨테이너 13개의 실행/건강 상태, 컨테이너 재시작·OOM 0건, slice OOM/oom_kill 0건을 확인했다. 새 daemon의 resolver 오류나 커널 디스크 I/O 오류도 관찰되지 않았다. 같은 worker에서 기존 키로 `/v1/models` GET은 1.246초에 200과 모델 가용 목록을 반환했다. 모델·프롬프트를 넣지 않은 `/v1/images/generations` POST는 0.705초에 400 `invalid_request_error`를 반환했다. 두 요청은 새 이미지 생성을 요청하지 않은 인증·전송 경로 검사다. 이 결과로 실제 생성 서비스의 장애나 지연 원인을 단정하지 않는다.

이번 실제 생성 시도는 3회이며, 앞선 기록을 포함하면 누적 25회다. 응답을 받지 못한 요청의 제공사 도달·과금 여부는 확인되지 않았다. 사용자 승인 범위인 새 6회 중 남은 3회는 아직 호출하지 않았고 자동 재시도도 없었다. `failure-audit.json`, `post-failure-snapshot.json`, `authenticated-model-probe.json`, `invalid-generation-request-probe.json`, 원시 지연 표본과 worker 로그에 증거를 보존했다.

### 추가 승인 후 응답 대기 timeout 재현

사용자가 추가 3회를 승인해 남은 3회와 합친 새 6회 범위로 `compose-soak-d-drive-retry6`를 시작했다. 제품의 모델·품질·입력·180초 timeout·자동 재시도 없음은 유지하고, 테스트 worker bootstrap에서 SDK 전송 event 이름·예외 클래스 체인·경과 시간만 기록했다. 헤더 값·키·프롬프트·응답·예외 본문은 기록하지 않았다. 진단 wrapper가 기존 예외를 그대로 전파하고 timeout/retry 값을 바꾸지 않으며 예외 본문의 시험 문자열을 로그에 남기지 않는 자체 검사도 통과했다. 제품 소스 변경은 아니다.

15:34:26에 시작한 초반 새 요청 3건 모두 클라이언트 기준 약 1.6초 안에 TCP 연결·TLS·요청 본문 전송을 완료했으나, 응답 헤더 수신 단계에서 약 180초를 기다린 뒤 실패했다. 세 요청의 예외 클래스명 체인은 `APITimeoutError → ReadTimeout → ReadTimeout`이었다. DNS/연결 단계 오류와 구분할 수 있지만 제공사 내부 지연인지 응답 경로 문제인지는 이 기록만으로 확정하지 않는다. 세 작업은 generating/interrupted로 남았고 이 실행도 5분의 생성 완료 조건에서 중단됐다. 새 시도는 3회, 누적 28회이며 자동 재시도는 없었다.

이에 조회 부하·worker 확장과 모델 성공 판정을 분리했다. 별도 `compose-soak-d-drive-load`는 위 3개의 interrupted 작업을 조회·같은 키 재접수·중복 큐 처리 대상으로 재사용하고, 승인 범위에서 남은 새 생성 3건만 25분 시점에 접수한다. 실행 중 작업이 없고 상태가 terminal이면 worker 축소를 진행하되, 생성 실패를 성공으로 바꾸지 않는다. 이 구간은 새 6건을 초반/후반에 모두 생성하는 원래 시나리오와 구분하며, 앞선 실행의 실패 판정은 보존한다. 전체 부하 통계를 남긴 뒤 각 이미지의 최종 상태를 별도로 확인하도록 검증 도구를 보완했다.

### 분리한 30분 부하 구간·후반 생성 결과

15:40:32부터 **1,800.30초** 동안 실제 nginx를 통한 조회 부하를 실행했다. 사후 대조 결과는 **부분 통과**다. 30분 조회·중복 억제·worker 확장은 통과했지만, 추가 승인 뒤 새로 시도한 6건은 초반 interrupted 3건·후반 succeeded 3건이므로 생성 전체 성공이나 동일 조건의 새 6건 연속 성공으로 보지 않는다.

| 검증 | 결과 |
|---|---|
| 조회 부하 | 35,589건, HTTP·통신 오류 0건, 약 19.8건/초 |
| 전체 응답 시간 | p50 27.17ms / p95 201.11ms / p99 820.47ms / 최대 3,315.81ms |
| 동일 키 재접수 | 600건, 기존 jobId 유지, 추가 생성 없음 |
| 큐 중복 처리 | 중복 348개 + 새 작업 3개 = 351개 task 처리, 실제 모델 POST HTTP 200은 3회 |
| worker 확장 | 3→1→3, 종료 시 소비자 3개, ready/unacknowledged 모두 0 |
| 인증 | 10분·20분 토큰 refresh 성공 |
| 실행 환경 | 기본 Compose bridge 유지, 종료 시 13개 컨테이너 정상, 재시작·OOM·resolver 오류 0 |
| 기존 데이터 | 시작 전 작업 18개의 상태 보존, 새 작업 3개만 추가 |

후반 새 생성 3건은 모두 실제 `gpt-image-2.6-flare`·`high` 호출, 생성 결과 검증·저장까지 성공했다. PNG는 모두 1152×1536, 5MiB 이하이며 소유자 조회의 `private, no-store`를 확인했다.

| 용도 | 작업 ID | 접수~완료 등록 | PNG 크기 |
|---|---|---|---|
| 작품 표지 | e490263e-f5cc-4231-bfe7-b54ab0f9d06c | 22.410초 | 2,963,199 bytes |
| 세계관 표지 | a5c57662-ea10-4bbc-8c04-167659285aa8 | 17.162초 | 2,852,872 bytes |
| 작품 표지 | e604fc17-67be-4b1a-9ab1-2dcc87de16a6 | 17.603초 | 2,973,716 bytes |

세계관 표지를 실제 multipart API로 적용하고 재조회 바이트 일치 및 비공개 세계관의 공개 표지 경로 404를 확인했다. 앞선 interrupted 3건의 content 조회는 여전히 409였다. 추가 승인 뒤 6회 중 나머지 3회를 사용한 것이며, 전체 기록의 생성 시도는 누적 31회다. 이 가운데 응답을 받지 못한 요청의 실제 과금 여부는 별도 확인이 필요하다. 자동 재시도와 승인 범위 밖 추가 호출은 없었다.

SQL 폴링은 후반 running 최대 1건만 관찰했으나, 세 worker의 완료 로그와 task 실행 시간을 대조하면 07:06:00.872~07:06:07.914 UTC에 세 task 실행 구간이 겹친다. 이는 생성·검증·업로드·완료 보고를 포함한 worker task의 동시 실행이며 제공사 내부 연산의 동시성을 뜻하지 않는다. 실행 중이던 검증 도구의 `SQL 최대값 == 3` 단정 때문에 원본 `soak-result.json`은 실패로 종료됐다. 원본을 수정하지 않고, 30개 분 단위 체크포인트·전체 지연 표본·worker 로그·DB·큐·실제 PNG/API 검증을 독립적으로 대조한 `audit-result.json`에 인프라 통과/생성 전체 실패를 기록했다. 이후 검증 도구에서는 SQL 표본을 하한값으로 남기고 worker 로그 구간을 최종 동시성 근거로 확인하도록 수정했다.

이 구간 도중 Windows의 C: pagefile 할당량이 23,804MiB에서 26,656MiB로 증가했고 C: 여유가 소진되기도 했다. D:로 이전한 WSL 저장소에서는 디스크 I/O 오류 없이 실행됐지만, 약 8분 시점에 `sync` 후 WSL의 깨끗한 파일 캐시를 한 번 회수했다. 서비스·daemon 재시작이나 timeout 변경은 없었다. 해당 개입과 메모리 압박이 있으므로 지연 수치는 이 로컬 환경의 관측값이며 운영 성능이나 개입 없는 장시간 안정성을 보장하지 않는다. Windows pagefile 위치는 변경하지 않았다.

증거는 `compose-soak-d-drive-retry6`의 진단 worker 로그·`failed-attempt-intervals.json`과 `compose-soak-d-drive-load`의 `audit-result.json`, `final-image-verification.json`, `adoption-result.json`, `worker-execution-intervals.json`, `resolver-log.json`, `host-disk-samples.jsonl`, `cache-reclamation.json`, 원시 지연 표본·PNG다. 후반 생성 성공은 확인했으나 앞선 응답 헤더 대기 timeout의 근본 원인과 재발 방지는 아직 확인하지 못했다. 180초 제한 확대나 생성 자동 재시도는 채택하지 않았다.

변경 문서의 CodeRabbit 0.9.2 검토에서 지적은 없었고, 실제 키가 staged 문서·검증 텍스트·컨테이너 설정에 없는 것도 확인했다. 제품 소스·의존성은 변경하지 않았다. 검증 뒤 테스트 컨테이너·네트워크·독립 daemon을 종료하고 ext4 backing disk를 정상 해제했다. 이미지·볼륨·증거는 보존했으며 종료 결과는 `compose-soak-d-drive-load/cleanup-result.json`에 남겼다. PR은 생성하지 않았다.
