# STORYFORK 시퀀스 다이어그램
> [다이어그램 목차](./README.md) · [유스케이스 문서](../usecase.md) · [명세 목차](../usecase-spec/README.md)
서비스 사이의 호출 순서와 책임을 정리합니다. 호출 방향은 `Frontend → Core API → AI Service → OpenAI`이며, 권한·정본·발행·크레딧은 Core API가 판단하고 저장합니다([공통 지침](../../AGENTS.md)). 메시지 이름은 동작 설명이며 API URL·DTO가 아닙니다.
## 1. 독자 제보 분석 (UC-14·15)
```mermaid
sequenceDiagram
  actor R as 독자
  participant FE as Frontend
  participant CO as Core API
  participant DB as DB
  participant AI as AI Service
  participant LLM as OpenAI
  actor OP as 운영자
  R->>FE: 제보 작성 (질문·오류 제보·제안)
  FE->>CO: 분석 비용 조회
  CO-->>FE: 필요 크레딧 · 잔액
  R->>FE: 비용 동의 · 등록
  FE->>CO: 제보 등록
  CO->>CO: 권한 · 크레딧 확인
  alt 크레딧 부족
    CO-->>FE: 제보 불가 (댓글은 가능)
  else 충분
    CO->>DB: 제보 저장 (회차 · 발행본 버전 · 구절) · 상태 접수됨
    CO-->>FE: 접수 결과
    CO->>DB: 상태 분석 중
    CO->>CO: 발행본 버전 기준 공개 근거 범위만 추림
    CO->>AI: 분석 요청 (허용된 공개 문맥만)
    AI->>LLM: 분류 · 근거 대조 · 응답 생성
    alt AI 실패 · 시간 초과
      AI-->>CO: 실패
      CO->>DB: 상태 처리 실패 · 오류 로그
      CO-->>FE: 처리 실패 즉시 고지
      CO-)OP: 경고 (UC-21)
    else 성공
      LLM-->>AI: 결과
      AI-->>CO: 유형 · 응답안 · 수정안 제안
      CO->>DB: 사용 크레딧 기록 (차감 시점 미정)
      CO->>DB: 응답 · 다음 상태 (응답 완료 / 작가 검토 대기 / 수정 진행 중)
      CO-->>FE: 응답과 상태 표시
    end
  end
```
- 피드백 분석은 검증만 하며 세계관·설정을 바꾸지 않습니다(BR-11).
- AI Service는 DB·Gitea에 직접 쓰지 않습니다.
## 2. 표기 오류 수정안 자동 승인·발행 (UC-16 A4)
```mermaid
sequenceDiagram
  participant CO as Core API
  participant DB as DB
  actor W as 작품 소유자
  CO->>DB: 작품 설정 조회 (표기 오류 처리 방식)
  alt 작가 검토
    CO->>DB: 수정안 검토 대기
    CO-)W: 검토 요청 알림
  else 자동 승인·발행
    CO->>DB: 기준 버전 확인
    alt 기준 버전 변경됨
      CO->>DB: 수정안 검토 대기로 전환
      CO-)W: 검토 요청 알림
    else 일치
      CO->>DB: 자동 승인 · 초안 반영 (새 초안 버전)
      CO->>CO: UC-13 발행 확인
      CO->>DB: 재발행 · 수정안 발행 완료 · 피드백 처리 완료
      Note over CO: 재발행이므로 세계관 자동 업데이트 없음 (BR-11)
      CO-)W: 자동 처리 결과 알림 (변경 이력)
    end
  end
```
## 3. Fork 생성 (UC-08)
```mermaid
sequenceDiagram
  actor R as 독자
  participant FE as Frontend
  participant CO as Core API
  participant DB as DB
  participant GT as Gitea
  R->>FE: 분기 기준 회차 선택 · 제목 입력
  FE->>CO: Fork 생성 요청
  CO->>DB: Fork 허용 · 이용 조건 · 권리 제한 확인
  CO->>GT: 원작 세계관 공개 상태 확인
  alt 허용되지 않음
    CO-->>FE: 생성 불가 · 사유
  else 허용
    CO->>DB: 기준 회차까지 원고 버전 확정
    CO->>GT: 분기 시점의 공개 설정집·인물관계도 항목 고정
    Note over CO,GT: 고정 방식(복사·불변 참조·브랜치)은 미정
    CO->>DB: Fork 작품 생성 · 독자를 소유자로 지정
    alt 생성 실패
      CO->>DB: 부분 생성물 정리
      CO-->>FE: 생성 실패 안내
    else 성공
      CO-->>FE: Fork 작품 화면
    end
  end
```
## 4. AI 자율 연재 1회 실행 (UC-18)
```mermaid
sequenceDiagram
  participant TR as 실행 트리거 (방식 미정)
  participant CO as Core API
  participant DB as DB
  participant GT as Gitea
  participant AI as AI Service
  participant LLM as OpenAI
  actor W as 작품 소유자
  TR->>CO: 실행 시점 도래
  CO->>DB: 자율 연재 상태 · 한도 · 소유자 크레딧 확인
  alt 한도 · 크레딧 부족
    CO->>DB: 자율 연재 중단됨
    CO-)W: 중단 알림
  else 실행
    CO->>GT: 세계관 공개·허용 문맥 조회
    CO->>DB: 허용된 독자 반응 조회
    CO->>AI: 다음 회차 생성 요청
    AI->>LLM: 생성
    alt 생성 실패
      AI-->>CO: 실패
      CO->>DB: 오류 로그 (이번 회차 발행 안 함)
      CO-)W: 실패 알림
    else 생성 성공
      AI-->>CO: 회차 초안
      CO->>DB: 초안 저장 · 사용 크레딧 기록
      CO->>CO: UC-13 발행 확인
      CO->>DB: 새 회차 발행
      opt 세계관 업데이트 자동
        CO->>AI: 해당 회차 설정 추출 (UC-04)
        AI-->>CO: 추출 결과
        CO->>GT: 충돌 없는 항목 반영 · 변경 이력
      end
      CO-)W: 발행 결과 · 사용 크레딧 알림
    end
  end
```
- 스케줄러·worker 같은 실행 계층은 아직 승인되지 않았습니다. 도입 전 팀 공유가 필요합니다.
