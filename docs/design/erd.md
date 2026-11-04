# STORYFORK ERD 문서 안내

ERD를 서비스와 업무 영역별로 정리했습니다.

- [ERD 문서 목차](erd/README.md)
- [전체 업무 ERD](erd/overview.md)
- [업무 영역별 ERD](erd/README.md#업무-영역별-erd)
- [LangGraph PostgresSaver 참고](erd/ai-service/postgres-saver.md)

기존 경로에서 문서를 찾을 수 있도록 이 안내를 유지합니다. ERD는 정규화된 전체 서비스 논리 후보입니다. 현재 `core-api`에는 인증·콘텐츠·첨부 일부의 PostgreSQL 저장이 있지만 전체 후보와 별도 서비스 분리는 미구현입니다. [DEC-41](service-boundaries.md)에 따른 Core·콘텐츠·운영 정본 소유는 목차와 각 뷰의 표에서 구분하며 기존 `core/` 문서 경로와 ERD 모델은 유지합니다.

## 3. LangGraph PostgresSaver의 실제 테이블

Saver의 확인된 테이블과 출처는 [별도 참고 문서](erd/ai-service/postgres-saver.md#3-langgraph-postgressaver의-실제-테이블)로 옮겼습니다.
