# 펜시브 상세 기능 조사

기준일: 2026년 11월 2일. 펜시브는 원고 편집·설정 시트·플롯·캔버스·문서 관계를 하나의 작품 안에서 연결하는 집필 도구다. AI는 에이전트, 문장 다듬기, 시트 자동 채우기, 원고 리뷰로 나뉘며 각각 읽는 문맥·승인·사용량이 다르다. STORYFORK가 참고할 핵심은 이 연결과 검토 경험이다.

이 문서는 기능 색인과 중요한 제한을 정리한다. 조사 범위와 공식 페이지 목록은 [출처 색인](evidence.md)에 정리했다. 우리 프로젝트의 적용 순서·사용자 흐름·수용 기준은 [별도 적용 제안](STORYFORK-적용-제안.md)을 따른다.

## 조사 범위와 확인 수준

- 한국어 공식 문서 목차 100개 URL을 수집하고 영역별 본문을 조사했다. [한국어 목차](evidence.md), [편집기·프로젝트 영역 46개](evidence.md), [구조·확장·공유 영역 21개](evidence.md).
- 영어 문서 100개 본문을 수집했다. 본문 수집 실패는 없었다. [영어 문서 자료](evidence.md).
- 홈페이지, 요금제·다운로드·변경 이력·블로그 목록과 블로그 상세 12편을 조사했다. 변경 이력은 한 URL에 공지 53건의 본문이 담겨 있다. 공지 53건을 고유 페이지 53개로 세지 않는다.
- 커뮤니티 목록, 공개 플러그인 14개 상세와 테마·템플릿 목록을 확인했다. 관찰 시 목록 수치는 테마 64개·플러그인 14개·템플릿 0개다. 테마 64개 상세를 전수 조사한 것은 아니다.
- 웹 앱과 대시보드는 로그인 화면까지 확인했다. 로그인·가입·결제·설치·원고 생성·AI 실행은 하지 않았다. 홈페이지 제품 화면은 홍보 시연이며 실제 편집기 검증과 구분한다.
- 원문을 읽은 사실과 그 문서가 설명하는 앱 동작을 구분한다. 성능·보안·암호화·학습 제외에 관한 회사 설명은 독립적으로 검증하지 않았다.

## 기능 전체 지도

| 영역 | 확인한 기능 | 공식 근거 |
|---|---|---|
| 시작과 작품 | 작품 생성·여러 작품 관리, 작품 홈, 폴더·파일 계층 | [작품 홈](https://docs.pensiv.so/ko/project/home), [여러 작품](https://docs.pensiv.so/ko/project/all-projects) |
| 탐색 | 파일/폴더 보기, 그리드·리스트·이어읽기·타임라인, 다중 선택, 탭, 분할 보기 | [폴더 보기](https://docs.pensiv.so/ko/project/folder-views), [분할 보기](https://docs.pensiv.so/ko/project/split-view) |
| 분류와 찾기 | 라벨·상태, 사이드바 필터, 검색 문법, 명령 팔레트, 휴지통·복구 | [필터](https://docs.pensiv.so/ko/project/sidebar-filter), [검색 문법](https://docs.pensiv.so/ko/reference/search-syntax) |
| 본문 편집 | 서식·타이포그래피, 이미지, 툴바 설정, 특수문자, 집중 모드 | [편집기](https://docs.pensiv.so/ko/writing/editor-basics), [서식](https://docs.pensiv.so/ko/writing/formatting) |
| 조판 | 편집기 프리셋·문서별 설정, 페이지 뷰·페이지 설정, 확대 | [프리셋](https://docs.pensiv.so/ko/writing/editor-presets), [페이지 뷰](https://docs.pensiv.so/ko/writing/page-view) |
| 교정·수정 | 네이티브/AI 맞춤법, AI 선택 영역 다듬기 | [맞춤법](https://docs.pensiv.so/ko/writing/spell-check), [AI 다듬기](https://docs.pensiv.so/ko/writing/ai-rewrite) |
| 문서 보조 | 문서 노트, 코멘트, 버전 기록·수동 버전·복원 | [노트](https://docs.pensiv.so/ko/writing/document-notes), [코멘트](https://docs.pensiv.so/ko/writing/comments), [이력](https://docs.pensiv.so/ko/writing/history) |
| 설정 시트 | 캐릭터·이벤트·조직·아이템·장소·세계관·기타 분류, 본문·설명·속성·이미지 | [시트](https://docs.pensiv.so/ko/structure/sheets), [속성](https://docs.pensiv.so/ko/structure/sheet-properties) |
| 속성 | 텍스트, 다중 태그, 문서 참조, 분류별 시트 참조, 속성 구성 상속·숨김 | [속성](https://docs.pensiv.so/ko/structure/sheet-properties) |
| 자동 채우기 | 시트 본문에서 텍스트·태그 속성 추출, 설명 생성 | [자동 채우기](https://docs.pensiv.so/ko/structure/autofill) |
| 플롯 | 플롯보드→플롯 카드→파트 카드, 파트의 태그·파일 언급 | [플롯보드](https://docs.pensiv.so/ko/structure/plotboard), [카드](https://docs.pensiv.so/ko/structure/plot-cards) |
| 타임라인 | 폴더 항목 차례와 라벨별 줄, 드래그로 순서·라벨 변경, 가로/세로 | [타임라인](https://docs.pensiv.so/ko/structure/timeline) |
| 캔버스 | 노트·파일·이미지 배치, 도형·선·화살표·그리기 | [캔버스](https://docs.pensiv.so/ko/structure/canvas), [그리기](https://docs.pensiv.so/ko/structure/canvas-drawing) |
| 관계 탐색 | 멘션·시트 연결·포함 관계로 그래프 생성, 이웃 강조·종류 필터·배치 설정 | [관계 그래프](https://docs.pensiv.so/ko/structure/graph), [백링크](https://docs.pensiv.so/ko/structure/backlinks) |
| 구상 보조 | 독립 노트, 작업·보관함, 자료 조사용 내장 브라우저 | [노트](https://docs.pensiv.so/ko/structure/notes), [작업](https://docs.pensiv.so/ko/structure/tasks), [브라우저](https://docs.pensiv.so/ko/structure/browser) |
| AI 에이전트 | 작품 파일 검색·읽기·생성·수정·삭제, 관계·라벨·상태 조작, 웹 검색 | [개요](https://docs.pensiv.so/ko/agent/overview) |
| 대화 운영 | 기본/질문/계획 모드, 맥락 칩·@파일·폴더, 슬래시 명령, 대화 관리 | [첫 실행](https://docs.pensiv.so/ko/agent/first-run), [스레드](https://docs.pensiv.so/ko/agent/threads) |
| AI 맞춤화 | 작품별 지침, 메모리, 스킬, 외부 AI 앱용 MCP | [지침](https://docs.pensiv.so/ko/agent/scope), [메모리](https://docs.pensiv.so/ko/agent/memory), [스킬](https://docs.pensiv.so/ko/agent/skills), [MCP](https://docs.pensiv.so/ko/agent/mcp) |
| AI 리뷰 | 원고 감평·점수, 리뷰 관점·독자층·톤, 참고 문서 | [리뷰](https://docs.pensiv.so/ko/ai-review/overview), [설정](https://docs.pensiv.so/ko/ai-review/settings) |
| 확장 | 파일 템플릿 저장·사용, 테마, 플러그인·패널, 커뮤니티 | [템플릿](https://docs.pensiv.so/ko/extend/templates), [플러그인](https://docs.pensiv.so/ko/extend/plugins) |
| 공유 | 문서·시트·플롯보드·캔버스 공개 링크, 공유 목록·중단 | [공유 링크](https://docs.pensiv.so/ko/collaborate/share-links) |
| 저장 | 작품별 클라우드 동기화, 오프라인, 자동 백업, 작품 전체 내보내기 | [동기화와 백업](https://docs.pensiv.so/ko/settings/sync-and-backup), [데이터 내보내기](https://docs.pensiv.so/ko/settings/data-export) |
| 원고 이동 | 기존 원고·Scrivener 이전, DOCX·PDF·EPUB·Markdown·HWP·텍스트 내보내기 | [가져오기](https://docs.pensiv.so/ko/project/import), [내보내기](https://docs.pensiv.so/ko/project/export), [HWP](https://docs.pensiv.so/ko/project/export-hwp) |
| 운영과 통계 | 집필 통계, 계정·프로필·보안·알림, 플랜·사용량·크레딧 | [통계](https://docs.pensiv.so/ko/account/analytics), [AI 사용량](https://docs.pensiv.so/ko/agent/usage) |
| 플랫폼 | 웹·데스크톱·모바일, 데스크톱 창·트레이·가림·반투명 | [다운로드](https://pensiv.so/ko/download), [창 동작](https://docs.pensiv.so/ko/desktop/window) |

## AI 네 기능의 실제 차이

### 에이전트

현재 작품 안의 파일과 구조를 다룬다. 기본 모드는 검색·편집, 질문 모드는 읽고 답하기, 계획 모드는 먼저 계획한 뒤 승인 후 실행한다. 파일 생성·수정·삭제 직전에 승인 카드를 보여주고 이번만·세션·항상 허용·거부를 선택한다. 승인 대기 여러 건의 전체 거부도 있다. [개요](https://docs.pensiv.so/ko/agent/overview).

열려 있는 파일이 기본 맥락 칩으로 붙고 파일·폴더를 직접 추가할 수 있다. 폴더는 보낼 때 파일로 펼쳐진다. 칩을 직접 고른 것과 작품 안 다른 파일을 검색할 수 있는 권한은 별개다. 칩에 없는 파일을 절대 읽지 않는다고 설명하면 부정확하다. [첫 실행](https://docs.pensiv.so/ko/agent/first-run).

홈페이지 설정 검색 시연에는 검색 결과와 페이지 열기가 표시된다. 다만 모든 답변의 근거 인용을 보장하는 계약이나 에이전트의 일괄 수정 전체를 한 번에 되돌리는 절차는 확인하지 못했다. [홈페이지](https://pensiv.so/ko).

### 문장 다듬기

선택 구간을 고치고 원문과 비교해 통째로 적용·취소·재생성한다. 적용 전까지 원고는 바뀌지 않는다. 적용 후 한 번의 실행 취소가 가능하며 제안이 열린 동안 원문이 바뀌면 적용하지 않는다. 한 번에 4,000자·40문단 제한이고 표·이미지·멘션·구분선·코드가 섞인 선택은 처리하지 못한다. [문장 다듬기](https://docs.pensiv.so/ko/writing/ai-rewrite).

참고 문맥은 선택 구간 외에 앞뒤 약 800자·제목·문체 표본·주변 이름과 연결되는 시트 속성을 포함할 수 있다. 다른 원고 문서를 전부 읽는 기능은 아니다. 에이전트 크레딧과 별도인 일일 횟수를 쓴다. 지시대로 사실을 보존한다는 설명은 모델 품질을 직접 검증한 결과가 아니다.

### 시트 자동 채우기

시트 본문 앞부분 약 8,000자와 제목·분류를 읽어 텍스트·태그 속성을 제안한다. 연결형 속성을 자동으로 채우는 기능과 구분한다. 속성 제안은 행별 유지·되돌리기가 가능하지만, 설명 생성은 확인 단계 없이 기존 설명을 덮어쓴다고 문서가 설명한다. 에이전트 크레딧은 사용하지 않으며 쿨다운과 일일 제한이 있다. [자동 채우기](https://docs.pensiv.so/ko/structure/autofill).

### 원고 리뷰

현재는 웹소설 형식의 문서 하나를 대상으로 감평·점수를 제공한다. 참고 문서는 최대 4개이며 다른 회차를 스스로 찾아 읽지 않는다고 명시한다. 관점·독자층·톤을 설정할 수 있다. 실행 시 원고 스냅샷을 읽으며 이후 편집은 같은 리뷰에 반영되지 않는다. 리뷰 도중 패널을 닫거나 전환하면 미완료 결과가 폐기될 수 있다. [개요](https://docs.pensiv.so/ko/ai-review/overview), [실행](https://docs.pensiv.so/ko/ai-review/run), [설정](https://docs.pensiv.so/ko/ai-review/settings).

블로그는 설정 충돌 검사·일관성 관리를 제품 기능으로 주장한다. 특히 노벨라 대안 글에는 모순 자동 감지, AI Ask로 자동 검사, 문서 간 설정 연결 상태의 실시간 추적을 명시한다. 따라서 경쟁 기능 목록에는 **자동 설정 모순 검사에 대한 제품 주장**을 포함해야 한다. 전 회차·전 설정을 상시 검사하는 구현·정확도·실제 동작을 검증한 것은 아니다. [노벨라 대안](https://pensiv.so/ko/blog/novela-alternative), [일관성 관리](https://pensiv.so/ko/blog/professional-writers-consistency). 글별 세부 기능과 사용 사례는 [블로그 재조사](블로그-기능-재조사.md)를 참조한다.

## 플롯과 설정의 연결 구조

블로그는 캐릭터 속성·등장 기록 자동 추적, 등장 회차·마지막 등장 기록, 우호·적대·혈연 관계의 변화 추적도 제품 기능으로 설명한다. 이는 상세 문서 중심 색인에서 충분히 드러나지 않았던 주장이다. 다만 회차를 지정해 그때의 능력·소유물·지식을 조회하는 기능이나 관계 변화 전용 이력 화면까지 확인한 것은 아니다. [스크리브너 대안](https://pensiv.so/ko/blog/scrivener-alternative), [일관성 관리](https://pensiv.so/ko/blog/professional-writers-consistency).

플롯 카드 아래에 파트 카드가 속한다. 파트 카드의 태그·언급 필드로 문서·시트·플롯보드·캔버스를 연결한다. 캐릭터는 캐릭터 분류의 시트로 연결한다. 부모의 연결·태그가 자식에게 자동 상속된다고 문서가 보장하지 않는다. [플롯 카드](https://docs.pensiv.so/ko/structure/plot-cards).

본문 @멘션은 방향 있는 참조, 시트의 연결 속성은 양방향 저장, 하위 파일·플롯 카드의 소속은 포함 관계다. 관계 그래프는 이를 시각화한다. 자유 캔버스의 선과 세계관 속 인물 감정 관계를 모두 동일하게 해석하면 안 된다. [그래프](https://docs.pensiv.so/ko/structure/graph).

하위 시트 생성 시 부모 속성의 이름·유형·순서·숨김 상태를 가져오지만 값은 비어 있다. 태그는 후보를 공유한다. 값까지 포함하는 파일 템플릿과 다르다. [시트 속성](https://docs.pensiv.so/ko/structure/sheet-properties).

타임라인은 폴더 안의 항목 순서를 칸으로, 라벨을 줄로 표현한다. 날짜 기반 사건 판정이나 인물 지식 시점 관리가 확인된 것은 아니다. [타임라인](https://docs.pensiv.so/ko/structure/timeline).

## 플러그인 14개

관찰 시 공개 목록의 전체 14개다. 기본 제품 기능과 설치형 확장을 구분한다. 개별 페이지가 설명하는 동작이며 설치 검증은 하지 않았다. [전체 목록](https://pensiv.so/ko/community/plugins).

| 이름 | 기능 | 링크 |
|---|---|---|
| 복선 | 문장에 심기·회수 지점을 연결하고 미회수 항목 확인 | [상세](https://pensiv.so/ko/community/plugins/foreshadowing) |
| 집필 시간 | 실제 집필 시간의 위젯·트레이·시트 표시 | [상세](https://pensiv.so/ko/community/plugins/writing-time) |
| 부산대 맞검기 | 사용자 키로 맞춤법·띄어쓰기·문법 검사 | [상세](https://pensiv.so/ko/community/plugins/pnu-speller) |
| 상태창 | 인물에 속한 타입 있는 능력치, 변화 화살표, 프리셋 6종 | [상세](https://pensiv.so/ko/community/plugins/status-window) |
| 단락 분석 | 시작 기호 기반 대사·독백·특수 대사·묘사 분류와 분량 | [상세](https://pensiv.so/ko/community/plugins/paragraph-analysis) |
| 뽀모도로 | 집중·휴식 사이클과 타이머 | [상세](https://pensiv.so/ko/community/plugins/pomodoro-basic) |
| 캔버스 체크리스트 | 캔버스 안의 체크박스 카드와 진행률 | [상세](https://pensiv.so/ko/community/plugins/canvas-checklist) |
| 날짜 계산기 | 인물 나이·기간·날짜 연산, 결과 삽입 | [상세](https://pensiv.so/ko/community/plugins/date-calculator) |
| 위험한 글쓰기 | 입력 중단 시 원고를 지우는 연습 모드 | [상세](https://pensiv.so/ko/community/plugins/dangerous-writing) |
| 단위 변환 | 현대 단위와 척관법 변환 | [상세](https://pensiv.so/ko/community/plugins/unit-converter) |
| 계산기 | 계산·메모리·기록·결과 본문 삽입 | [상세](https://pensiv.so/ko/community/plugins/calculator) |
| No Backspace | 목록에 등록된 입력 제약 확장 | [상세](https://pensiv.so/ko/community/plugins/no-backspace-cfrv10) |
| Char Count Log | 글자 수와 집필 세션 통계 관련 확장 | [상세](https://pensiv.so/ko/community/plugins/char-count-log) |
| 드롭캡 | 문단 첫 글자 장식·테마 연동·크기 조절 | [상세](https://pensiv.so/ko/community/plugins/theme-cr1j21) |

단락 분석은 문장의 의미를 AI로 이해해 분류하는 기능이 아니다. 시작 기호에 따른 규칙 기반 집계다. 위험한 글쓰기는 내용 보존을 중시하는 STORYFORK의 기본 집필에 가져올 기능으로 추천하지 않는다.

## 저장과 공유에서 주의할 점

`실시간 협업` 문서 제목과 달리 본문은 작품별 동기화·다른 기기 이어쓰기를 설명한다. 초대·역할·동시 커서 등 다중 사용자 공동편집을 그 문서만으로 확인할 수 없다. 오프라인 충돌은 최종 쓰기 우선으로 설명하며 모든 변경을 자동 병합해 보존한다고 볼 수 없다. [협업 문서](https://docs.pensiv.so/ko/collaborate/realtime), [오프라인](https://docs.pensiv.so/ko/desktop/offline).

공유 링크는 문서·시트·플롯보드·캔버스에 제공하며 폴더는 공유하지 못한다고 설명한다. 이는 STORYFORK의 회차별 설정 공개·Fork 허용·독립 세계관 생성과 다른 기능이다. [링크 공유](https://docs.pensiv.so/ko/collaborate/share-links).

버전 복원 직전의 미저장 현재 원고를 자동으로 따로 보존하는 것으로 설명하지 않는다. 수동 버전 저장을 먼저 하라는 안내가 있다. 버전 개수·기간은 플랜에 따라 다르다. [버전 기록](https://docs.pensiv.so/ko/writing/history).

`.pnsv` 전체 백업은 압축·암호화되며 만든 계정 로그인으로 복구한다고 설명한다. 계정과 독립적으로 복구 가능한 장기 보존 형식이라고 단정할 수 없다. 데스크톱의 로컬 전용 설명을 웹의 완전한 오프라인 보장으로 확대하지 않는다. [전체 데이터](https://docs.pensiv.so/ko/settings/data-export), [백업](https://docs.pensiv.so/ko/settings/sync-and-backup).

회사는 AES 저장 암호화·기업용 AI API·학습 제외 등을 설명한다. 이를 종단간 암호화·요청 데이터 미보관·인증 구현의 독립 검증과 같은 의미로 쓰지 않는다. [개인정보 정책](https://pensiv.so/ko/privacy), [콘텐츠 이용 정책](https://pensiv.so/ko/content-use-policy).

## 관찰한 요금과 제한

금액·한도는 조사 시점의 표시이며 이후 변경될 수 있다. [현재 요금표](https://pensiv.so/ko/pricing).

| 항목 | Free | Basic | Plus | Pro | Pro+ | Ultra |
|---|---:|---:|---:|---:|---:|---:|
| 월 결제 | 무료 | 4,900원 | 9,900원 | 24,900원 | 89,000원 | 290,000원 |
| 연 결제의 월 환산 표시 | 무료 | 3,908원 | 8,250원 | 20,750원 | 74,167원 | 241,667원 |
| AI 리뷰 하루 | 3 | 20 | 20 | 50 | 100 | 무제한 |
| AI 리뷰 월 | 10 | 60 | 60 | 200 | 500 | 1,200 |
| 문장 다듬기 하루 | 3 | 6 | 6 | 200 | 무제한 | 무제한 |
| 파일당 버전 수 | 10 | 100 | 200 | 200 | 500 | 500 |
| 버전 보관 기간 | 60일 | 120일 | 무제한 | 무제한 | 무제한 | 무제한 |
| 이미지 한 장 | 5MB | 50MB | 50MB | 50MB | 50MB | 50MB |
| MCP | 미포함 | 미포함 | 포함 | 포함 | 포함 | 포함 |

Ultra의 리뷰 하루 무제한은 월 한도도 없다는 뜻이 아니다. 연 결제 월 환산 금액을 12배해 정확한 청구 원금이라고 보고하지 않는다. Plus 연 99,000원은 10월 8일 공지에서 확인했다. 프로젝트 수·총 문서 수·총 저장공간의 수치 제한이 확인되지 않았다고 무제한으로 쓰지 않는다.

에이전트 크레딧·리뷰 횟수·문장 다듬기·맞춤법은 별도 사용량 체계다. AI 사용량 화면은 플랜·세션·오늘 사용량·선불 잔액과 한도 경고를 보여준다. [사용량](https://docs.pensiv.so/ko/agent/usage).

## 변경 이력과 문서 불일치

최신 공지는 2026년 10월 22일 원형 관계 그래프·프로필 게시·사용자 지정 단축키·분리 창이다. 10월 8일은 Plus·국내 결제, 9월 28일은 사이드바 필터·파일 고정·제목 접기, 9월 8일은 문장 다듬기·자동 채우기·페이지 뷰 확장이다. 53건 공지를 확인했으며 전체 날짜·버전·변경 내용은 공식 변경 이력에서 확인할 수 있다. [공식 변경 이력](https://pensiv.so/ko/changelog).

- MCP 문서는 Pro 이상이라고 남아 있지만 최신 요금표와 10월 8일 공지는 Plus 이상이다. 현재 요금 판단은 더 최신 자료를 우선하고 차이를 표시한다.
- 일부 요금·AI 기능 문서는 Plus 열을 누락했다. 현재 6개 플랜 비교는 요금표로 확인한다.
- 과거 공지와 현재 버전 보관 일수가 다를 수 있다. 예를 들어 과거 Basic 365일을 현재 정책으로 재사용하지 않는다.
- 모바일의 정식 출시를 설명하는 6월 2일 공지와 그보다 앞선 블로그의 정식 표현이 다르다. 블로그만으로 출시 시점을 판단하지 않는다.
- 블로그의 자동 설정 충돌 방지·효율 개선·작가 사례는 회사의 마케팅 설명이다. 구현 계약이나 측정된 성능으로 취급하지 않는다.

## 우리 프로젝트로 가져올 것

1. 원고 옆에서 설정을 검색하고 여는 참고 패널.
2. AI가 읽을 자료·기준 회차·대상 인물을 확인하는 문맥 표시.
3. 기존 값과 후보·근거를 비교하고 채택하는 검토 화면.
4. 멘션·백링크와 인물 관계를 구분한 설정 탐색.
5. 확정 버전 조회·비교·새 버전 복원.
6. 집필 기반이 갖춰진 뒤 플롯·파트·회차·인물 연결.
7. 후속 후보로 복선 심기·회수, 상태 변화, 기본 집필 통계.

구현 우선순위와 세부 수용 기준은 [STORYFORK 적용 제안](STORYFORK-적용-제안.md)에 정리했다. 독자 Fork의 기준 회차·공개 정보·최초 세계관 수정 후 독립·원본 변경 선택 반영은 우리 최신 설계를 따라야 한다. 펜시브 공개 자료에서 같은 전체 흐름을 확인하지 못했지만 제품에 절대 없다고 단정하지 않는다.
