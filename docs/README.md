# STORYFORK 문서 안내

[메인 README](../README.md)로 돌아가기

메인 README는 팀·프로젝트 소개, 기능, 아키텍처, 데이터, AI 흐름을 요약합니다.
이 목록은 `docs/`의 문서를 목적별로 묶고, 현재 기준 문서와 작성 시점 기록을 구분합니다.
문서끼리 충돌하면 [결정 기록](design/decisions.md)과 [서비스 구조(DEC-41)](design/service-boundaries.md)를 우선합니다.

## 기획·산출물

| 문서 | 확인할 내용 |
|---|---|
| [기획서](<deliverables/SKN34-final-4Team_기획서.pdf>) | 기획 기준 v1.5: 문제 정의, 사용자, 핵심 기능, 비용·권리 방향 |
| [요구사항 정의서](<deliverables/SKN34-final-4Team_요구사항정의서.xlsx>) · [기능 ID 색인](requirements.md) | 원본 요구사항과 Markdown으로 옮긴 기능 ID 색인 |
| [WBS](deliverables/SKN34-final-4Team_WBS.xlsx) | 일정·작업 분해 |
| [화면 설계서](<deliverables/SKN34-final-4Team_화면설계서.pdf>) | 화면 구성·흐름 |
| [시스템 구상도](<deliverables/SKN34-final-4Team_시스템 구상도.pdf>) · [AI 시스템 아키텍처](<deliverables/SKN34-final-4Team_AI 시스템 아키텍처.pdf>) | 제출용 시스템·AI 구성도 |
| [산출물 안내](deliverables/README.md) | 산출물 목록, 중간발표 최종본(v36)과 발표 보조 자료 |

## 유스케이스·화면

| 문서 | 확인할 내용 |
|---|---|
| [유스케이스](usecase.md) | 액터, UC-01~28 목록, 전체 유스케이스 다이어그램 |
| [유스케이스 명세](usecase-spec/README.md) | UC별 기본·대체·예외 흐름과 업무 규칙 |
| [보조 다이어그램](diagrams/README.md) | 활동·클래스·시퀀스·상태 다이어그램 |
| [UI 프로토타입 대응](prototype-alignment.md) | 프로토타입 화면과 유스케이스의 대응 |

## 설계·결정 — 현재 기준

| 문서 | 확인할 내용 |
|---|---|
| [결정 기록](design/decisions.md) | DEC-01~45 아키텍처·정책 결정과 우선순위 |
| [서비스 구조(DEC-41)](design/service-boundaries.md) | Core·콘텐츠·운영·AI 4개 서비스의 책임·데이터·실행 구조 |
| [콘텐츠 서비스 이관 계약](design/content-service-migration-contract.md) | Core → Content 이관 범위, 인증 연동, 마이그레이션 소유 |
| [MVP 설계](design/design.md) | MVP 포함·제외 범위, 저장 방향 |
| [서비스별 설계](design/services/core-api.md) | [Core](design/services/core-api.md) · [AI](design/services/ai-service.md) · [Frontend](design/services/web.md) · [인프라](design/services/infrastructure.md) 목표 설계 |
| [WorldStudio 관계 계약](design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132) | Neo4j 현재 관계 정본, PG 메타데이터, 재시도·실패 경계(#132) |
| [공개 세계관 계약(DEC-45·46·47)](design/public-world-contract.md) | 세계관 단위 공개·비공개, 비로그인 읽기 전용 공개 목록·상세 API(공개 설정 카드만), 소유자 표지 업로드, 세계관-소설 1:1 연결, 독자 설정 위키, 설정 가져오기·인물 문서의 카드 메타데이터, 한계 |
| [원고 기본 서식 계약(DEC-48)](design/manuscript-format-contract.md) | 집필실 Toast UI 편집기와 원고 기본 서식(굵게·기울임·소제목·인용·구분선)의 문법·검증 표, 화면·내보내기별 동작, 한계 |
| [초기 세계관 AI 전처리 v1](design/initial-world-preprocessing/README.md) | 계약·JSON Schema·홍길동전 fixture. 실제 분석·검토·반영 기능은 후속 구현 |

## 데이터

| 문서 | 확인할 내용 |
|---|---|
| [ERD 문서 목차](design/erd/README.md) | 143개 테이블 논리 후보, 업무 영역별 부분 ERD, 요구사항 추적 |
| [콘텐츠 저장 구조와 ERD 대응](content-erd-migration.md) | 현행 콘텐츠 물리 테이블과 논리 ERD의 대응·보존 경계 |
| [알림 사건 계약](notification-event-contract.md) | RabbitMQ 알림 사건 형식(schemaVersion 1)과 Core 소비 규칙 |

## 구현·개발

| 문서 | 확인할 내용 |
|---|---|
| [개발 기능표](feature-roadmap.md) | 기능별 개발 완료 여부(✅ = PR 병합 + `Required CI` 성공)와 관련 이슈·PR |
| [아키텍처](architecture.md) | 서비스별 코드 흐름, 저장·보안 경계, 향후 구성요소 |
| [개발·실행·검증 안내](development.md) | Compose·네이티브 실행, 포트, 로컬 단위 테스트, CI 구성 |
| [WorldStudio V1 배포 계약](deployment/worldstudio-v1-rollout.md) | develop CD 실행 조건과 승인 경계 |
| [콘텐츠 통합 안내](content-integration.md) | `/content` 작업실 범위, 인증, AI 문맥 한도 |
| [인프라 안내](../infrastructure/README.md) | Compose 구성, 서버별 변수, CI → CD 흐름 |

## 조사

| 문서 | 확인할 내용 |
|---|---|
| [작가 도구 조사·온보딩](research/writer-tools/README.md) | Novelcrafter·Sudowrite·스토라이즈 비교와 시연 안내 |
| [펜시브 기능 조사](research/pensiv/README.md) | 기능·블로그 제공 주장, STORYFORK 적용 제안과 출처 |

## 작성 시점 기록

당시 작업의 범위·검증을 보존한 문서입니다. 현재 기준으로 사용하지 않으며 각 문서 상단에 현재 기준 문서를 안내합니다.

| 문서 | 확인할 내용 |
|---|---|
| [이슈 #34 기록](issue-34-review.md) | 메모리 데모 집필실 공개 중복·제목 초기값 수정 (종료) |
| [이슈 #72 기록](issue-72-review.md) | 병합된 콘텐츠 코드·요구사항 정합성 재리뷰 (종료) |
| [이슈 #84 기록](issue-84-content-boundaries.md) | 콘텐츠 책임 분리와 JPA 전환 (종료) |
| [이슈 #50 대응](issue-50-alignment.md) | 회차 생성·원고 관리 구현 진행 기록 |
| [PR #86 차이 기록](design/worldstudio-independent-schema-pr86-delta.md) | PR #86 설계와 독립 초기 스키마 비교 |
| [PR #98 JPA 검증 기록](design/worldstudio-jpa-verification.md) | WorldStudio의 Core 기본 JPA 재사용 검증 |
| [WorldStudio 후속 이슈 재평가(2026-11-09)](worldstudio-followup-status-20261109.md) | 11-09 기준 후속 이슈별 소스 대조·유효성 판정 |
| [회차 삭제 정책 초안](episode-deletion-policy-draft.md) | 정책 확정 전 이슈 초안 |
| [이전 설계: KAG](design/archive/kag-design/design.md) · [RDB MVP](design/archive/rdb-mvp/design.md) | 현재 설계 이전의 아키텍처안 |
| [WorldStudio 콘텐츠 확장안](archive/worldstudio-content-extension/README.md) | 폐기된 Content 확장 스키마 원본 보관 |
