# 댓글 분석 최종 모델과 배포 전 검증

## 모델과 평가 자료

피드백 유무는 service-binary-v13-5097-epoch3의 기존 ONNX를 사용한다. 양성 조건은 p > 0.9904975295066833이며 기존 0.50은 복구 설정이다.
G2는 5,129건, 클래스 빈도의 역제곱근 가중 CrossEntropyLoss로 학습된 KcELECTRA이다. 8-class softmax argmax로 대표 항목 하나를 반환한다. 기존 멀티라벨 데이터·감정·공격성·SVM·H5를 이 테이블로 이관하지 않는다.

|평가 데이터와 참조|평가 대상|결과|
|---|---|---|
|별도 자연 표집 확인 300작품 중 이진 채점 가능 280건, 블라인드 AI 참조|신규 임계값|Precision 0.9351, Recall 0.8782, Accuracy 0.8714, Macro-F1 0.8518, FP 12, FN 24|
|독립 대표 항목 87작품·100건, P4 AI 블라인드 판독|양성에 대한 G2 항목 분류|Accuracy 0.8600, Macro-F1 0.7208, Weighted-F1 0.8675|
|같은 자연 표집 확인 세트 중 양 단계 모두 채점 가능한 267건|신규 게이트 + G2, 비피드백 포함 9개 결과|Accuracy 0.7640, Macro-F1 0.6083|

첫째·셋째 행의 출처는 service-threshold-calibration-v1/confirmation_metrics.csv와 e2e_confirmation.csv, 둘째 행은 primary-independent-return-v1/FINAL_EVALUATION_KO.md이다.
기존 0.50 대비 FP 27→12, FN 12→24였다. 오탐 감소를 우선한 결정이다. 결합 Accuracy는 0.7378→0.7640, 결합 Macro-F1은 0.6127→0.6083이었다. 위 수치는 동결 보고서에서 옮겼으며 추가 학습·재채점·임계값 탐색은 하지 않았다.

## 서비스 경로

신규·본문 수정 댓글 → V48 큐 → CommentFeedbackJob → FastAPI batch → 기존 ONNX 양성 게이트 → G2 → Content 현재 행과 버전별 집계. 작업 단위는 최대 8댓글이며 batch API는 ID 중복을 검사한다. Content는 전체 응답 ID와 판정·항목 일관성을 검사하고 활성 claim에만 쓴다. 실패·타임아웃은 기존 리스 정책을 따르고 최종 실패는 권한 있는 재처리 API로 다시 등록한다. 대시보드 조회·집계는 추론을 호출하지 않는다. 통계는 상태가 완료된 현재 댓글에 한정한다.

## 실행 자료와 배포

CPU 런타임은 ONNX Runtime, 4 intra-op 스레드이다. 동결된 PyTorch와 변환된 G2 ONNX의 합성 8건 argmax 및 8개 클래스 매핑이 일치했다. 생성한 G2 model.onnx SHA-256은 e027db9ad3e08cfa607f65359e2f5d15b120fd934c7f5132b341e865ba103d5f다.
D:/STORYFORK-checkpoints/comment-service-final-01/g2의 번들은 소스 저장소와 분리했다.

Docker Linux 검증은 python:3.11-slim-bookworm, 기존 AI 의존성, CPU 4개·메모리 4 GiB 한도에서 외부 네트워크 없이 수행했다. 합성 댓글 8건 전부가 양성 게이트를 통과하여 두 모델 모두 실행됐다. 배치 요청 5회 중앙값 1.558초, 모델 초기화 10.26초, Python 프로세스 최대 RSS 1,200 MiB였다. 운영 하드웨어나 전체 AI 서비스와 DB의 합산 지연·메모리는 별도 측정 대상이다. Windows에서도 동일 8건 단건·배치 판정이 일치했다.

실행 자료는 D:/STORYFORK-checkpoints/comment-service-final-01 아래 api.log, linux.json, performance.json, parity.log, upgrade.log, focused-gradle.log에 있다. 실제 AI 검사에는 scripts/check_comment_pipeline.py, PostgreSQL/HTTP 검사에는 CommentFeedbackStorePostgresTest와 CommentFeedbackClientIntegrationTest를 사용한다. 테스트 DB는 TEST_CONTENT_DATABASE_URL, 테스트 AI 주소는 TEST_FEEDBACK_AI_URL로 전달한다. 운영 DB를 이 테스트의 대상으로 쓰지 않는다.

배포 설정과 순서는 backend/ai-service/README.md의 ‘확정 댓글 파이프라인 배포’를 따른다. 기존 개발 브랜치를 기준으로 구현했다. develop에 반영하기 전에 양쪽에서 변경된 AI 앱 진입점, 의존성 및 프론트 DI를 통합하고 CI를 확인해야 한다.

## 확인한 결과

- FastAPI 16건 통과. 기존 이진 단건 계약, 엄격한 동률 처리, 입력 검증·인증·장애 응답, 중복 ID, G2 클래스 순서를 확인했다.
- Content 7건 통과, 실패·건너뜀 0건. 실제 PostgreSQL 임시 스키마에 V48/V49를 적용한 뒤 스케줄러의 배치 처리 함수를 두 번 실행했다. 실제 HTTP로 두 모델을 호출해 대표 항목을 저장하고 작품·회차 집계와 조회 컨트롤러 응답을 확인했다. 장기 리스 회수, 지연 응답 거부, 최종 실패 재등록, 중복 재등록 방지, 숨김·삭제 및 이전 완료 버전 보존도 확인했다.
- 이전 이진 완료 행을 넣은 상태에서 V49를 적용한 별도 업그레이드 검사 통과. 기존 분류 입력/바인딩 회귀 12건 및 하위 검사 4건 통과. 감정·공격성의 입력 계약은 유지되며 해당 모델 자체의 운영 정확도는 재측정하지 않았다.
- 전체 서비스 동시 부하와 실제 운영 장비 성능은 미측정이다. Linux 수치는 격리 컨테이너의 배치 추론 API에 해당한다. 이 변경은 기존 댓글 개발 작업트리에 로컬로 남겼다.
