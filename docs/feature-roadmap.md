# STORYFORK 기능 분류표

[메인 README](../README.md) · [문서 목록](README.md)

> 예시 이미지처럼 **서비스 → 서브시스템 → 중간 기능 → 세부 기능**을 계층으로 묶고, **세부 동작 하나당 한 행**으로 정리한다. 현재 구현과 앞으로 개발할 전체 서비스 기능을 함께 포함한다.

## 표 기준

> **서비스 열은 DEC-41의 목표 소유권이다.** [서비스 경계·실행 구조](design/service-boundaries.md)를 따른다. 기존 ✅는 해당 동작의 종전 구현 근거이지 새 서비스로의 이전 완료가 아니다. Core→Content 업무·테스트·인증 확인·라우팅·이미지/CI 연결은 소스에 반영했으며 hosted CI·실제 DB 전환·배포는 대기다. 아래 이전 기능의 ✅를 이번 추출 완료로 승격하지 않는다. LLMOps는 운영 영역으로 분류하되 Langfuse 자체 UI와 운영 화면 API 통합은 미정이며 Spring 내부 구현을 뜻하지 않는다. 정기 작업 행은 운영의 감시·관리 관점이고 실제 실행은 업무 소유 서비스에 둔다.


- **개발 완료:** ✅는 해당 세부 동작을 명시적으로 구현한 PR이 병합됐고 그 PR 최신 head의 `Required CI` 성공을 확인한 항목이다. ❌는 미구현·부분 구현·열린 PR·병합 없는 종료·완료 근거 미확인을 포함한다. ❌가 코드가 전혀 없다는 뜻은 아니다.
- ✅는 표에 적힌 동작의 개발 반영 기준이며 운영 배포·전체 사용자 흐름의 수용 완료가 아니다. PR #93의 보호 흐름 브라우저 E2E 등 PR에 남은 검증 한계는 유지된다. 설정 이미지·표지·원고 이미지는 각각의 지원 동작을 구분한다. 원고 이미지는 버전 보존용 불변 파일이므로 일반 파일처럼 교체·물리 삭제 CRUD를 강제하지 않는다.
- `#52`는 이슈, `PR #71`은 Pull Request다. 링크가 여러 개여도 관련 범위만 추적하며 PR 상태·세부 한계는 아래 PR 목록을 따른다. 열린 원래 이슈를 임의로 종료하지 않는다.

- 서브시스템은 회원 관리·세계관 관리·Fork 관리 같은 업무 분류다. 서비스 열은 Core·콘텐츠·운영·AI 및 클라이언트의 목표 책임을 나타낸다. 콘텐츠 서비스 + AI 서비스는 콘텐츠의 인가·기록·승인·반영과 AI의 생성·실행이 함께 필요한 기능이다. 업무 분류마다 서버를 추가하지 않는다.
- 같은 서브시스템·중간 기능은 셀을 병합했다. 관련 이슈도 중간 기능 단위로 묶고 기존 이슈·PR 링크를 중복 없이 모았다.
- 현재/향후·범위 열은 삭제했다. GitHub 이슈 링크는 관련 범위의 추적 근거이며, 그 이슈가 해당 칸의 모든 세부 정책을 확정하거나 구현을 완료했다는 뜻은 아니다.
- 삭제 정책은 DEC-42로 확정했다. 작품·회차·세계관·Fork·댓글·피드백·운영 데이터는 소프트 삭제, 초안·참조 없는 첨부·알림은 하드 삭제다. 세계관·설정·상태는 이력 보존·revert 원칙을 적용한다. #132 최신 사용자 결정의 관계만 MVP 예외로 Neo4j 현재 상태를 교체·제거하고 관계 이력·시점 복원을 지원하지 않는다. 기존 SQL/데이터·인물/설정/원고 버전은 보존한다.
- 향후 기능도 포함하지만 미정인 API·스키마·가격·한도·MVP 포함 여부를 확정하지 않는다. 중간 기능 이름 앞의 두 자리 번호는 기능 묶음 번호다. `#숫자` 링크는 실제 GitHub 이슈다.
- LLMOps는 전체 서비스 개발 대상으로 명시했으며 이번 문서 변경으로 Langfuse 설치·연동 또는 평가 구현이 완료되는 것은 아니다. 프롬프트·모델 변경이 과거 생성 결과를 바꾸지 않으며, 추적에는 원고 전문·비공개 설정·개인정보·키를 기록하지 않는다. 원고 이미지의 목록·대체 텍스트·참조 제거는 이번 완료 근거를 확인하지 않아 ❌로 유지했다.
- 검색·랭킹·홈 편성은 기존 데모 화면을 기준으로 분류했다. 최신 순·인기 순·조회 순은 작품 정렬이지 검색어 순위가 아니다. 실시간·24시간·주간 문구만으로 실제 기간 집계 구현을 인정하지 않는다. 인기 검색어는 추가 검토로 도입 미확정이며, 별도 검색 MSA·검색 엔진을 이 표로 확정하지 않는다.
- 중간 기능 또는 세부 기능의 `(Draft 검토 후보)` 표시는 채택 미확정을 뜻한다. 다른 기능과 같은 표 안에 있어도 구현·정책 채택이 확정된 것은 아니며 관련 PR과 검토 근거를 확인한다.
- 중간 기능 통합: 58→05, 49→20, 52→21-C, 79→31, 82→34, 81→40-D. 21은 좋아요(21-A)·관심 작품(21-B)·독서 기록(21-C)으로 구분했다. 기존 기능은 삭제하지 않았으며, 05·08의 Draft 보완 동작은 해당 세부 행에 후보 표시를 유지한다.
- WorldStudio는 같은 contentDataSource와 전용 EntityManager/TransactionManager를 사용한다. #132의 Content HTTP·프론트 HTTP DI·Neo4j 현재 관계 CRUD/관계도 연결은 소스 구현이며 기존 관계 SQL/데이터는 보존한다. pending·불일치·미전환은 성공/빈 관계로 숨기지 않는다. 관계 이력/시점 복원·전체 세계관 restore는 미지원이며 카드 revision은 관계를 not_recorded로 반환한다. [현재 계약](design/worldstudio-independent-schema.md#현재-관계-mvp-계약--132)을 따른다.
- 작품 삭제 PR #106은 병합됐고(develop `f46be23`, `Required CI` #160 성공 확인) 소유자·이력 없는 원작 범위만 ✅로 둔다. 이후 DEC-42에 따라 작품 삭제는 소프트 삭제(`work.deleted_at`)로 바뀌어 설정·저장 버전·Fork가 있어도 삭제되고 행은 지우지 않는다. 삭제된 작품은 목록·검색·랭킹·읽기·Fork 생성에서 제외하며, 원작 삭제 시 Fork 참조 유지는 #108(PR #221, CI 통과 확인)에서 추적한다. 삭제된 원작도 원작자의 Fork 최초 공개 허용 설정을 그대로 따르고, 소프트 삭제한 Fork가 있어도 같은 원작을 다시 Fork할 수 없다(`fork` UNIQUE 유지, 409). 작품 화면은 Fork 원작 정보의 `deleted`로 "삭제된 원작" 안내·원작 제목·분기 전 회차 숨김 안내를 보여 주고 읽기 시작을 Fork 회차부터 연다. 삭제된 작품의 설정 첨부·운영 목록/조회/제한은 404·제외하고, 원작을 따라가는 Fork의 공개 설정 위키는 원작이 삭제되면 비운다(#108 후속). 삭제된 작품의 좋아요 취소·관심 해제·댓글 삭제가 404인 것은 비공개 작품과 같은 기존 계약이다.
- CI 인증·Health 통합 회귀는 Core의 503 오류를 대역으로 고정하고, Content의 정상 응답에는 기본 3초·시간 초과 검증에는 별도 150ms를 적용하도록 테스트만 보완했다. 503/504/502·자격 분리·redirect 금지·재시도/캐시 금지 계약과 기존 완료 표시는 유지하며, 최신 Required CI 재검증은 대기다.
- WorldStudio 확정 복구(PR #288, Draft): 동일 요청의 원래 확정본과 후속 버전을 검증한 뒤 작가의 명시적 확인으로 재시도 기록을 정리한다. 팀 리뷰 대기이며 실제 배포 다중 탭 검증은 별도다.
- WorldStudio 발표 디자인 통합(PR #223): 발표용 전체 지도·카드형 관계도·관계 편집 카드 보드를 서비스 모드에 연결하고 기존 입력 보호·방향/곡률을 유지한다. 서버 HTTP 저장 재검증 전이며 차이는 [점검 문서](worldstudio-presentation-ui-audit.md)를 본다.
- PR #142 충돌 정렬에서 Neo4j opt-in 컨테이너·volume은 local Compose로 옮기고 prod의 외부 서비스·이미지 전용 구성을 유지했다. WorldStudio packaged migration 시스템 기대값은 기존 V1+V2의 최초 적용 2건·테이블 13개와 재실행 적용 0건으로 정정했으며 Auth/Content 이력 보존 검사는 유지한다. 최신 Required CI 재검증은 대기이며 완료 체크는 변경하지 않는다.
- 2026-11-06 샘플 정본 이관: 사용자 요청으로 sample SQL 파일을 제거하고 Core/Content 테이블별 UTF-8 CSV 31개와 stdlib/psql COPY 승인형 loader로 전환했다. Content V15(샘플 이관 당시 V10, develop의 V10~V14 뒤로 번호만 이동)는 샘플 없는 스키마 SQL이며 기존 migration 19개 바이트·11작품/17자체/32회차/120wiki/9링크를 보존한다. 속성별 실제 원문 공개 map으로 카엘 관계는 2화부터, 근거 미확인 속성은 비공개로 처리한다. rich 대상/실제 detach·복사만 409로 보호하고 원작의 새 단순 설정 초안·확정은 허용한다. 기존 공개 API·Fork·Frontend 변경은 유지하고 관심/진행은 창 메모리, aggregate/rich 편집·관계 과거 복원·인물 quick-search 선조회는 미지원/미확장이다. [CSV 이관 안내](../infrastructure/sample-data/README.md)를 따른다.
- 작성 기준: 2026-11-04 로컬 코드·요구사항·설계, 샘플 CSV 전환·공개/편집 경계는 2026-11-06 추가 확인. HTML 표를 지원하는 Markdown 뷰어에서 병합 셀이 표시된다.


## Core 서비스 — 회원·인증·크레딧·알림

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="53">Core 서비스</td><td rowspan="2">개발 데이터 관리</td><td rowspan="2">91 개발 샘플 정본 이관</td><td>기존 일반 개발 작가 subject 확인·자격증명 보존</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td><td rowspan="2">—</td></tr>
<tr><td>CSV의 로그인 비활성·비운영자 샘플 subject 9개 추가</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td></tr>
<tr><td rowspan="19">회원 관리</td><td rowspan="11">01 회원 CRUD</td><td>회원가입</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td><td rowspan="11"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a></td></tr>
<tr><td>내 회원 정보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>닉네임 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>이메일 변경 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>이메일 변경 인증</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>비밀번호 재설정 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>비밀번호 재설정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>회원 탈퇴 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/148">PR #148</a></td></tr>
<tr><td>회원 탈퇴 처리</td><td>❌</td></tr>
<tr><td>회원 탈퇴 상태 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/148">PR #148</a></td></tr>
<tr><td>회원 탈퇴 요청 취소</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/148">PR #148</a></td></tr>
<tr><td rowspan="8">02 인증·세션 관리</td><td>이메일 인증</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/74">#74</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/79">PR #79</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>인증 메일 재발송</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그인</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>접근 토큰 갱신</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그인 기기 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>특정 기기 로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>전체 기기 로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td rowspan="10">알림 관리</td><td rowspan="10">31 알림 CRUD·수신 설정</td><td>알림 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/236">PR #236</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/236">PR #236</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/224">PR #224</a></td></tr>
<tr><td>내 알림 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/145">#145</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/146">#146</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/147">PR #147</a></td></tr>
<tr><td>알림 상세 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>알림 읽음 처리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td></tr>
<tr><td>알림 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td></tr>
<tr><td>알림 수신 설정 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td></tr>
<tr><td>선택 알림 수신 설정 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td></tr>
<tr><td>묶음 알림 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>전체 알림 일괄 읽음 처리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/144">#144</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/147">PR #147</a></td></tr>
<tr><td>SSE 변경 신호의 느린 연결 격리·전송 중복 병합</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a> <small>(막힌 연결의 논리적 제거까지이며 물리적 소켓 종료 보장은 아님·컨테이너 쓰기 타임아웃은 후속)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/129">PR #129</a></td></tr>
<tr><td rowspan="12">크레딧 관리</td><td rowspan="12">32 지급·사용·정산 관리</td><td>크레딧 잔액 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/283">PR #283</a> <small>(<code>GET /api/v1/me/credits</code> · 계정 결제 내역 화면)</small></td><td rowspan="12"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/283">PR #283</a></td></tr>
<tr><td>크레딧 지급</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> <small>(가입 체험은 <code>CREDIT_SIGNUP_TRIAL_AMOUNT</code>로 켜며 기본 0이라 지급하지 않음 · 보상·이벤트 지급은 서비스 메서드만 있고 호출하는 기능 없음)</small></td></tr>
<tr><td>크레딧 지급 내역 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/283">PR #283</a> <small>(<code>GET /api/v1/me/credits/history</code> · 계정 결제 내역 화면)</small></td></tr>
<tr><td>AI 예상 비용 안내</td><td>❌</td></tr>
<tr><td>AI 비용 동의 기록</td><td>❌</td></tr>
<tr><td>AI 사용량 기록</td><td>❌</td></tr>
<tr><td>크레딧 사용 정산</td><td>❌ <small>(차감 <code>spend</code> 서비스 메서드만 있고 호출하는 AI 기능·정산 단위 없음)</small></td></tr>
<tr><td>크레딧 사용 내역 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/283">PR #283</a> <small>(같은 내역 API · 차감을 호출하는 기능이 없어 사용 내역은 아직 생기지 않음)</small></td></tr>
<tr><td>크레딧 소멸 처리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> <small>(매일 00:00 KST 스케줄러 · 화면 없음)</small></td></tr>
<tr><td>크레딧 소멸 내역 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/260">PR #260</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/283">PR #283</a> <small>(같은 내역 API · 계정 결제 내역 화면)</small></td></tr>
<tr><td>실패 작업 정산 복구</td><td>❌</td></tr>
<tr><td>AI 요청 속도 제한</td><td>❌</td></tr>
<tr><td rowspan="10">결제 관리</td><td rowspan="10">33 구독·결제 관리</td><td>구독 상품 조회</td><td>❌</td><td rowspan="10">—</td></tr>
<tr><td>구독 신청</td><td>❌</td></tr>
<tr><td>구독 상태 조회</td><td>❌</td></tr>
<tr><td>구독 변경</td><td>❌</td></tr>
<tr><td>구독 해지</td><td>❌</td></tr>
<tr><td>추가 크레딧 구매</td><td>❌</td></tr>
<tr><td>결제 내역 조회</td><td>❌</td></tr>
<tr><td>결제 취소 요청</td><td>❌</td></tr>
<tr><td>환불 요청</td><td>❌</td></tr>
<tr><td>결제 결과 검증</td><td>❌</td></tr>
</tbody>
</table>

## 콘텐츠 서비스 — 창작·독서·콘텐츠 정본

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="326">콘텐츠 서비스</td><td rowspan="6">개발 데이터 관리</td><td rowspan="6">91 개발 샘플 정본 이관</td><td>정규 CSV를 승인된 정확한 DB/schema에 COPY·동일 재실행만 허용·충돌 거절</td><td>❌</td><td rowspan="6">—</td></tr>
<tr><td>Core subject에 대응하는 자격증명 없는 Content member 참조 저장</td><td>❌</td></tr>
<tr><td>샘플 작품 11개를 정규 작품·소유권 행으로 이관</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td></tr>
<tr><td>자체 원고 17개의 정확한 본문·버전·발행 사건 이관</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td></tr>
<tr><td>상속 회차 15개의 원작 contentVersionId·checkpoint 연결 보존</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td></tr>
<tr><td>wiki CSV 120개·링크 9개를 불변 설정 버전·정규 상세로 보존</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/180">PR #180</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>콘텐츠 서비스 독립 Spring Boot 실행 골격</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>인증 연계</td><td>90 Core 인증 연계</td><td>별도 서비스 자격과 사용자 Bearer로 Core를 호출해 UUID Principal 생성·실패 분류</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>인증 연계</td><td>90 Core 인증 연계</td><td>Core 내부 endpoint에서 서비스 자격·JWT를 확인하고 회원 UUID만 반환</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>기존 콘텐츠·첨부·독립 WorldStudio 실행 코드·테스트의 Content 소유 분리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>업무별 fresh 초기 SQL 발견·순서 및 Content migration 소유 분리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>기존 works 공개 URL의 nginx/Vite Content 라우팅</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>Content 이미지·Compose·CD 연결</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>Content 변경의 CI 통합·소비자·시스템 회귀 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/96">PR #96</a></td><td>—</td></tr>
<tr><td rowspan="8">권한 관리</td><td rowspan="8">03 접근·공개 범위 관리</td><td>작품 소유권 확인</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>세계관 소유권 확인</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td></tr>
<tr><td>설정 항목 공개 범위 설정</td><td>❌</td></tr>
<tr><td>설정 항목 비공개 설정</td><td>❌</td></tr>
<tr><td>설정 공개 회차 변경</td><td>❌</td></tr>
<tr><td>작품 이용 조건 조회</td><td>❌</td></tr>
<tr><td>작품 Fork 생성 허용 설정</td><td>❌</td></tr>
<tr><td>Fork 작품 공개 허용 설정</td><td>❌</td></tr>
<tr><td rowspan="28">세계관 관리</td><td rowspan="5">04 세계관 CRUD</td><td>세계관 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>세계관 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td></tr>
<tr><td>내 세계관 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td></tr>
<tr><td>세계관 기본 정보 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td></tr>
<tr><td>세계관 삭제 요청</td><td>❌</td></tr>
<tr><td rowspan="14">05 설정 항목 CRUD</td><td>설정 항목 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 검색</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>설정 초안 저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 확정 저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 카테고리 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 태그 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 정정</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>설정 항목 별칭 추가</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 항목 별칭 제거</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>설정 카드 유형 변경 <small>(Draft 검토 후보)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>세계관 주제 영역 변경 <small>(Draft 검토 후보)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112">PR #112</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>구조화 wiki 대상 편집·rich 원본 복사/following detach를 409로 거절해 상세 손실 방지</td><td>❌</td><td>—</td></tr>
<tr><td rowspan="1">57 세계관·작품 연결</td><td>작품에 사용할 기존 세계관 선택·연결</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a></td></tr>
<tr><td rowspan="3">59 설정 문서 속성 편집</td><td>설정 문서 사용자 정의 속성 추가</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a></td></tr>
<tr><td>설정 문서 사용자 정의 속성 이름 변경</td><td>❌</td></tr>
<tr><td>설정 문서 사용자 정의 속성 값 수정</td><td>❌</td></tr>
<tr><td rowspan="1">61 설정 문서 참조 조회</td><td>현재 설정 문서를 언급한 다른 문서 목록 조회</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a></td></tr>
<tr><td rowspan="4">86 세계관 버전 관리 <small>(Draft 검토 후보)</small></td><td>세계관 전체 버전 생성</td><td>❌ <small>(카드 revision API만·관계 snapshot 미지원)</small></td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>세계관 버전 목록 조회</td><td>❌</td></tr>
<tr><td>세계관 버전 상세 조회</td><td>❌ <small>(카드 revision 조회·관계 not_recorded·CI 대기)</small></td></tr>
<tr><td>세계관 이전 버전 복원</td><td>❌ <small>(#132 관계 현재 상태 MVP에서는 전체 restore 명시적 차단)</small></td></tr>
<tr><td rowspan="31">캐릭터·관계 관리</td><td rowspan="5">06 캐릭터 CRUD</td><td>캐릭터 등록</td><td>❌</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>캐릭터 상세 조회</td><td>❌</td></tr>
<tr><td>캐릭터 목록 조회</td><td>❌</td></tr>
<tr><td>캐릭터 프로필 수정</td><td>❌</td></tr>
<tr><td>캐릭터 정정</td><td>❌</td></tr>
<tr><td rowspan="8">07 상태·지식 관리</td><td>인물 상태 등록</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58">#58</a></td></tr>
<tr><td>회차별 인물 상태 조회</td><td>❌</td></tr>
<tr><td>인물 상태 수정</td><td>❌</td></tr>
<tr><td>인물 지식 등록</td><td>❌</td></tr>
<tr><td>시점별 인물 지식 조회</td><td>❌</td></tr>
<tr><td>인물 지식 수정</td><td>❌</td></tr>
<tr><td>인물 상태 이력 조회</td><td>❌</td></tr>
<tr><td>인물 상태 이력 정정</td><td>❌</td></tr>
<tr><td rowspan="18">08 관계 CRUD</td><td>관계 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>인물관계도 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 해제 정정</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>시점별 관계 조회</td><td>❌ <small>(#132 현재 상태 MVP 제외)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 이력 복원</td><td>❌ <small>(#132 현재 상태 MVP 제외)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 초안 저장 <small>(Draft 검토 후보)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 초안 조회 <small>(Draft 검토 후보)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 초안 수정 <small>(Draft 검토 후보)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>미확정 관계 초안 제거 <small>(Draft 검토 후보)</small></td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>관계 확정 저장 <small>(Draft 검토 후보)</small></td><td>❌ <small>(#132는 현재 상태 저장만·관계 버전 확정 미지원)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>관계 저장 시 stale draft·graph CAS 충돌 거절</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>다른 세계관 관계 UUID의 확정 비적용 후 동일 pending 해제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>동일 key·입력 재시도로 관계 저장을 한 번만 완료</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>저장소 간 미완료·관계 token 불일치를 조회 성공으로 숨기지 않음</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td>미전환 기존 세계관의 관계 조회에 migration_required 안내</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/142">PR #142</a></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/132">#132</a></td></tr>
<tr><td rowspan="11">작품 관리</td><td rowspan="11">09 작품 CRUD</td><td>작품 생성 <small>(실서버 새 소설 진입은 <code>/content</code>, <code>/new</code> 폼은 목업 전용 · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/243">#243</a>)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/255">PR #255</a></td><td rowspan="11"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/108">#108</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/106">PR #106</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/102">PR #102</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/99">PR #99</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>작품 유형 선택·저장</td><td>✅</td></tr>
<tr><td>승인 장르 1~2개 선택·저장</td><td>✅</td></tr>
<tr><td>해시태그 0~10개 검증·저장</td><td>✅</td></tr>
<tr><td>작품 등록 권리 확인·기록</td><td>✅</td></tr>
<tr><td>작품 상세 조회</td><td>✅</td></tr>
<tr><td>내 작품 목록 조회</td><td>✅</td></tr>
<tr><td>작품 기본 정보 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/99">PR #99</a></td></tr>
<tr><td>작품 삭제 요청 <small>(소유자 범위, 이후 DEC-42 소프트 삭제로 전환, #108)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/106">PR #106</a></td></tr>
<tr><td>원작 삭제 시 Fork 작품 유지 <small>(원작 소프트 삭제, Fork는 원작 참조 유지·분기 전 회차 본문 독자 숨김, DEC-42, #108. "삭제된 원작" 안내·분기 전 회차 숨김 안내는 PR #251)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/221">PR #221</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/251">PR #251</a></td></tr>
<tr><td>세계관 설정 문서가 있는 작품 삭제 <small>(소프트 삭제, 설정·저장 버전이 있어도 삭제되고 데이터는 남음, DEC-42, #108)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/221">PR #221</a></td></tr>
<tr><td rowspan="43">회차·원고 관리</td><td rowspan="9">10 회차·원고 CRUD</td><td>회차 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>회차 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 제목 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 본문 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 초안 자동저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 순서 변경 가능 범위 확인 <small>(후보 조회)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/261">PR #261</a></td></tr>
<tr><td>초안 삭제 요청 <small>(작업 초안만)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/261">PR #261</a></td></tr>
<tr><td>회차 삭제 요청 <small>(참조 없는 마지막 회차 소프트 삭제)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/261">PR #261</a></td></tr>
<tr><td rowspan="13">11 플롯·장면 계획 CRUD</td><td>플롯 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td><td rowspan="13"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61">#61</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/140">#140</a></td></tr>
<tr><td>플롯 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>플롯 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>플롯 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>플롯 삭제 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>장면 계획 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>장면 계획 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>장면 계획 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>장면 계획 삭제 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/131">PR #131</a></td></tr>
<tr><td>작품 실제 삭제 시 소속 계획·참조 정리</td><td>❌</td></tr>
<tr><td>계획 삭제 충돌 후 최신 대상 재조회·재확인</td><td>❌</td></tr>
<tr><td>장면 계획 삭제 후 키보드 포커스 복구</td><td>❌</td></tr>
<tr><td>플롯 삭제 후 키보드 포커스 복구</td><td>❌</td></tr>
<tr><td rowspan="16">12 버전·체크포인트 관리</td><td>원고 저장 버전 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="16"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/119">#119</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/121">#121</a></td></tr>
<tr><td>원고 버전 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 버전 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 버전 비교</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td>원고 비교·공개 범위를 설명하는 버전 관리 진입 문구</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/152">PR #152</a></td></tr>
<tr><td>버전 관리의 현재 화면과 시트 접근성 이름 일치</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/152">PR #152</a></td></tr>
<tr><td>버전 관리 탭 전환 시 원고 비교 선택 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/139">PR #139</a></td></tr>
<tr><td>원고 비교 선택 초기화 <small>(작품·회차 변경, 시트 닫기, 선택 버전 제거)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/139">PR #139</a></td></tr>
<tr><td>원고 이전 버전 복원</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>설정 버전 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td>설정 버전 상세의 선택 이력 번호 확인</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/134">PR #134</a></td></tr>
<tr><td>설정 이전 버전 복원</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td>세계관 체크포인트 생성 <small>(작품에 연결된 저장 설정)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/257">PR #257</a></td></tr>
<tr><td>체크포인트 상세 조회 <small>(회차 발행본 원고·세계관 저장 설정)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/257">PR #257</a></td></tr>
<tr><td>회차 발행 시 체크포인트(발행본) 생성 <small>(DEC-43)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/227">PR #227</a></td></tr>
<tr><td>발행 회차를 이전 체크포인트로 되돌리기</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/227">PR #227</a></td></tr>
<tr><td rowspan="2">62 회차 부가 내용 편집</td><td>회차 작가의 말 작성</td><td>✅ <small>(로컬 단위·통합 검증 완료 · 브라우저 전체 검증 대기)</small></td><td rowspan="2"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a></td></tr>
<tr><td>회차 작가의 말 수정</td><td>✅ <small>(로컬 단위·통합 검증 완료 · 브라우저 전체 검증 대기)</small></td></tr>
<tr><td rowspan="3">87 기준 세계관 연결 관리 <small>(집필실 회차별 참조)</small></td><td>회차의 기준 세계관 버전 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/259">PR #259</a></td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/259">구현 PR #259</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">설계 PR #86</a></td></tr>
<tr><td>회차의 기준 세계관 버전 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/259">PR #259</a></td></tr>
<tr><td>회차의 기준 세계관 버전 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/259">PR #259</a></td></tr>
<tr><td rowspan="9">발행 관리</td><td rowspan="9">13 발행·공개 관리</td><td>저장 버전 발행</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/34">#34</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/83">PR #83</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>발행본 교체</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/246">PR #246</a></td></tr>
<tr><td>회차 공개 중단</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/246">PR #246</a></td></tr>
<tr><td>회차 재공개</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/246">PR #246</a></td></tr>
<tr><td>발행 이력 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/246">PR #246</a></td></tr>
<tr><td>예약 발행 등록 <small>(회차당 대기 1건)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/256">PR #256</a></td></tr>
<tr><td>예약 발행 조회 <small>(예약 시각·실행 결과)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/256">PR #256</a></td></tr>
<tr><td>예약 발행 변경 <small>(실행 전)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/256">PR #256</a></td></tr>
<tr><td>예약 발행 취소 <small>(실행 전)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/256">PR #256</a></td></tr>
<tr><td rowspan="20">Fork 관리</td><td rowspan="9">14 Fork CRUD</td><td>Fork 생성 <small>(공개·허용 기준 회차를 쓰기 전 검사; HTTP 생성 연결·선택 단위 확인)</small></td><td>✅</td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/268">PR #268</a></td></tr>
<tr><td>Fork 상세 조회 <small>(내 서재 카드 안 접이식 영역)</small></td><td>✅</td></tr>
<tr><td>내 Fork 목록 조회</td><td>✅</td></tr>
<tr><td>Fork 원작 정보 조회</td><td>✅</td></tr>
<tr><td>Fork 기준 회차 조회</td><td>✅</td></tr>
<tr><td>Fork 기본 정보 수정</td><td>✅</td></tr>
<tr><td>Fork 후속 원고 수정</td><td>✅</td></tr>
<tr><td>Fork 삭제 요청</td><td>✅</td></tr>
<tr><td>Fork 공개 중단</td><td>✅</td></tr>
<tr><td rowspan="7">15 세계관 독립·원본 변경 관리</td><td>허용된 원본 변경 추종</td><td>❌</td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/108">#108</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a></td></tr>
<tr><td>최초 수정 시 세계관 독립</td><td>❌</td></tr>
<tr><td>원본 변경 목록 조회</td><td>❌</td></tr>
<tr><td>원본 변경 상세 조회</td><td>❌</td></tr>
<tr><td>원본 변경 반영</td><td>❌</td></tr>
<tr><td>원본 변경 거절</td><td>❌</td></tr>
<tr><td>거절한 변경 재검토</td><td>❌</td></tr>
<tr><td rowspan="1">53 공개 Fork 탐색</td><td>선택 원작의 공개 Fork 작품 목록 조회</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="2">54 Fork 생성 준비</td><td>원작의 Fork 허용 회차 목록 조회 <small>(all/from/selected 서버 allowlist·boolean 변경 시 범위 보존; 선택 단위 확인)</small></td><td>✅</td><td rowspan="2"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td>선택 기준 회차에서 가져올 공개 세계관·인물·사건 미리보기 <small>(회차 한정 API 연결·미래 정보 제외; 관계 과거 snapshot/전체 복원 미지원)</small></td><td>✅</td></tr>
<!-- Fork 운영 점검 -->
<tr><td rowspan="1">83 Fork 정합성 운영 점검</td><td>Fork 스냅샷 해시·원작 고정 기준 해시·인물 상태 점검 결과 조회 <small>(인물 상태 미저장은 비교 불가)</small></td><td>✅</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="18">이미지 관리</td><td rowspan="6">16-A 설정 이미지 CRUD</td><td>설정 이미지 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>설정 이미지 상세 정보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>설정 이미지 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>설정 이미지 다운로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>설정 이미지 교체</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>설정 이미지 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td rowspan="5">16-B 작품 표지 CRUD</td><td>작품 표지 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>작품 표지 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>작품 표지 다운로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>작품 표지 교체</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>작품 표지 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td rowspan="7">16-C 원고 이미지 관리</td><td>원고 이미지 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>원고 이미지 본문 삽입</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>원고 이미지 다운로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>발행 원고 이미지 공개 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>원고 이미지 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 이미지 대체 텍스트 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 이미지 본문 참조 제거</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td rowspan="15">파일 관리</td><td rowspan="7">17 파일 CRUD</td><td>참고 파일 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>파일 상세 정보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 다운로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 교체</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 메타데이터 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>파일 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td rowspan="8">18 원고 가져오기·내보내기</td><td>TXT 원고 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/31">#31</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>EPUB 원고 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 회차 자동 구분</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 등록 미리보기</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 등록 확정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>원고 등록 실패 항목 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>TXT 원고 내보내기</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td>EPUB 원고 내보내기</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/238">PR #238</a></td></tr>
<tr><td rowspan="6">세계관 확장 관리</td><td rowspan="6">19 세계관 복사·조합</td><td>복사 가능한 세계관 조회</td><td>❌</td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>세계관 복사</td><td>❌</td></tr>
<tr><td>조합 원본 세계관 선택</td><td>❌</td></tr>
<tr><td>조합할 설정 항목 선택</td><td>❌</td></tr>
<tr><td>조합 세계관 생성</td><td>❌</td></tr>
<tr><td>조합 세계관 출처 조회</td><td>❌</td></tr>
<tr><td rowspan="21">독서 관리</td><td rowspan="9">20 공개 열람</td><td>공개 작품 목록 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>공개 작품 상세 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>공개 회차 목록 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>공개 회차 본문 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>이전 회차 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>다음 회차 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>공개 작품의 slug·표시 작가·테마·회차 versionId 메타데이터 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>공개 회차의 wiki·속성별 원문 공개 근거/비공개 기본값·지식·보이는 대상 링크만 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td>작품 내 공개 회차 제목·본문 검색</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/239">PR #239</a></td></tr>
<tr><td rowspan="3">21-A 작품 좋아요 관리</td><td>작품 좋아요</td><td>✅</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/234">PR #234</a></td></tr>
<tr><td>작품 좋아요 취소</td><td>✅</td></tr>
<tr><td>작품 좋아요 수 조회</td><td>✅</td></tr>
<tr><td rowspan="3">21-B 관심 작품 관리</td><td>관심 작품 등록</td><td>✅</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/236">PR #236</a></td></tr>
<tr><td>내 관심 작품 목록 조회</td><td>✅</td></tr>
<tr><td>관심 작품 해제</td><td>✅</td></tr>
<tr><td rowspan="6">21-C 독서 기록 관리</td><td>이어 읽기 위치 저장</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td>이어 읽기 위치 조회 (서재 데모 통합 테스트의 U11 화면 ID 갱신 대기 보완 · hosted CI 재검증 대기)</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td>이어 읽기 위치 수정</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td>이어 읽기 기록 삭제</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td>읽은 회차 기록 저장</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td>회차별 읽음 상태 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/237">PR #237</a></td></tr>
<tr><td rowspan="28">피드백 관리</td><td rowspan="8">22 댓글 CRUD</td><td>댓글 작성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 스포일러 표시 설정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 좋아요</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td>댓글 좋아요 취소</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/228">PR #228</a></td></tr>
<tr><td rowspan="11">23 제보 관리</td><td>오류·질문·제안 제보 등록</td><td>❌</td><td rowspan="11"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/275">PR #275</a></td></tr>
<tr><td>제보 상세 조회</td><td>❌</td></tr>
<tr><td>공개 제보 목록 조회</td><td>❌</td></tr>
<tr><td>내 제보 목록 조회</td><td>❌</td></tr>
<tr><td>제보 공개 범위 설정</td><td>❌</td></tr>
<tr><td>제보 정정</td><td>❌</td></tr>
<tr><td>제보 철회</td><td>❌</td></tr>
<tr><td>작가 제보 확인</td><td>❌</td></tr>
<tr><td>제보 답변 작성</td><td>❌</td></tr>
<tr><td>제보 답변 조회</td><td>❌</td></tr>
<tr><td>제보 처리 상태 변경</td><td>❌</td></tr>
<tr><td rowspan="9">24 수정 제안·승인 관리</td><td>수정 제안 등록</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/32">#32</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>수정 제안 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>수정 제안 목록 조회 <small>(내 제안·작가 피드백함)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>제안 편집안 저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>수정 제안 승인 <small>(기준 발행본이 바뀌면 상태를 바꾸지 않고 다시 검토)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>수정 제안 거절</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>수정 제안 보류</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a></td></tr>
<tr><td>승인된 수정안 원고 반영</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a> <small>(새 초안 버전까지이며 발행은 하지 않음·문장이 초안에 없거나 여러 곳이면 반영 실패로 기록하고 작가가 직접 수정)</small></td></tr>
<tr><td>자동 표기 교정 적용 범위 검사</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/276">PR #276</a> <small>(표시 전용 판정이며 자동 적용은 기능 30)</small></td></tr>
<tr><td rowspan="6">작품 설정 관리</td><td rowspan="6">30 운영 설정 관리</td><td>작품 운영 설정 조회</td><td>❌</td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>집필 방식 변경</td><td>❌</td></tr>
<tr><td>설정 추출 모드 변경</td><td>❌</td></tr>
<tr><td>자동 교정 설정 변경</td><td>❌</td></tr>
<tr><td>자율 연재 설정 변경</td><td>❌</td></tr>
<tr><td>작품 설정 변경 이력 조회</td><td>❌</td></tr>
<tr><td rowspan="6">저장 공간 관리</td><td rowspan="6">36 사용량·정리 관리</td><td>내 저장 사용량 조회</td><td>❌</td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>저장 항목 목록 조회</td><td>❌</td></tr>
<tr><td>정리 대상 선택</td><td>❌</td></tr>
<tr><td>정리 요청</td><td>❌</td></tr>
<tr><td>정리 결과 조회</td><td>❌</td></tr>
<tr><td>저장 공간 확장 신청</td><td>❌</td></tr>
<tr><td rowspan="6">성인 콘텐츠 관리</td><td rowspan="6">37 등급·접근 관리</td><td>작품 성인 등급 설정</td><td>❌</td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>세계관 성인 등급 설정</td><td>❌</td></tr>
<tr><td>콘텐츠 등급 변경</td><td>❌</td></tr>
<tr><td>성인 작품 표시 필터 변경</td><td>❌</td></tr>
<tr><td>연령 확인</td><td>❌</td></tr>
<tr><td>성인 콘텐츠 접근 검사</td><td>❌</td></tr>
<tr><td rowspan="11">검색 관리</td><td rowspan="11">44 작품 검색</td><td>작품 제목 검색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td><td rowspan="11"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/13">PR #13</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/249">PR #249</a></td></tr>
<tr><td>작가 닉네임 검색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>해시태그 검색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>장르 검색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>검색 범위 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>검색 결과 최신 순 정렬</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>검색 결과 인기 순 정렬</td><td>❌</td></tr>
<tr><td>검색 결과 조회 순 정렬</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>검색 결과 페이지 조회</td><td>❌</td></tr>
<tr><td>태그별 작품 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/249">PR #249</a></td></tr>
<tr><td>빠른 이동 검색 후보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/249">PR #249</a></td></tr>
<tr><td rowspan="14">랭킹·트렌드 관리</td><td rowspan="14">45 작품 랭킹·인기 추이</td><td>전체 작품 랭킹 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td><td rowspan="14"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/12">PR #12</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/13">PR #13</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>원작 작품 랭킹 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>Fork 작품 랭킹 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>최신 작품 순위 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>인기 작품 순위 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>조회수 순위 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>실시간 인기 TOP10 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>24시간 인기 급상승 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/175">PR #175</a></td></tr>
<tr><td>방금 업데이트 작품 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>최신 Fork 작품 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>이번 주 인기 무료 소설 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>랭킹 집계 기준 확정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>기간별 랭킹 집계</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td>랭킹 갱신 시각 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/253">PR #253</a></td></tr>
<tr><td rowspan="7">추천·홈 탐색 관리</td><td rowspan="5">46 추천 시스템</td><td>홈 개인 맞춤 추천(좋아요·관심·독서 기록 기반, 비회원은 인기순)</td><td>❌</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/12">PR #12</a></td></tr>
<tr><td>작품 상세 비슷한 작품 추천(장르·태그·원작·세계관)</td><td>❌</td></tr>
<tr><td>세계관 추천·많이 쓰는 세계관(공개 세계관 둘러보기 이후, 예정)</td><td>❌</td></tr>
<tr><td>홈 장르별 작품 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/commit/e3181356">커밋 e3181356</a></td></tr>
<tr><td>오늘의 발견 작품 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/commit/e3181356">커밋 e3181356</a></td></tr>
<tr><td rowspan="2">55 홈 탐색 필터</td><td>홈 무료 작품만 보기</td><td>❌</td><td rowspan="2">—</td></tr>
<tr><td>홈 Fork가 있는 원작만 보기</td><td>❌</td></tr>
<tr><td rowspan="3">검색 트렌드 검토</td><td rowspan="3">47 인기 검색어(추가 검토)</td><td>인기 검색어 제공 여부 결정</td><td>❌</td><td rowspan="3">—</td></tr>
<tr><td>인기 검색어 집계 기준 결정</td><td>❌</td></tr>
<tr><td>인기 검색어 순위 조회(도입 승인 후)</td><td>❌</td></tr>
<tr><td rowspan="17">캐릭터챗 관리</td><td rowspan="9">76 캐릭터챗 탐색·대화방</td><td>대화 가능한 공개 작품·캐릭터 챗 목록 조회</td><td>❌</td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/47">#47</a></td></tr>
<tr><td>캐릭터챗 원작·Fork 유형 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 작품 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 인물 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 최신순 정렬</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 인기순 정렬</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 조회순 정렬</td><td>❌</td></tr>
<tr><td>작품·인물을 선택해 대화방 조회·재개</td><td>❌</td></tr>
<tr><td>작품·인물별 기존 대화 기록 조회</td><td>❌</td></tr>
<tr><td rowspan="8">78 캐릭터챗 운영</td><td>운영 캐릭터챗 연결 목록·상태 조회</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/47">#47</a></td></tr>
<tr><td>공개 작품·캐릭터 연결로 캐릭터챗 등록</td><td>❌</td></tr>
<tr><td>캐릭터챗 운영 중지</td><td>❌</td></tr>
<tr><td>캐릭터챗 운영 재개</td><td>❌</td></tr>
<tr><td>운영 캐릭터챗 원작·Fork 분류</td><td>❌</td></tr>
<tr><td>운영 캐릭터챗 작품명·캐릭터 검색</td><td>❌</td></tr>
<tr><td>운영 캐릭터챗 작품 제목순 정렬</td><td>❌</td></tr>
<tr><td>운영 캐릭터챗 작품 제목 역순 정렬</td><td>❌</td></tr>
<tr><td rowspan="4">AI 제안 관리</td><td rowspan="4">88 제안 반영 이력 조회 <small>(Draft 검토 후보)</small></td><td>제안 요청 당시 원고 조회</td><td>❌</td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>제안과 원본 원고 비교</td><td>❌</td></tr>
<tr><td>제안 반영 결과 버전 조회</td><td>❌</td></tr>
<tr><td>반영 전후 원고 비교</td><td>❌</td></tr>
</tbody>
</table>

## 콘텐츠 서비스 · AI 서비스 — 생성·검토 연계

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="73">콘텐츠 서비스 + AI 서비스</td><td rowspan="8">AI 설정 추출</td><td rowspan="8">25 추출·후보 관리</td><td>설정 추출 요청</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>추출 결과 조회</td><td>❌</td></tr>
<tr><td>추출 후보 목록 조회</td><td>❌</td></tr>
<tr><td>추출 후보 상세 조회</td><td>❌</td></tr>
<tr><td>추출 후보 수정</td><td>❌</td></tr>
<tr><td>추출 후보 채택</td><td>❌</td></tr>
<tr><td>추출 후보 제외</td><td>❌</td></tr>
<tr><td>추출 근거 조회</td><td>❌</td></tr>
<tr><td rowspan="14">AI 시뮬레이션</td><td rowspan="14">26 실행·결과 관리</td><td>시뮬레이션 조건 등록</td><td>❌</td><td rowspan="14"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58">#58</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>시뮬레이션 조건 조회</td><td>❌</td></tr>
<tr><td>시뮬레이션 조건 수정</td><td>❌</td></tr>
<tr><td>시뮬레이션 실행</td><td>❌</td></tr>
<tr><td>시뮬레이션 중지</td><td>❌</td></tr>
<tr><td>시뮬레이션 진행 상태 조회</td><td>❌</td></tr>
<tr><td>시뮬레이션 실행 목록 조회</td><td>❌</td></tr>
<tr><td>시뮬레이션 결과 조회</td><td>❌</td></tr>
<tr><td>인물 행동·대화 기록 조회</td><td>❌</td></tr>
<tr><td>대안 전개 후보 조회</td><td>❌</td></tr>
<tr><td>시뮬레이션 결과 선택</td><td>❌</td></tr>
<tr><td>시뮬레이션 개인 기록 삭제</td><td>❌</td></tr>
<tr><td>독자 오류 검증 실행</td><td>❌</td></tr>
<tr><td>검증 근거 조회</td><td>❌</td></tr>
<tr><td rowspan="13">AI 집필 지원</td><td rowspan="13">27 대화·제안 관리</td><td>허용 문맥 미리보기</td><td>❌</td><td rowspan="13"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57">#57</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56">#56</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62">#62</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55">#55</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>이어쓰기 요청</td><td>❌</td></tr>
<tr><td>부분 수정 요청</td><td>❌</td></tr>
<tr><td>AI 대화 요청</td><td>❌</td></tr>
<tr><td>대화 목록 조회</td><td>❌</td></tr>
<tr><td>대화 상세 조회</td><td>❌</td></tr>
<tr><td>대화 기록 삭제</td><td>❌</td></tr>
<tr><td>집필 제안 목록 조회</td><td>❌</td></tr>
<tr><td>집필 제안 상세 조회</td><td>❌</td></tr>
<tr><td>집필 제안 선택</td><td>❌</td></tr>
<tr><td>집필 제안 거절</td><td>❌</td></tr>
<tr><td>집필 제안 기록 삭제</td><td>❌</td></tr>
<tr><td>선택한 집필 제안 반영</td><td>❌</td></tr>
<tr><td rowspan="8">AI 검토 지원</td><td rowspan="8">28 설정·개연성 검토</td><td>설정 충돌 검토 요청</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59">#59</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56">#56</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>수치 충돌 검토 요청</td><td>❌</td></tr>
<tr><td>인물 행동 개연성 검토 요청</td><td>❌</td></tr>
<tr><td>사건 인과관계 검토 요청</td><td>❌</td></tr>
<tr><td>검토 결과 조회</td><td>❌</td></tr>
<tr><td>검토 근거 조회</td><td>❌</td></tr>
<tr><td>의심 항목 판단 기록</td><td>❌</td></tr>
<tr><td>검토 기록 삭제</td><td>❌</td></tr>
<tr><td rowspan="7">AI 피드백 지원</td><td rowspan="7">29 응대·유해 필터</td><td>질문 답변 생성</td><td>❌</td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>단순 오류 수정안 생성</td><td>❌</td></tr>
<tr><td>스토리 오류 검증 근거 생성</td><td>❌</td></tr>
<tr><td>피드백 유해 콘텐츠 검사</td><td>❌</td></tr>
<tr><td>유해 콘텐츠 재검사</td><td>❌</td></tr>
<tr><td>필터 결과 조회</td><td>❌</td></tr>
<tr><td>AI 응대 실패 상태 조회</td><td>❌</td></tr>
<tr><td rowspan="8">AI 이미지 지원</td><td rowspan="8">38 일러스트 후보 관리</td><td>일러스트 생성 장면 지정</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>일러스트 생성 요청</td><td>❌</td></tr>
<tr><td>일러스트 후보 목록 조회</td><td>❌</td></tr>
<tr><td>일러스트 후보 상세 조회</td><td>❌</td></tr>
<tr><td>일러스트 후보 채택</td><td>❌</td></tr>
<tr><td>일러스트 후보 거절</td><td>❌</td></tr>
<tr><td>일러스트 후보 삭제</td><td>❌</td></tr>
<tr><td>채택 이미지 원고 삽입</td><td>❌</td></tr>
<tr><td rowspan="10">자율 연재 관리</td><td rowspan="10">39 일정·생성·발행 관리</td><td>자율 연재 일정 등록</td><td>❌</td><td rowspan="10"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>자율 연재 일정 조회</td><td>❌</td></tr>
<tr><td>자율 연재 일정 수정</td><td>❌</td></tr>
<tr><td>자율 연재 켜기</td><td>❌</td></tr>
<tr><td>자율 연재 일시정지</td><td>❌</td></tr>
<tr><td>진행 중 생성 중지 요청</td><td>❌</td></tr>
<tr><td>다음 회차 자동 생성</td><td>❌</td></tr>
<tr><td>생성 회차 발행 조건 검사</td><td>❌</td></tr>
<tr><td>생성 회차 자동 발행</td><td>❌</td></tr>
<tr><td>자율 연재 실행 기록 조회</td><td>❌</td></tr>
<tr><td rowspan="5">캐릭터챗 관리</td><td rowspan="5">77 캐릭터 응답·문맥 보호</td><td>추천 질문 선택 후 캐릭터 답변 요청</td><td>❌</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/47">#47</a></td></tr>
<tr><td>자유 질문 입력 후 캐릭터 답변 요청</td><td>❌</td></tr>
<tr><td>읽은 회차 기준으로 인물·답변 범위 제한</td><td>❌</td></tr>
<tr><td>응답 근거 회차·근거 없음 표시</td><td>❌</td></tr>
<tr><td>미열람 회차 질문의 답변 보류·스포일러 차단</td><td>❌</td></tr>
</tbody>
</table>

## 운영 관리 서비스 — 운영 업무·LLMOps

관리자 화면 연결까지 확인한 운영 기능은 ✅로 표시한다. 계약: [회원·신고](design/operations-member-report-contract.md) · [공지](design/operations-notice-contract.md) · [문의](design/operations-support-inquiry-contract.md) · [이벤트](design/operations-event-contract.md) · [작품](design/operations-work-contract.md).

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="120">운영 관리 서비스</td><td>실행 기반</td><td>89 독립 앱 실행</td><td>운영 서비스 독립 Spring Boot 실행 기반(loopback 8082 유지)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td><td>—</td></tr>
<tr><td rowspan="6">운영 API 공통 기반</td><td rowspan="6">91 서비스 자격·저장 격리</td><td>전용 X-Operations-Service-Token으로 서비스 호출 인증(사람의 관리자 권한 아님)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td><td rowspan="6">—</td></tr>
<tr><td>미설정·공백·잘못된 서비스 자격의 보호 접근 거절</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>독립 operations schema·전용 Flyway 이력과 JPA validate 저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>서비스 요청을 쿠키·세션 인증 없이 stateless 처리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>HTTP 상태를 보존하는 안전한 공통 오류 DTO 반환(예외 원문 비노출)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>Operations 변경의 순수 단위·격리 통합 CI 범위 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td rowspan="1">권한 관리</td><td rowspan="1">03 접근·공개 범위 관리</td><td>운영 권한 확인</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/171">PR #171</a></td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td rowspan="13">신고·운영 관리</td><td rowspan="13">34 신고·소명·조치 관리</td><td>권리 침해 신고 접수</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>유해 콘텐츠 신고 접수</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>내 신고 목록 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 신고 목록 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>신고 상세 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>신고 증거 보완</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>작품 소유자 소명 제출</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>소명 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 검토 결과 기록</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>대상 콘텐츠 제한</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>대상 콘텐츠 제한 해제</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 조치 이력 조회</td><td>✅</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>작품 등록자에게 권리 증빙 요청</td><td>✅</td><td>—</td></tr>
<tr><td rowspan="8">정기 작업 관리</td><td rowspan="8">35 일정·실행 관리</td><td>정기 작업 일정 등록</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>정기 작업 일정 조회</td><td>❌</td></tr>
<tr><td>정기 작업 일정 변경</td><td>❌</td></tr>
<tr><td>정기 작업 일정 취소</td><td>❌</td></tr>
<tr><td>예정 작업 실행</td><td>❌</td></tr>
<tr><td>작업 실행 기록 조회</td><td>❌</td></tr>
<tr><td>실패 작업 조회</td><td>❌</td></tr>
<tr><td>실패 작업 수동 재실행</td><td>❌</td></tr>
<tr><td rowspan="21">고객지원 관리</td><td rowspan="21">67 문의 접수·답변</td><td>문의 유형(category)을 포함한 문의 레코드 등록(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td><td rowspan="21"><a href="design/operations-support-inquiry-contract.md">계약</a></td></tr>
<tr><td>내 고객지원 문의 목록 조회</td><td>✅</td></tr>
<tr><td>내 고객지원 문의 본문·처리 상태 조회</td><td>✅</td></tr>
<tr><td>내 고객지원 문의의 운영팀 답변 조회</td><td>✅</td></tr>
<tr><td>운영 문의 레코드 목록 조회(서비스 자격·최대 100개)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의에 속한 답변 레코드 등록(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>운영 문의 레코드 상세 조회(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>운영 문의 레코드 PUT 전체 수정(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>운영 문의 레코드 DELETE 삭제(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의에 속한 답변 레코드 목록 조회(서비스 자격·최대 100개)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의에 속한 답변 레코드 상세 조회(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의에 속한 답변 레코드 PUT 전체 수정(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의에 속한 답변 레코드 DELETE 삭제(서비스 자격)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>답변이 남은 문의의 자동 연쇄 삭제 방지·409 충돌 반환</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의·답변의 필수 값·길이·부모 문의 범위 검증</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>문의 분류·제목·본문의 U+0000을 저장·변경 전에 거절하고 기존 필드 보존(로컬 단위 확인)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>답변 본문의 U+0000을 저장·변경 전에 거절하고 기존 필드 보존(로컬 단위 확인)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>운영 고객지원 문의 처리 상태 조회(후속 업무 계약)</td><td>✅</td></tr>
<tr><td>로그인 회원 고객지원 문의 접수(비로그인은 로그인 안내)</td><td>✅</td></tr>
<tr><td>관리자 회원 문의 목록·상태 필터·상세 조회(feedback 권한)</td><td>✅</td></tr>
<tr><td>관리자 회원 문의 답변 등록·수정·삭제(feedback 권한) <small>(답변 삭제는 현재 행 삭제, DEC-42 소프트 삭제 전환 필요)</small></td><td>✅</td></tr>
<tr><td rowspan="7">공지 관리</td><td rowspan="7">68 공지 게시·조회</td><td>관리자 공지 목록 조회(회원 Bearer·<code>notices</code> 권한·최신 100개)</td><td>✅</td><td rowspan="7"><a href="design/operations-notice-contract.md">공지 계약</a></td></tr>
<tr><td>독자 공지 목록·상세 조회(<code>/me/notice</code>, 인증 없음)</td><td>✅</td></tr>
<tr><td>운영 공지 공개 게시(등록 즉시 공개, 예약·고정 없음)</td><td>✅</td></tr>
<tr><td>관리자 공지 등록</td><td>✅</td></tr>
<tr><td>관리자 공지 PUT 전체 수정</td><td>✅</td></tr>
<tr><td>관리자 공지 DELETE 삭제 <small>(현재 행 삭제, DEC-42 소프트 삭제 전환 필요)</small></td><td>✅</td></tr>
<tr><td>공지 필수 값·길이 검증 후 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/215">PR #215</a></td></tr>
<tr><td rowspan="10">이벤트 관리</td><td rowspan="10">69 이벤트 안내·운영</td><td>독자용 공개 이벤트 목록 조회(비로그인·종료 포함·최신 100개)</td><td>✅</td><td rowspan="10">—</td></tr>
<tr><td>이벤트 상세·선택 기간 조회(관리자·독자, KST 표시·UTC 저장)</td><td>✅</td></tr>
<tr><td>관리자 이벤트 등록(회원 Bearer·events 권한)</td><td>✅</td></tr>
<tr><td>관리자 이벤트 목록 조회(최대 100개)</td><td>✅</td></tr>
<tr><td>이벤트 진행·종료 상태 변경(종료 시각 수정)</td><td>✅</td></tr>
<tr><td>이벤트 진행 상태 조회(기간으로 상시·예정·진행 중·종료 계산)</td><td>✅</td></tr>
<tr><td>관리자 이벤트 전체 수정(기간 비우기 포함)</td><td>✅</td></tr>
<tr><td>관리자 이벤트 확인 후 삭제</td><td>✅</td></tr>
<tr><td>이벤트 기간 역전·필수 값·길이 검증 후 변경</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td>이벤트 제목·본문의 U+0000을 저장·변경 전에 거절하고 기존 필드·기간 보존(로컬 단위 확인)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/164">PR #164</a></td></tr>
<tr><td rowspan="4">관리자 계정·권한 관리</td><td rowspan="4">71 관리자 계정 등록·권한</td><td>관리자 계정 목록 조회</td><td>✅</td><td rowspan="4">—</td></tr>
<tr><td>관리자 계정 생성</td><td>✅</td></tr>
<tr><td>관리자 계정 생성 시 업무별 권한 부여</td><td>✅</td></tr>
<tr><td>관리자별 부여 권한 조회</td><td>✅</td></tr>
<tr><td rowspan="2">운영 감사 관리</td><td rowspan="2">72 관리자 활동 기록</td><td>관리자 조치의 수행자·시각·대상·내역 기록</td><td>❌</td><td rowspan="2"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/274">PR #274</a></td></tr>
<tr><td>관리자 전체 활동 로그 최신순 조회</td><td>❌</td></tr>
<tr><td rowspan="7">회원 운영 관리</td><td rowspan="7">73 운영 회원 조회·조치</td><td>운영 회원 목록·역할·상태 조회</td><td>✅</td><td rowspan="7">—</td></tr>
<tr><td>역할별 회원 목록 필터</td><td>✅</td></tr>
<tr><td>회원 이름·이메일 검색</td><td>✅</td></tr>
<tr><td>회원 가입 최신순 정렬</td><td>✅</td></tr>
<tr><td>회원 가입 오래된순 정렬</td><td>✅</td></tr>
<tr><td>회원 이용 제한</td><td>✅</td></tr>
<tr><td>회원 이용 제한 해제</td><td>✅</td></tr>
<tr><td rowspan="9">콘텐츠 운영 관리</td><td rowspan="5">74 운영 작품 조회</td><td>운영 작품 목록·작성자·권리·공개 상태 조회</td><td>✅</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/226">PR #226</a></td></tr>
<tr><td>운영 작품 원작·Fork 필터</td><td>✅</td></tr>
<tr><td>운영 작품명·작성자·권리 유형 검색</td><td>✅</td></tr>
<tr><td>운영 작품 제목순 정렬</td><td>✅</td></tr>
<tr><td>운영 작품 제목 역순 정렬</td><td>✅</td></tr>
<tr><td rowspan="4">75 운영 댓글 조회·조치</td><td>작품별 운영 댓글 필터</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/265">PR #265</a></td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/265">PR #265</a></td></tr>
<tr><td>운영 댓글 내용·작품명·작성자 검색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/265">PR #265</a></td></tr>
<tr><td>운영 댓글 공감 많은순 정렬</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/265">PR #265</a></td></tr>
<tr><td>운영 댓글 공감 적은순 정렬</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/265">PR #265</a></td></tr>
<tr><td rowspan="2">운영 현황 관리</td><td rowspan="2">85 업무·데이터 현황 조회</td><td>답변 대기 문의·접수 신고·작가 검토 대기 수 조회</td><td>❌</td><td rowspan="2">—</td></tr>
<tr><td>수집 자료 출처·수량·형식·사용처 명세 조회</td><td>❌</td></tr>
<tr><td rowspan="29">LLMOps</td><td rowspan="7">40-A AI 호출 추적</td><td>AI 작업별 추적 기록 저장</td><td>❌</td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>AI 호출 기록 목록 조회</td><td>❌</td></tr>
<tr><td>AI 호출 기록 상세 조회</td><td>❌</td></tr>
<tr><td>요청 ID 기반 실행 단계 조회</td><td>❌</td></tr>
<tr><td>토큰 사용량 조회</td><td>❌</td></tr>
<tr><td>응답 지연 조회</td><td>❌</td></tr>
<tr><td>실행 성공·실패 상태 조회</td><td>❌</td></tr>
<tr><td rowspan="6">40-B 프롬프트·모델 버전 관리</td><td>모델 버전 등록</td><td>❌</td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>모델 버전 조회</td><td>❌</td></tr>
<tr><td>프롬프트 버전 등록</td><td>❌</td></tr>
<tr><td>프롬프트 버전 조회</td><td>❌</td></tr>
<tr><td>프롬프트 이전 버전 복원</td><td>❌</td></tr>
<tr><td>생성 결과의 사용 모델·프롬프트 버전 조회</td><td>❌</td></tr>
<tr><td rowspan="5">40-C 회귀 평가</td><td>고정 평가 세트 관리 범위 확정</td><td>❌</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>회귀 평가 실행</td><td>❌</td></tr>
<tr><td>회귀 평가 결과 조회</td><td>❌</td></tr>
<tr><td>기존 버전과 평가 결과 비교</td><td>❌</td></tr>
<tr><td>배포 전 평가 통과 여부 확인</td><td>❌</td></tr>
<tr><td rowspan="8">40-D 품질·비용 지표</td><td>AI 오류 지표 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>AI 시간 초과율 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>AI 비용 지표 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>제안 채택률 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>수정안 승인률 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>필터 복원률 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>운영 경고 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>실패·지연 경고 확인 및 수동 조치 완료 기록</td><td>❌</td><td>—</td></tr>
<tr><td rowspan="3">40-E 정보 누설 표본 검사</td><td>AI 응답 정보 누설 표본 검사</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>정보 누설 의심 결과 조회</td><td>❌</td></tr>
<tr><td>정보 누설 의심 경고 기록</td><td>❌</td></tr>
</tbody>
</table>

## Frontend · 앱 · 운영 기반

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="114">Frontend</td><td rowspan="54">웹 화면</td><td rowspan="8">92 정본 읽기 전환</td><td>런타임 샘플 주입을 제거하고 명시적 테스트 fixture로 격리</td><td>❌</td><td rowspan="8">—</td></tr>
<tr><td>서버 slug 메타데이터로 기존 경로의 UUID 집필실 연결</td><td>❌</td></tr>
<tr><td>조회 실패 시 샘플 fallback 없이 오류·재시도 제공</td><td>❌</td></tr>
<tr><td>인증·작품·회차 범위 변경 후 오래된 비동기 결과 차단</td><td>❌</td></tr>
<tr><td>canonical 작품의 허구 통계·순위·증빙 표시 제외</td><td>❌</td></tr>
<tr><td>미지원 aggregate 저장을 오류로 반환하고 입력 보존</td><td>❌</td></tr>
<tr><td>canonical 피드백 변경의 메모리 저장·접수 성공 거절</td><td>❌</td></tr>
<tr><td>canonical 운영 조치의 데모 상태 변경·승인 성공 거절</td><td>❌</td></tr>
<tr><td rowspan="14">41 업무 화면 연결</td><td>목록 화면 API 연결 <small>(팀 서재에 서버 작품 조회·집필 진입 연결 및 제목·버튼 여백 정리, 로컬 구현·CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td><td rowspan="14"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/29">#29</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/23">#23</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/25">#25</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>상세 화면 API 연결</td><td>❌</td></tr>
<tr><td>등록 화면 API 연결</td><td>❌</td></tr>
<tr><td>수정 화면 API 연결 <small>(회차 집필에 팀 레이아웃 재사용·제목/본문 입력은 UI 서체 적용, 로컬 구현·CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td>삭제 확인 화면 API 연결</td><td>❌</td></tr>
<tr><td>파일 업로드 화면 연결</td><td>❌</td></tr>
<tr><td>파일 다운로드 처리</td><td>❌</td></tr>
<tr><td>AI 실행 화면 연결</td><td>❌</td></tr>
<tr><td>승인 화면 연결</td><td>❌</td></tr>
<tr><td>저장 충돌 안내 <small>(집필 상단·버전 공개 시트에 오류 표시, 로컬 구현·CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td>인증 만료 안내</td><td>❌</td></tr>
<tr><td>키보드 접근성 확인</td><td>❌</td></tr>
<tr><td>공통 시트의 summary 키보드 탐색 <small>(초기 포커스·Tab/Shift+Tab 순환, 로컬 구현·CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/139">PR #139</a></td></tr>
<tr><td>모바일 화면 대응 <small>(서버 집필실 툴바·회차 버튼 정렬 및 터치 영역 정리, 로컬 구현·CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/110">PR #110</a></td></tr>
<tr><td rowspan="22">56 공통 사용자 환경</td><td>앱 라이트·다크 모드 전환</td><td>❌</td><td rowspan="22"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/24">#24</a></td></tr>
<tr><td>홈 단색 배경 보조 텍스트의 라이트·다크 대비 확보</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 Hero 자동 넘김을 이름 있는 정지·재생 제어로 조작</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 Hero 포커스·수동 전환 후 명시적 재생 전까지 자동 넘김 정지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 Hero hover 중 자동 넘김 정지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>동작 줄이기 설정에서는 홈 Hero 자동 넘김 JS 타이머 미생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 Hero 비활성 카드를 키보드·접근성 탐색에서 제외</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>모바일 홈 Hero를 이전·다음·슬라이드 선택으로 전환</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 이어 읽기·Fork 발견·순위의 DOM·탭·읽기 순서 일치</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>모바일 홈 인기 순위는 3개를 먼저 보여 주고 전체 순위로 이동</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 필터 Fork 카드에 확인 가능한 공개 원작 제목·기준 회차 표시</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 선택 필터의 눌림 상태를 보조 기술에 제공</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>공유 Go를 주소·라우터 state·클릭 콜백을 유지하는 네이티브 링크로 탐색</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>비활성 Go 회차의 주소·탭 진입·클릭 탐색 차단</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 화면·섹션·작품의 h1·h2·h3 제목 계층 제공</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>홈 더보기·전체 보기의 최소 44px 터치 영역 제공</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>모바일 홈·공유 셸 검색·계정·필터·알림·테마의 최소 44×44px 터치 영역 제공</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>공유 푸터의 데모 초기화·로그인 제거 (상단 계정/로그인·데모 고지 유지)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>GNB 크레딧 정책 버튼의 문구를 줄바꿈 없이 유지 (데모 꼬리표 제거·모바일 숨김 유지)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td>GNB 세계관 메뉴의 데모 꼬리표 제거·기존 이동 경로 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/153">PR #153</a></td></tr>
<tr><td>크레딧 메뉴의 데모 꼬리표 제거·정책의 실제 결제 및 차감 없음 안내 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/153">PR #153</a></td></tr>
<tr><td>개발 환경에서만 화면 ID 표시·토글 제공 (일반 화면 테마 전환·인증 경로 제외 유지)</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/151">PR #151</a></td></tr>
<tr><td rowspan="1">60 설정 문서 탐색</td><td>설정 본문·속성의 다른 문서 이름을 내부 링크로 탐색</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="4">63 원고 편집 보조</td><td>원고 글자 수 확인</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td>데모 집필실에서 동작별 저장 표시 제어</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/189">PR #189</a></td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/6">#6</a></td></tr>
<tr><td>저장 표시 없이 AI 요청 입력을 데모 초안에 보존</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/189">PR #189</a></td></tr>
<tr><td>원고 수정 후 재검사 전까지 설정 검사 무효 표시 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/189">PR #189</a></td></tr>
<tr><td rowspan="1">64 발행 전 검토</td><td>공개 확정 전 선택 저장 원고 미리보기 <small>(팀 공통 시트 연결, 로컬 구현·CI 대기)</small></td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="1">65 미저장 작업 보호</td><td>미저장 원고·설정이 있을 때 이탈 또는 대상 전환 확인</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="3">66 요청 제어</td><td>진행 중 원고 저장 요청 취소</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>진행 중 파일 요청 취소</td><td>❌</td></tr>
<tr><td>취소 후 서버 처리 여부 재확인 안내</td><td>❌</td></tr>
<tr><td rowspan="49">운영 화면</td><td rowspan="49">92 독립 운영 레코드 데모</td><td>독립 운영 공지 목록 조회</td><td>❌</td><td rowspan="49">—</td></tr>
<tr><td>독립 운영 공지 상세 조회</td><td>❌</td></tr>
<tr><td>UUID로 독립 운영 공지 등록</td><td>❌</td></tr>
<tr><td>독립 운영 공지 제목·본문 전체 수정</td><td>❌</td></tr>
<tr><td>사용자 확인 후 독립 운영 공지 삭제</td><td>❌</td></tr>
<tr><td>독립 운영 이벤트 목록 조회</td><td>❌</td></tr>
<tr><td>독립 운영 이벤트 상세 조회</td><td>❌</td></tr>
<tr><td>UUID로 독립 운영 이벤트 등록</td><td>❌</td></tr>
<tr><td>독립 운영 이벤트 제목·본문·기간 전체 수정</td><td>❌</td></tr>
<tr><td>사용자 확인 후 독립 운영 이벤트 삭제</td><td>❌</td></tr>
<tr><td>독립 운영 문의 레코드 목록 조회</td><td>❌</td></tr>
<tr><td>독립 운영 문의 레코드 상세 조회</td><td>❌</td></tr>
<tr><td>분류·제목·본문으로 독립 운영 문의 레코드 등록</td><td>❌</td></tr>
<tr><td>독립 운영 문의 레코드 분류·제목·본문 전체 수정</td><td>❌</td></tr>
<tr><td>사용자 확인 후 독립 운영 문의 레코드 삭제</td><td>❌</td></tr>
<tr><td>선택 문의 아래의 여러 답변을 등록 순서로 목록 조회</td><td>❌</td></tr>
<tr><td>문의 하위 개별 답변 본문·등록/수정 시각 조회</td><td>❌</td></tr>
<tr><td>선택 문의 아래에 새 독립 답변 등록</td><td>❌</td></tr>
<tr><td>선택 문의 하위 답변 본문 전체 수정</td><td>❌</td></tr>
<tr><td>사용자 확인 후 선택 문의 하위 답변 삭제</td><td>❌</td></tr>
<tr><td>다른 부모 문의의 답변 접근 거절</td><td>❌</td></tr>
<tr><td>답변이 남은 문의 삭제를 막고 답변 우선 삭제 안내</td><td>❌</td></tr>
<tr><td>이벤트 시작·종료의 선택 입력과 기간 비우기</td><td>❌</td></tr>
<tr><td>브라우저 시간대와 무관한 KST 입력의 UTC 변환</td><td>❌</td></tr>
<tr><td>저장 UTC 기간의 명시적인 한국시간 표시</td><td>❌</td></tr>
<tr><td>유효하지 않은 날짜·자유문자열 기간 거절</td><td>❌</td></tr>
<tr><td>종료가 시작보다 빠른 이벤트 기간 거절</td><td>❌</td></tr>
<tr><td>운영 공지·이벤트·문의·답변의 필수 입력·길이 검사</td><td>❌</td></tr>
<tr><td>관리자 데이터 최초 조회 중 로딩 안내</td><td>❌</td></tr>
<tr><td>관리자 데이터 조회 실패를 성공과 구분해 안내</td><td>❌</td></tr>
<tr><td>조회 성공한 운영 빈 목록 안내</td><td>❌</td></tr>
<tr><td>조회 실패 후 다시 불러오기</td><td>❌</td></tr>
<tr><td>목록 재조회 중 이전 데이터 유지와 갱신 중 표시</td><td>❌</td></tr>
<tr><td>화면 이탈·요청 교체 후 늦게 도착한 조회 응답 무시</td><td>❌</td></tr>
<tr><td>변경 요청 처리 중 pending 안내와 해당 폼 비활성화</td><td>❌</td></tr>
<tr><td>요청 키별 진행 중 중복 호출 방지</td><td>❌</td></tr>
<tr><td>변경 요청 실패 안내와 입력 초안 보존</td><td>❌</td></tr>
<tr><td>저장 성공과 후속 목록 재조회 실패를 구분해 중복 저장 경고</td><td>❌</td></tr>
<tr><td>최초 조회·갱신 중 또는 조회 오류 상태의 변경 요청 차단</td><td>❌</td></tr>
<tr><td>탭·목록/상세 이동 시 레코드별 작성·수정·답변 초안 유지</td><td>❌</td></tr>
<tr><td>탭 이동 후 운영 레코드 선택 유지</td><td>❌</td></tr>
<tr><td>목록 선택·복귀에 맞춘 상세 제목·원래 목록 버튼 포커스 이동</td><td>❌</td></tr>
<tr><td>답변 삭제 후 답변 목록 제목으로 포커스 이동</td><td>❌</td></tr>
<tr><td>운영 본문·답변의 일반 텍스트 줄바꿈 표시</td><td>❌</td></tr>
<tr><td>관리자 로그인 복귀에 허용된 내부 탭만 보존</td><td>❌</td></tr>
<tr><td>기존 회원용 공지·이벤트 호환 데모를 운영 레코드와 별도로 유지</td><td>❌</td></tr>
<tr><td>기존 회원 내 문의·단일 답변 데모를 별도로 유지</td><td>❌</td></tr>
<tr><td>기존 작가 제보·검토 데모를 운영 문의와 별도로 유지</td><td>❌</td></tr>
<tr><td>메모리 데모 초기화·실제 API/관리자 인증 미연결 한계 안내</td><td>❌</td></tr>
<tr><td rowspan="7">독서 관리</td><td rowspan="1">48 공개 열람</td><td>공개 회차 목록 오래된 순·최신 순 전환</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td rowspan="3">50 공유</td><td>작품 링크 공유</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td>회차 링크 공유</td><td>❌</td></tr>
<tr><td>선택 문장 인용 공유</td><td>❌</td></tr>
<tr><td rowspan="3">51 열람 환경 설정</td><td>뷰어 배경 모드 변경</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a></td></tr>
<tr><td>뷰어 배경 움직임 켜기·끄기</td><td>❌</td></tr>
<tr><td>뷰어 글자 크기 조절</td><td>❌</td></tr>
<tr><td rowspan="1">이벤트 관리</td><td rowspan="1">70 이벤트 안내·운영</td><td>이벤트 안내에서 관련 기능으로 이동</td><td>❌</td><td rowspan="1">—</td></tr>
<tr><td rowspan="1">알림 관리</td><td rowspan="1">80 알림 대상 화면 이동</td><td>알림 선택 후 관련 업무 화면으로 이동</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a></td></tr>
<tr><td rowspan="2">창작 이용 안내</td><td rowspan="2">84 집필 방식·저작권 사전 확인</td><td>Fork 집필 정책과 저작권 안내 개별 확인 후 계속</td><td>❌</td><td rowspan="2">—</td></tr>
<tr><td>원고 가져오기 정책과 AI 처리 이용 권한 안내 개별 확인 후 계속</td><td>❌</td></tr>
<tr><td rowspan="4">Android / iOS</td><td rowspan="4">모바일 앱</td><td rowspan="4">42 앱 제공</td><td>Android 지원 범위 결정</td><td>❌</td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>Android 앱 제공</td><td>❌</td></tr>
<tr><td>iOS 지원 범위 결정</td><td>❌</td></tr>
<tr><td>iOS 앱 제공</td><td>❌</td></tr>
<tr><td rowspan="24">운영·인프라</td><td rowspan="24">운영 기반</td><td rowspan="24">43 저장·배포·복구 관리</td><td>Core Health 조회</td><td>❌</td><td rowspan="24"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/63">#63</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/64">#64</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/67">PR #67</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/80">PR #80</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/94">PR #94</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/65">PR #65</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/77">PR #77</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/45">PR #45</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/103">#103</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/141">#141</a></td></tr>
<tr><td>AI Health 조회</td><td>❌</td></tr>
<tr><td>DB 마이그레이션 관리 · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/98">PR #98</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/104">PR #104</a></td><td>❌ (WorldStudio CD stdin·인증 테스트를 Content Service 이관에 맞춰 통합·PR 미병합·실제 개발 DB 미확인·기본 비활성)</td></tr>
<tr><td>파일 저장소 연결 관리</td><td>❌</td></tr>
<tr><td>백업 생성</td><td>❌</td></tr>
<tr><td>복원 수행</td><td>❌</td></tr>
<tr><td>CI 결과 확인</td><td>❌</td></tr>
<tr><td>Core·Content 동시 이미지 빌드의 Gradle 공유 캐시 잠금 <small>(정적 회귀 확인·hosted CI 대기)</small></td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/111">PR #111</a></td></tr>
<tr><td>배포 상태 확인</td><td>❌</td></tr>
<tr><td>장애 상태 확인</td><td>❌</td></tr>
<tr><td>루트 기본 Compose 명령으로 로컬 네 앱 소스 빌드 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>로컬 web·API·DB·Mailpit 포트의 loopback 바인딩</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>로컬·개발 서버의 프로젝트별 DB volume 격리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>개발 서버의 네 앱을 게시된 develop 이미지로 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>로컬·개발 서버의 내부 PostgreSQL 연결</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>로컬·개발 서버의 내부 Mailpit SMTP 연결</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>개발 CD의 내부 DB 전환 미승인 시 실행 차단</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>운영 준비 구성의 네 앱을 main runtime 이미지로 선택</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>운영 준비 구성의 외부 PostgreSQL 연결 입력 분리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>운영 준비 구성의 외부 SMTP 연결 입력 분리</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>운영 필수 PROD 설정 누락 시 Compose 구성 실패</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>운영 쿠키의 Secure 강제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>CI HTTP 시스템 검증의 소스 빌드 overlay 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
<tr><td>선택 로컬 MinIO 첨부 overlay의 소스 빌드 조합 유지</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/143">PR #143</a></td></tr>
</tbody>
</table>

## 공통 이슈

| 이슈 | 추적 |
|---|---|
| 구현 상태 문서 정렬 | <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/72">#72</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/75">#75</a> |
| 전체 서비스와 MVP 정책 충돌 정리 | — |
| 회원·작품·Fork·정본·파일의 삭제 정책 구분 | — |
| Content 책임 분리·DTO·영속성 지침 정렬 | <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/84">#84</a> |
| 그래프·체크포인트 정합성 계약 | <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> |
| 실제 기능·화면·최신 CI 완료 확인 | <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/72">#72</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> |

### Draft 후보의 해석·확인 근거

다음은 Draft의 실제 변경 코드·설계와 기존 표를 대조해 추가한 **채택 미확정 후보**다. 기능표에 기록하는 것과 최종 제품·스키마·구현 채택은 구분하며, 모두 ❌로 표시한다. 기존 05·08은 새 중간 기능을 중복 생성하지 않고 후보 보완 동작을 해당 서브시스템 안에 배치했다.

- 세계관 전체 확정 버전은 회차 체크포인트와 구분한다. 복원은 과거 이력을 삭제하지 않고 새 버전으로 남긴다.
- 관계 초안은 연결 대상이 미완성인 편집 상태를 포함한다. 미확정 초안 제거와 확정 관계의 이력 보존 정정을 구분한다. 상세 확정·삭제 정책은 후속 합의 대상이다.
- 설정 카드 유형과 주제 영역의 분리·변경은 PR #86의 제안 범위다. 유형 목록·영역 목록·레거시 변환 정책을 이번 추가로 최종 확정하지 않는다.
- 기존 04 세계관 생성은 작품·회차 없이 작성 가능한 독립 세계관 계약도 검토한다. 같은 생성 기능을 별도 행으로 중복 추가하지 않는다.
- PR #86 확인 head: `618b0f9f60e9ec3361838962dba6166677fe9db5` (문서 설계 제안). PR #91 확인 head: `7429af0d051c35ff6f7441eac063030945987617` (미병합 구현 Draft). 확인 기준은 2026-11-04이며 병합·운영 검증 완료로 해석하지 않는다.

### 초기 세계관 AI 전처리 저장 구조 — PR #225

- 진행 중·미병합: 분석 snapshot, 후보, 검토 이력, 반영 ID 예약의 PostgreSQL/JPA 저장 구조. [범위와 후속 조건](design/initial-world-analysis-storage.md).
- #219 계약 의존. AI 실행·공개 API·실제 초안 반영·검토 UI는 미구현이며 전체 기능 완료로 체크하지 않는다. #223 디자인과 분리.

### 초기 세계관 AI 추출 5-B — 진행 중·미병합

내부 추출 API·Responses 호출·7종 후보/근거 검증을 구현한다. [범위와 검증 한계](design/initial-world-ai-extraction.md). 제공사 대역 검증이며 실제 모델 품질·Content 연결·저장·승인은 미완료이므로 상위 추출 기능의 완료 표시는 유지한다. #219·#225·#235에 의존하며 #122 회차 추출과 분리한다.

### 초기 세계관 분석 실행·저장 5-C — PR #266

진행 중·Draft·미병합: 소유자 분석 요청, 입력 snapshot/상태 저장, 트랜잭션 밖 AI 호출, Output 재검증, 후보 원자 저장 및 조회. [실행 계약·의존성·실패 복구](design/initial-world-analysis-execution.md). 실제 모델 품질·승인/반영은 미검증·미구현이며 상위 기능 완료로 표시하지 않는다.

### 초기 세계관 후보 검토 6-A — PR #270

Draft·미병합: approve/edit/hold/reject 결정 누적, 작가 수정본·AI 근거 분리, 멱등성·순번 충돌·stale 검증 및 이력 재조회. [검토 계약과 6-B 경계](design/initial-world-candidate-review.md). 승인 후보 초안 반영·UI는 아직 미구현이며 상위 기능 완료로 표시하지 않는다.

### 초기 세계관 승인 후보 초안 반영 6-B — PR #284

Draft·미병합: 최신 승인 검증·UUID/payload 예약, replace:false 추가, 기존 Neo4j 현재 상태 CAS와 카드/revision/receipt 원자 완료, 동일 key 장애 복구. [반영 계약·검증·한계](design/initial-world-approved-application.md). UI·확정 버전·과거 관계 복원은 별도이며 상위 기능 전체 완료로 표시하지 않는다.

- 초기 세계관 7-A: AI 추가 카드·관계 DTO/metadata 왕복 어댑터 구현(Draft, 미병합). 후보 검토 UI는 후속.

- 초기 세계관 7-B: 실제 Content 분석·후보 검토·초안 반영 UI 구현(Draft, 미병합). 유료 모델 품질/실제 배포 수용은 미검증.

- WorldStudio 8단계: 명시적 확정 버전 생성·목록·읽기 전용 상세 UI(Draft, 미병합). 과거 관계/복원/발행은 제외.

- WorldStudio 9-A: 소유자용 확정 설정 내부 Context 구성·출처/의미 메타데이터 보존. Draft PR 검증 중이며 공개 API·전체 집필 Context·회차/Fork/MCP·과거 관계는 미연결. [계약](design/worldstudio-confirmed-context.md).
