# 세 작가 도구 비교와 STORYFORK 참고점

> 조사 기준: **2026-11-01**. 외부 서비스의 직접 조작·공식 문서·미확인 범위를 구분한다. 화면이나 공식 설명의 확인은 내부 구현 또는 실제 모델 요청 전체의 검증이 아니다. Plottr는 요청에 따라 제외했다.

## 한눈에 보는 차이

| 비교 항목 | Novelcrafter | Sudowrite | 스토라이즈 |
|---|---|---|---|
| 중심 흐름 | 장면을 구조화하고 Codex와 함께 집필 | Story Bible과 AI 집필·편집 | 세계관을 만들고 이용자별 전개를 플레이·열람 |
| 입문 | 작품 → Plan의 Act·Chapter·Scene → Codex → Write | 프로젝트·문서 → Story Bible → 작성·AI 도구 | 세계관 만들기 → 소개·세계관·인물·도입부·플레이가이드·설정 |
| 설정 | **[실측]** 인물·장소 등 Codex 항목, 별칭·관계·등장 추적 | **[실측]** Character·Worldbuilding 등 Story Bible | **[실측]** 세계관 자유 텍스트와 인물 이름·설명·이미지 설정 |
| 설정 변화 | **[실측]** 장면에 Progression 연결 UI. **[공식문서]** 해당 장면과 이후의 AI 문맥에 반영. 실제 앞뒤 요청 비교는 미검증 | 필드·챕터 설정과 Story Bible 참조. 회차별 인지 상태 관리 기능은 이번 범위에서 미확인 | 인물 스포일러 방지 선택 UI. 인지 회차·버전 고정은 이번 범위에서 미확인 |
| AI 문맥 | **[실측]** 원고·장면·Codex 선택 및 프롬프트 Preview. Codex 칩을 선택한 Chat 응답 성공(항목별 실제 전달·활용은 미확인) | **[실측]** 결과의 `Looked at`, Chat의 `#` 멘션. 전체 실제 요청 내용은 미검증 | **[실측]** 세계관·인물 입력과 모델·출력 배수. 서버의 실제 생성 문맥은 미검증 |
| 집필·제안 | **[실측]** Scene Beat 지시·길이·문맥 UI. 정상 생성과 결과 채택은 미완료 | **[실행]** Write·Rewrite·Quick Edit·Brainstorm·Chat. 결과 카드 또는 원문·수정안 비교 | **[실측]** 플레이 미리보기 입력 및 텍스트 모델 선택. 생성 시도는 무응답 |
| 결과 채택 | AI Chat 응답 확인. Scene Beat 생성은 잘못 시작돼 중단·Discard, 정상 채택 미검증 | **[실행]** Quick Edit Reject 후 원문 보존. Accept는 미검증 | **[미검증]** AI 결과가 나타나지 않아 원고 반영을 시험하지 못함 |
| 독자 전개 | 이번 범위에서는 독자 Fork·발행 검증하지 않음 | 이번 범위에서는 독자 Fork·발행 검증하지 않음 | **[실측]** 하나의 공개 세계관 아래 서로 다른 작성자의 전개 2개 및 회차 열람. 실제 이어쓰기 생성은 미검증 |
| 비용 | 서비스 체험과 외부 AI API 비용은 별도 | 체험 크레딧 및 기능별 차감; 일부 도구의 기본 모드 무료 안내 | 샤프심과 모델·출력 배수에 따라 화면상 단가 표시 |
| 공개·권리 | 출판·공개·권한 경로는 이번 조사에서 미검증 | 공유·발행은 시험하지 않음 | **[실측]** 신규 세계관 공개 기본값은 공개. 제작 UI와 약관의 비공개 전환 설명이 달라 확인 필요 |

세부 버튼과 절차는 [Novelcrafter](novelcrafter.md), [Sudowrite](sudowrite.md), [스토라이즈](storize.md) 명세를 따른다.

## STORYFORK와 비교하는 기준

**[현재]** [아키텍처 문서](../../architecture.md)는 시작 화면과 Core·AI Health 연결 중심의 개발 기반을 설명하며 STORYFORK 업무 기능은 미구현이다.

**[MVP 설계]** [설계 문서](../../design/design.md)의 목표는 다음과 같다.

1. 작가가 기존 원고를 회차별로 등록하고, AI가 추출한 설정 후보를 검토·채택한다.
2. 세계관 항목과 관계를 관리하고, 버전·체크포인트와 인물별 인지 범위를 고려한다. 설정은 항목별 공개·비공개 및 회차별 공개 범위를 적용한다(DEC-36).
3. 기준 회차와 인물 지식을 바탕으로 다중 인물 시뮬레이션을 실행하고, 작가가 결과를 선택해 AI 집필 제안을 검토한다.
4. 독자는 허용된 기준 회차에서 작품 Fork를 만든다. 세계관은 수정 전 허용된 원본 변경을 따르고, 최초 수정으로 독립시킨 뒤에는 원본 변경 알림에서 반영 여부를 선택한다(DEC-32·34).
5. 댓글·제보와 작가 확인을 제공한다. 콘텐츠 확정 버전·되돌리기는 MVP 방향이며, 설정 충돌 검사 UC-12·유료 공개·앱 내 크레딧 등은 MVP 이후다. [설계](../../design/design.md)의 포함·제외 표와 DEC-26~30을 우선한다.

## 참고할 만한 UX — 제안이지 확정 범위가 아님

| 관찰 | STORYFORK에 적용해 볼 질문 | 현 설계와의 경계 |
|---|---|---|
| Novelcrafter에서 장면·인물·장소를 교차해서 확인 | 현재 회차에서 등장하는 항목과 갱신 기록을 쉽게 찾을 수 있는가? | 별도 Matrix나 그래프 UI는 이번 조사만으로 MVP 필수라고 확정하지 않는다. |
| Novelcrafter에서 문맥 선택 및 Preview, Sudowrite에서 `Looked at`을 표시 | 기준 회차와 허용된 인물 지식이 무엇인지 사용자에게 어떻게 설명할까? | 화면상 표시와 실제 서버의 권한·문맥 차단은 별개다. |
| Sudowrite Quick Edit에서 원문과 수정안을 나란히 비교 | AI 제안 채택 전에 변경 범위를 이해하기 쉽게 보여줄 수 있는가? | 결과 검토·채택은 MVP 목표지만 별도 고급 diff 편집기나 충돌 검사는 확정된 범위가 아니다. |
| 스토라이즈에서 세계관 아래 여러 전개를 둘러봄 | 원작과 독자 Fork의 기준 회차 및 독립 관계를 어떻게 이해시키는가? | 스토라이즈의 내부 버전 고정 방식을 검증한 것은 아니다. |
| 스토라이즈의 신규 공개 기본값과 공개 취소 안내 | 공개 여부·권리·되돌릴 수 있는지 먼저 명확히 안내할 필요가 있는가? | 우리 서비스의 기본 공개값이나 취소 정책이 확정됐다는 뜻이 아니다. |
| Sudowrite에서 일부 표현의 의미 변화와 새 인물명 생성 | 제안을 받아들이기 전 사실관계와 미지 정보를 어떻게 검토할까? | 실제 소수 샘플에서 관찰한 사례이며 정확도 통계가 아니다. |

## 남은 확인

- **Novelcrafter:** 정상적인 Scene Beat 생성·채택, Progression 전후 모델 요청 비교, 장면 요약과 다양한 프롬프트의 실제 결과.
- **Sudowrite:** Quick Edit Accept, Allow edits 실제 수정, Scene/Draft 자동 생성, Series 동기화, 파일 가져오기·내보내기 품질.
- **스토라이즈:** 비공개 미리보기 AI 응답과 실제 요청 상태·오류 원인, 공개 이후 변경, 실제 이어쓰기·인물 숨기기 동작.
- **공통:** 서비스별 전체 버튼·계정 등급·결제 방식·숨겨진 하위 기능을 전수 검증하지 않았다. 직접 확인하지 못한 기능의 존재 여부를 단정하지 않는다.

## 공통 출처

- [Novelcrafter: 문서 색인](https://www.novelcrafter.com/help/docs), [Codex Tracking](https://www.novelcrafter.com/help/docs/codex/codex-tracking), [Progressions](https://www.novelcrafter.com/help/docs/codex/progressions-additions)
- [Sudowrite: Quick Start](https://docs.sudowrite.com/getting-started/dQph1snuwbfMWG9wRjsNug/quick-start/2A4FjtiocrtxHPUyz6WZgR), [Story Bible](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC), [Quick Edit](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/quick-edit/2asL35fds36oHAFJN7bYzz)
- [스토라이즈 탐색](https://storize.kr/novel-explore), [스토라이즈 서비스 이용약관](https://storize.kr/policy/service)
- [STORYFORK MVP 설계](../../design/design.md), [현재 아키텍처](../../architecture.md)
