# STORYFORK 기능 분류표

> 예시 이미지처럼 **서비스 → 서브시스템 → 중간 기능 → 세부 기능**을 계층으로 묶고, **세부 동작 하나당 한 행**으로 정리한다. 현재 구현과 앞으로 개발할 전체 서비스 기능을 함께 포함한다.

## 표 기준

> **서비스 열은 DEC-41의 목표 소유권이다.** [서비스 경계·실행 구조](design/service-boundaries.md)를 따른다. 기존 ✅는 해당 동작의 종전 구현 근거이지 새 서비스로의 이전 완료가 아니다. Core→Content 업무·테스트·인증 확인·라우팅·이미지/CI 연결은 소스에 반영했으며 hosted CI·실제 DB 전환·배포는 대기다. 아래 이전 기능의 ✅를 이번 추출 완료로 승격하지 않는다. LLMOps는 운영 영역으로 분류하되 Langfuse 자체 UI와 운영 화면 API 통합은 미정이며 Spring 내부 구현을 뜻하지 않는다. 정기 작업 행은 운영의 감시·관리 관점이고 실제 실행은 업무 소유 서비스에 둔다.


- **개발 완료:** ✅는 해당 세부 동작을 명시적으로 구현한 PR이 병합됐고 그 PR 최신 head의 `Required CI` 성공을 확인한 항목이다. ❌는 미구현·부분 구현·열린 PR·병합 없는 종료·완료 근거 미확인을 포함한다. ❌가 코드가 전혀 없다는 뜻은 아니다.
- ✅는 표에 적힌 동작의 개발 반영 기준이며 운영 배포·전체 사용자 흐름의 수용 완료가 아니다. PR #93의 보호 흐름 브라우저 E2E 등 PR에 남은 검증 한계는 유지된다. 설정 이미지·표지·원고 이미지는 각각의 지원 동작을 구분한다. 원고 이미지는 버전 보존용 불변 파일이므로 일반 파일처럼 교체·물리 삭제 CRUD를 강제하지 않는다.
- `#52`는 이슈, `PR #71`은 Pull Request다. 링크가 여러 개여도 관련 범위만 추적하며 PR 상태·세부 한계는 아래 PR 목록을 따른다. 열린 원래 이슈를 임의로 종료하지 않는다.

- 서브시스템은 회원 관리·세계관 관리·Fork 관리 같은 업무 분류다. 서비스 열은 Core·콘텐츠·운영·AI 및 클라이언트의 목표 책임을 나타낸다. 콘텐츠 서비스 + AI 서비스는 콘텐츠의 인가·기록·승인·반영과 AI의 생성·실행이 함께 필요한 기능이다. 업무 분류마다 서버를 추가하지 않는다.
- 같은 서브시스템·중간 기능은 셀을 병합했다. 관련 이슈도 중간 기능 단위로 묶고 기존 이슈·PR·미등록 번호 링크를 중복 없이 모았다. 각 항목은 관련 GitHub 이슈 링크 또는 문서 내 미등록 번호로 추적한다.
- 현재/향후·범위 열은 삭제했다. GitHub 이슈 링크는 관련 범위의 추적 근거이며, 그 이슈가 해당 칸의 모든 세부 정책을 확정하거나 구현을 완료했다는 뜻은 아니다.
- 삭제 요청은 정책 검토 대상이다. 세계관·설정·상태·관계 정본은 물리 삭제 대신 이력 보존·revert 원칙을 적용한다. 회원·작품·Fork·파일 삭제는 참조·보관 정책을 따른다.
- 향후 기능도 포함하지만 미정인 API·스키마·가격·한도·MVP 포함 여부를 확정하지 않는다. 중간 기능 이름 앞의 두 자리 번호는 기능 묶음 번호다. `#숫자` 링크는 실제 GitHub 이슈, `미등록-숫자`는 아직 대응 이슈가 없는 문서 내 관리 번호다.
- LLMOps는 전체 서비스 개발 대상으로 명시했으며 이번 문서 변경으로 Langfuse 설치·연동 또는 평가 구현이 완료되는 것은 아니다. 프롬프트·모델 변경이 과거 생성 결과를 바꾸지 않으며, 추적에는 원고 전문·비공개 설정·개인정보·키를 기록하지 않는다. 원고 이미지의 목록·대체 텍스트·참조 제거는 이번 완료 근거를 확인하지 않아 ❌로 유지했다.
- 검색·랭킹·홈 편성은 기존 데모 화면을 기준으로 분류했다. 최신 순·인기 순·조회 순은 작품 정렬이지 검색어 순위가 아니다. 실시간·24시간·주간 문구만으로 실제 기간 집계 구현을 인정하지 않는다. 인기 검색어는 추가 검토로 도입 미확정이며, 별도 검색 MSA·검색 엔진을 이 표로 확정하지 않는다.
- 중간 기능 또는 세부 기능의 `(Draft 검토 후보)` 표시는 채택 미확정을 뜻한다. 다른 기능과 같은 표 안에 있어도 구현·정책 채택이 확정된 것은 아니며 관련 PR과 검토 근거를 확인한다.
- 중간 기능 통합: 58→05, 49→20, 52→21-C, 79→31, 82→34, 81→40-D. 21은 좋아요(21-A)·관심 작품(21-B)·독서 기록(21-C)으로 구분했다. 기존 기능을 삭제하거나 미등록 번호를 재발급하지 않았으며, 05·08의 Draft 보완 동작은 해당 세부 행에 후보 표시를 유지한다.
- 독립 WorldStudio 저장소·Service의 로컬 구현 범위는 해당 행에 표시했다. Content 없이 전용 schema에서 동작하며 HTTP API·프런트·Graph·이미지·회차 연동은 포함하지 않는다. PR #97은 develop에 병합됐지만 HTTP 미연결이므로 완료 표시는 ❌를 유지한다. WorldStudio 실행 코드·Kotlin/Java 테스트는 content-service로 추출했으며 같은 contentDataSource와 전용 EntityManager/TransactionManager를 쓴다. 소스 추출은 실제 DB 적용·HTTP 연결 완료가 아니다.
- 작품 삭제 PR #106은 소유자·이력 없는 원작 범위를 유지한다. 세계관 설정이 있으면 삭제 전에 409와 설정 안내를 반환하고 데이터를 보존하도록 로컬 보완했으며, 미병합·최신 Required CI 확인 대기이므로 ❌를 유지한다. 설정 연쇄 삭제와 #108 Fork 독립 후속 작업은 이번 수정에 포함하지 않는다.
- CI 인증·Health 통합 회귀는 Core의 503 오류를 대역으로 고정하고, Content의 정상 응답에는 기본 3초·시간 초과 검증에는 별도 150ms를 적용하도록 테스트만 보완했다. 503/504/502·자격 분리·redirect 금지·재시도/캐시 금지 계약과 기존 완료 표시는 유지하며, 최신 Required CI 재검증은 대기다.
- 작성 기준: 2026-11-04 로컬 코드·요구사항·설계. HTML 표를 지원하는 Markdown 뷰어에서 병합 셀이 표시된다.


## Core 서비스 — 회원·인증·크레딧·알림

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="48">Core 서비스</td><td rowspan="17">회원 관리</td><td rowspan="9">01 회원 CRUD</td><td>회원가입</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td><td rowspan="9"><a href="#미등록-001">미등록-001</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-002">미등록-002</a></td></tr>
<tr><td>내 회원 정보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>닉네임 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>이메일 변경 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>이메일 변경 인증</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>비밀번호 재설정 요청</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>비밀번호 재설정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>회원 탈퇴 요청</td><td>❌</td></tr>
<tr><td>회원 탈퇴 처리</td><td>❌</td></tr>
<tr><td rowspan="8">02 인증·세션 관리</td><td>이메일 인증</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/74">#74</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/79">PR #79</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>인증 메일 재발송</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그인</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>접근 토큰 갱신</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>로그인 기기 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>특정 기기 로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td>전체 기기 로그아웃</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a></td></tr>
<tr><td rowspan="9">알림 관리</td><td rowspan="9">31 알림 CRUD·수신 설정</td><td>알림 생성</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>내 알림 목록 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>알림 상세 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>알림 읽음 처리</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>알림 삭제</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>알림 수신 설정 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>선택 알림 수신 설정 변경</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>묶음 알림 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-028">미등록-028</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>전체 알림 일괄 읽음 처리</td><td>❌</td><td><a href="/Users/yunseongho/.hermes/cache/scratch/issues/89">#89</a> · <a href="#미등록-104">미등록-104</a></td></tr>
<tr><td rowspan="12">크레딧 관리</td><td rowspan="12">32 지급·사용·정산 관리</td><td>크레딧 잔액 조회</td><td>❌</td><td rowspan="12"><a href="#미등록-029">미등록-029</a> · <a href="#미등록-030">미등록-030</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-031">미등록-031</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>크레딧 지급</td><td>❌</td></tr>
<tr><td>크레딧 지급 내역 조회</td><td>❌</td></tr>
<tr><td>AI 예상 비용 안내</td><td>❌</td></tr>
<tr><td>AI 비용 동의 기록</td><td>❌</td></tr>
<tr><td>AI 사용량 기록</td><td>❌</td></tr>
<tr><td>크레딧 사용 정산</td><td>❌</td></tr>
<tr><td>크레딧 사용 내역 조회</td><td>❌</td></tr>
<tr><td>크레딧 소멸 처리</td><td>❌</td></tr>
<tr><td>크레딧 소멸 내역 조회</td><td>❌</td></tr>
<tr><td>실패 작업 정산 복구</td><td>❌</td></tr>
<tr><td>AI 요청 속도 제한</td><td>❌</td></tr>
<tr><td rowspan="10">결제 관리</td><td rowspan="10">33 구독·결제 관리</td><td>구독 상품 조회</td><td>❌</td><td rowspan="10"><a href="#미등록-032">미등록-032</a> · <a href="#미등록-033">미등록-033</a> · <a href="#미등록-034">미등록-034</a></td></tr>
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
<tr><td rowspan="298">콘텐츠 서비스</td><td>실행 기반</td><td>89 독립 앱 실행</td><td>콘텐츠 서비스 독립 Spring Boot 실행 골격 <small>(ApplicationKt 명시·Studio migration main 보존 계약 확인, bootJar 재검증 대기)</small></td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td>인증 연계</td><td>90 Core 인증 연계</td><td>별도 서비스 자격과 사용자 Bearer로 Core를 호출해 UUID Principal 생성·실패 분류 (로컬 구현)</td><td>❌</td><td><a href="#미등록-113">미등록-113</a></td></tr>
<tr><td>인증 연계</td><td>90 Core 인증 연계</td><td>Core 내부 endpoint에서 서비스 자격·JWT를 확인하고 회원 UUID만 반환 (로컬 구현)</td><td>❌</td><td><a href="#미등록-113">미등록-113</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>기존 콘텐츠·첨부·독립 WorldStudio 실행 코드·테스트의 Content 소유 분리 (로컬 구현)</td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>업무별 fresh 초기 SQL 발견·순서 및 Content migration 소유 분리 (로컬 구현·DB 재생 미실행)</td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>기존 works 공개 URL의 nginx/Vite Content 라우팅 (로컬 소스 계약 확인)</td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>Content 이미지·Compose·CD 연결 (소스 구현·게시/배포 미실행)</td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td>실행 기반</td><td>89 독립 앱 실행</td><td>Content 변경의 CI 통합·소비자·시스템 회귀 선택 (로컬 선택 단위 확인)</td><td>❌</td><td><a href="#미등록-111">미등록-111</a></td></tr>
<tr><td rowspan="8">권한 관리</td><td rowspan="8">03 접근·공개 범위 관리</td><td>작품 소유권 확인</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>세계관 소유권 확인</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td></tr>
<tr><td>설정 항목 공개 범위 설정</td><td>❌</td></tr>
<tr><td>설정 항목 비공개 설정</td><td>❌</td></tr>
<tr><td>설정 공개 회차 변경</td><td>❌</td></tr>
<tr><td>작품 이용 조건 조회</td><td>❌</td></tr>
<tr><td>작품 Fork 생성 허용 설정</td><td>❌</td></tr>
<tr><td>Fork 작품 공개 허용 설정</td><td>❌</td></tr>
<tr><td rowspan="27">세계관 관리</td><td rowspan="5">04 세계관 CRUD</td><td>세계관 생성</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-003">미등록-003</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>세계관 상세 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td></tr>
<tr><td>내 세계관 목록 조회</td><td>❌</td></tr>
<tr><td>세계관 기본 정보 수정</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td></tr>
<tr><td>세계관 삭제 요청</td><td>❌</td></tr>
<tr><td rowspan="13">05 설정 항목 CRUD</td><td>설정 항목 생성</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 상세 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 목록 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 검색</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>설정 초안 저장</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 확정 저장</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 카테고리 변경</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 태그 수정</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 정정</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33">#33</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a></td></tr>
<tr><td>설정 항목 별칭 추가</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="#미등록-083">미등록-083</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 항목 별칭 제거</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="#미등록-083">미등록-083</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>설정 카드 유형 변경 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>세계관 주제 영역 변경 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td rowspan="1">57 세계관·작품 연결</td><td>작품에 사용할 기존 세계관 선택·연결</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/48">#48</a> · <a href="#미등록-082">미등록-082</a></td></tr>
<tr><td rowspan="3">59 설정 문서 속성 편집</td><td>설정 문서 사용자 정의 속성 추가</td><td>❌</td><td rowspan="3"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/48">#48</a> · <a href="#미등록-084">미등록-084</a></td></tr>
<tr><td>설정 문서 사용자 정의 속성 이름 변경</td><td>❌</td></tr>
<tr><td>설정 문서 사용자 정의 속성 값 수정</td><td>❌</td></tr>
<tr><td rowspan="1">61 설정 문서 참조 조회</td><td>현재 설정 문서를 언급한 다른 문서 목록 조회</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/48">#48</a> · <a href="#미등록-086">미등록-086</a></td></tr>
<tr><td rowspan="4">86 세계관 버전 관리 <small>(Draft 검토 후보)</small></td><td>세계관 전체 버전 생성</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>세계관 버전 목록 조회</td><td>❌</td></tr>
<tr><td>세계관 버전 상세 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td></tr>
<tr><td>세계관 이전 버전 복원</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td></tr>
<tr><td rowspan="26">캐릭터·관계 관리</td><td rowspan="5">06 캐릭터 CRUD</td><td>캐릭터 등록</td><td>❌</td><td rowspan="5"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>캐릭터 상세 조회</td><td>❌</td></tr>
<tr><td>캐릭터 목록 조회</td><td>❌</td></tr>
<tr><td>캐릭터 프로필 수정</td><td>❌</td></tr>
<tr><td>캐릭터 정정</td><td>❌</td></tr>
<tr><td rowspan="8">07 상태·지식 관리</td><td>인물 상태 등록</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58">#58</a> · <a href="#미등록-004">미등록-004</a></td></tr>
<tr><td>회차별 인물 상태 조회</td><td>❌</td></tr>
<tr><td>인물 상태 수정</td><td>❌</td></tr>
<tr><td>인물 지식 등록</td><td>❌</td></tr>
<tr><td>시점별 인물 지식 조회</td><td>❌</td></tr>
<tr><td>인물 지식 수정</td><td>❌</td></tr>
<tr><td>인물 상태 이력 조회</td><td>❌</td></tr>
<tr><td>인물 상태 이력 정정</td><td>❌</td></tr>
<tr><td rowspan="13">08 관계 CRUD</td><td>관계 생성</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>관계 상세 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>관계 목록 조회</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>인물관계도 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a></td></tr>
<tr><td>관계 수정</td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>관계 해제 정정</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a></td></tr>
<tr><td>시점별 관계 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a></td></tr>
<tr><td>관계 이력 복원</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-005">미등록-005</a></td></tr>
<tr><td>관계 초안 저장 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>관계 초안 조회 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>관계 초안 수정 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>미확정 관계 초안 제거 <small>(Draft 검토 후보)</small></td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>관계 확정 저장 <small>(Draft 검토 후보)</small></td><td>❌ <small>(독립 JPA 내부 구현·HTTP 미연결)</small></td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td rowspan="9">작품 관리</td><td rowspan="9">09 작품 CRUD</td><td>작품 생성</td><td>❌</td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/106">PR #106</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/102">PR #102</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/99">PR #99</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>작품 유형 선택·저장</td><td>❌ <small>(Content 통합·최신 Required CI 확인 대기)</small></td></tr>
<tr><td>승인 장르 1~2개 선택·저장</td><td>❌ <small>(Content 통합·최신 Required CI 확인 대기)</small></td></tr>
<tr><td>해시태그 0~10개 검증·저장</td><td>❌ <small>(Content 통합·최신 Required CI 확인 대기)</small></td></tr>
<tr><td>작품 등록 권리 확인·기록</td><td>❌ <small>(Content 통합·최신 Required CI 확인 대기)</small></td></tr>
<tr><td>작품 상세 조회 <small>(유형·장르·해시태그 Content 통합·CI 대기)</small></td><td>❌</td></tr>
<tr><td>내 작품 목록 조회</td><td>❌</td></tr>
<tr><td>작품 기본 정보 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/99">PR #99</a></td></tr>
<tr><td>작품 삭제 요청 <small>(설정 존재 시 삭제 전 409·데이터 보존 로컬 보완, 이관 매핑 기대값에 DELETE·204 반영, 미병합·CI 대기)</small></td><td>❌</td></tr>
<tr><td rowspan="32">회차·원고 관리</td><td rowspan="9">10 회차·원고 CRUD</td><td>회차 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10">#10</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-006">미등록-006</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>회차 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 제목 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 본문 수정</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 초안 자동저장</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>회차 순서 변경 가능 범위 확인</td><td>❌</td></tr>
<tr><td>초안 삭제 요청</td><td>❌</td></tr>
<tr><td>회차 삭제 요청</td><td>❌</td></tr>
<tr><td rowspan="9">11 플롯·장면 계획 CRUD</td><td>플롯 생성</td><td>❌</td><td rowspan="9"><a href="#미등록-007">미등록-007</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61">#61</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>플롯 상세 조회</td><td>❌</td></tr>
<tr><td>플롯 목록 조회</td><td>❌</td></tr>
<tr><td>플롯 수정</td><td>❌</td></tr>
<tr><td>플롯 삭제 요청</td><td>❌</td></tr>
<tr><td>장면 계획 생성</td><td>❌</td></tr>
<tr><td>장면 계획 조회</td><td>❌</td></tr>
<tr><td>장면 계획 수정</td><td>❌</td></tr>
<tr><td>장면 계획 삭제 요청</td><td>❌</td></tr>
<tr><td rowspan="9">12 버전·체크포인트 관리</td><td>원고 저장 버전 생성</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="#미등록-008">미등록-008</a></td></tr>
<tr><td>원고 버전 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 버전 상세 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>원고 버전 비교</td><td>❌</td></tr>
<tr><td>원고 이전 버전 복원</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td></tr>
<tr><td>설정 버전 목록 조회</td><td>❌</td></tr>
<tr><td>설정 이전 버전 복원</td><td>❌</td></tr>
<tr><td>세계관 체크포인트 생성</td><td>❌</td></tr>
<tr><td>체크포인트 상세 조회</td><td>❌</td></tr>
<tr><td rowspan="2">62 회차 부가 내용 편집</td><td>회차 작가의 말 작성</td><td>❌</td><td rowspan="2"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/50">#50</a> · <a href="#미등록-087">미등록-087</a></td></tr>
<tr><td>회차 작가의 말 수정</td><td>❌</td></tr>
<tr><td rowspan="3">87 기준 세계관 연결 관리 <small>(Draft 검토 후보)</small></td><td>회차의 기준 세계관 버전 선택</td><td>❌</td><td rowspan="3"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>회차의 기준 세계관 버전 조회</td><td>❌</td></tr>
<tr><td>회차의 기준 세계관 버전 변경</td><td>❌</td></tr>
<tr><td rowspan="9">발행 관리</td><td rowspan="9">13 발행·공개 관리</td><td>저장 버전 발행</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a></td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/34">#34</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/83">PR #83</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-009">미등록-009</a></td></tr>
<tr><td>발행본 교체</td><td>❌</td></tr>
<tr><td>회차 공개 중단</td><td>❌</td></tr>
<tr><td>회차 재공개</td><td>❌</td></tr>
<tr><td>발행 이력 조회</td><td>❌</td></tr>
<tr><td>예약 발행 등록</td><td>❌</td></tr>
<tr><td>예약 발행 조회</td><td>❌</td></tr>
<tr><td>예약 발행 변경</td><td>❌</td></tr>
<tr><td>예약 발행 취소</td><td>❌</td></tr>
<tr><td rowspan="20">Fork 관리</td><td rowspan="9">14 Fork CRUD</td><td>Fork 생성</td><td>❌</td><td rowspan="9"><a href="#미등록-010">미등록-010</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a></td></tr>
<tr><td>Fork 상세 조회</td><td>❌</td></tr>
<tr><td>내 Fork 목록 조회</td><td>❌</td></tr>
<tr><td>Fork 원작 정보 조회</td><td>❌</td></tr>
<tr><td>Fork 기준 회차 조회</td><td>❌</td></tr>
<tr><td>Fork 기본 정보 수정</td><td>❌</td></tr>
<tr><td>Fork 후속 원고 수정</td><td>❌</td></tr>
<tr><td>Fork 삭제 요청</td><td>❌</td></tr>
<tr><td>Fork 공개 중단</td><td>❌</td></tr>
<tr><td rowspan="7">15 세계관 독립·원본 변경 관리</td><td>허용된 원본 변경 추종</td><td>❌</td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/108">#108</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89">#89</a> · <a href="#미등록-011">미등록-011</a></td></tr>
<tr><td>최초 수정 시 세계관 독립</td><td>❌</td></tr>
<tr><td>원본 변경 목록 조회</td><td>❌</td></tr>
<tr><td>원본 변경 상세 조회</td><td>❌</td></tr>
<tr><td>원본 변경 반영</td><td>❌</td></tr>
<tr><td>원본 변경 거절</td><td>❌</td></tr>
<tr><td>거절한 변경 재검토</td><td>❌</td></tr>
<tr><td rowspan="1">53 공개 Fork 탐색</td><td>선택 원작의 공개 Fork 작품 목록 조회</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-078">미등록-078</a></td></tr>
<tr><td rowspan="2">54 Fork 생성 준비</td><td>원작의 Fork 허용 회차 목록 조회</td><td>❌</td><td rowspan="2"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-079">미등록-079</a></td></tr>
<tr><td>선택 기준 회차에서 가져올 공개 세계관·인물·사건 미리보기</td><td>❌</td></tr>
<tr><td rowspan="1">83 Fork 정합성 운영 점검</td><td>Fork 스냅샷 해시·원작 해시·인물 상태 차이 점검 결과 조회</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-108">미등록-108</a></td></tr>
<tr><td rowspan="18">이미지 관리</td><td rowspan="6">16-A 설정 이미지 CRUD</td><td>설정 이미지 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td><td rowspan="6"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a> · <a href="#미등록-012">미등록-012</a></td></tr>
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
<tr><td>원고 이미지 목록 조회</td><td>❌</td></tr>
<tr><td>원고 이미지 대체 텍스트 수정</td><td>❌</td></tr>
<tr><td>원고 이미지 본문 참조 제거</td><td>❌</td></tr>
<tr><td rowspan="15">파일 관리</td><td rowspan="7">17 파일 CRUD</td><td>참고 파일 업로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td><td rowspan="7"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="#미등록-013">미등록-013</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
<tr><td>파일 상세 정보 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 목록 조회</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 다운로드</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 교체</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td>파일 메타데이터 수정</td><td>❌</td></tr>
<tr><td>파일 삭제</td><td>✅ <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a></td></tr>
<tr><td rowspan="8">18 원고 가져오기·내보내기</td><td>TXT 원고 업로드</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/31">#31</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="#미등록-014">미등록-014</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>EPUB 원고 업로드</td><td>❌</td></tr>
<tr><td>원고 회차 자동 구분</td><td>❌</td></tr>
<tr><td>원고 등록 미리보기</td><td>❌</td></tr>
<tr><td>원고 등록 확정</td><td>❌</td></tr>
<tr><td>원고 등록 실패 항목 조회</td><td>❌</td></tr>
<tr><td>TXT 원고 내보내기</td><td>❌</td></tr>
<tr><td>EPUB 원고 내보내기</td><td>❌</td></tr>
<tr><td rowspan="6">세계관 확장 관리</td><td rowspan="6">19 세계관 복사·조합</td><td>복사 가능한 세계관 조회</td><td>❌</td><td rowspan="6"><a href="#미등록-015">미등록-015</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30">#30</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="#미등록-016">미등록-016</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>세계관 복사</td><td>❌</td></tr>
<tr><td>조합 원본 세계관 선택</td><td>❌</td></tr>
<tr><td>조합할 설정 항목 선택</td><td>❌</td></tr>
<tr><td>조합 세계관 생성</td><td>❌</td></tr>
<tr><td>조합 세계관 출처 조회</td><td>❌</td></tr>
<tr><td rowspan="19">독서 관리</td><td rowspan="7">20 공개 열람</td><td>공개 작품 목록 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>공개 작품 상세 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>공개 회차 목록 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>공개 회차 본문 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>이전 회차 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>다음 회차 조회</td><td>❌</td><td><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>작품 내 공개 회차 제목·본문 검색</td><td>❌</td><td><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-074">미등록-074</a></td></tr>
<tr><td rowspan="3">21-A 작품 좋아요 관리</td><td>작품 좋아요</td><td>❌</td><td rowspan="3"><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>작품 좋아요 취소</td><td>❌</td></tr>
<tr><td>작품 좋아요 수 조회</td><td>❌</td></tr>
<tr><td rowspan="3">21-B 관심 작품 관리</td><td>관심 작품 등록</td><td>❌</td><td rowspan="3"><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>내 관심 작품 목록 조회</td><td>❌</td></tr>
<tr><td>관심 작품 해제</td><td>❌</td></tr>
<tr><td rowspan="6">21-C 독서 기록 관리</td><td>이어 읽기 위치 저장</td><td>❌</td><td><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>이어 읽기 위치 조회 (서재 데모 통합 테스트의 U11 화면 ID 갱신 대기 보완 · hosted CI 재검증 대기)</td><td>❌</td><td><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>이어 읽기 위치 수정</td><td>❌</td><td><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>이어 읽기 기록 삭제</td><td>❌</td><td><a href="#미등록-017">미등록-017</a> · <a href="#미등록-018">미등록-018</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>읽은 회차 기록 저장</td><td>❌</td><td><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-077">미등록-077</a></td></tr>
<tr><td>회차별 읽음 상태 조회</td><td>❌</td><td><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-077">미등록-077</a></td></tr>
<tr><td rowspan="28">피드백 관리</td><td rowspan="8">22 댓글 CRUD</td><td>댓글 작성</td><td>❌</td><td rowspan="8"><a href="#미등록-019">미등록-019</a> · <a href="#미등록-020">미등록-020</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="#미등록-021">미등록-021</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>댓글 상세 조회</td><td>❌</td></tr>
<tr><td>댓글 목록 조회</td><td>❌</td></tr>
<tr><td>댓글 수정</td><td>❌</td></tr>
<tr><td>댓글 삭제</td><td>❌</td></tr>
<tr><td>댓글 스포일러 표시 설정</td><td>❌</td></tr>
<tr><td>댓글 좋아요</td><td>❌</td></tr>
<tr><td>댓글 좋아요 취소</td><td>❌</td></tr>
<tr><td rowspan="11">23 제보 관리</td><td>오류·질문·제안 제보 등록</td><td>❌</td><td rowspan="11"><a href="#미등록-022">미등록-022</a> · <a href="#미등록-023">미등록-023</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
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
<tr><td rowspan="9">24 수정 제안·승인 관리</td><td>수정 제안 등록</td><td>❌</td><td rowspan="9"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/32">#32</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-024">미등록-024</a></td></tr>
<tr><td>수정 제안 상세 조회</td><td>❌</td></tr>
<tr><td>수정 제안 목록 조회</td><td>❌</td></tr>
<tr><td>제안 편집안 저장</td><td>❌</td></tr>
<tr><td>수정 제안 승인</td><td>❌</td></tr>
<tr><td>수정 제안 거절</td><td>❌</td></tr>
<tr><td>수정 제안 보류</td><td>❌</td></tr>
<tr><td>승인된 수정안 원고 반영</td><td>❌</td></tr>
<tr><td>자동 표기 교정 적용 범위 검사</td><td>❌</td></tr>
<tr><td rowspan="6">작품 설정 관리</td><td rowspan="6">30 운영 설정 관리</td><td>작품 운영 설정 조회</td><td>❌</td><td rowspan="6"><a href="#미등록-025">미등록-025</a> · <a href="#미등록-026">미등록-026</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-027">미등록-027</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>집필 방식 변경</td><td>❌</td></tr>
<tr><td>설정 추출 모드 변경</td><td>❌</td></tr>
<tr><td>자동 교정 설정 변경</td><td>❌</td></tr>
<tr><td>자율 연재 설정 변경</td><td>❌</td></tr>
<tr><td>작품 설정 변경 이력 조회</td><td>❌</td></tr>
<tr><td rowspan="6">저장 공간 관리</td><td rowspan="6">36 사용량·정리 관리</td><td>내 저장 사용량 조회</td><td>❌</td><td rowspan="6"><a href="#미등록-041">미등록-041</a> · <a href="#미등록-042">미등록-042</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="#미등록-043">미등록-043</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>저장 항목 목록 조회</td><td>❌</td></tr>
<tr><td>정리 대상 선택</td><td>❌</td></tr>
<tr><td>정리 요청</td><td>❌</td></tr>
<tr><td>정리 결과 조회</td><td>❌</td></tr>
<tr><td>저장 공간 확장 신청</td><td>❌</td></tr>
<tr><td rowspan="6">성인 콘텐츠 관리</td><td rowspan="6">37 등급·접근 관리</td><td>작품 성인 등급 설정</td><td>❌</td><td rowspan="6"><a href="#미등록-044">미등록-044</a> · <a href="#미등록-045">미등록-045</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="#미등록-046">미등록-046</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>세계관 성인 등급 설정</td><td>❌</td></tr>
<tr><td>콘텐츠 등급 변경</td><td>❌</td></tr>
<tr><td>성인 작품 표시 필터 변경</td><td>❌</td></tr>
<tr><td>연령 확인</td><td>❌</td></tr>
<tr><td>성인 콘텐츠 접근 검사</td><td>❌</td></tr>
<tr><td rowspan="11">검색 관리</td><td rowspan="11">44 작품 검색</td><td>작품 제목 검색</td><td>❌</td><td rowspan="11"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/13">PR #13</a> · <a href="#미등록-069">미등록-069</a></td></tr>
<tr><td>작가 닉네임 검색</td><td>❌</td></tr>
<tr><td>해시태그 검색</td><td>❌</td></tr>
<tr><td>장르 검색</td><td>❌</td></tr>
<tr><td>검색 범위 변경</td><td>❌</td></tr>
<tr><td>검색 결과 최신 순 정렬</td><td>❌</td></tr>
<tr><td>검색 결과 인기 순 정렬</td><td>❌</td></tr>
<tr><td>검색 결과 조회 순 정렬</td><td>❌</td></tr>
<tr><td>검색 결과 페이지 조회</td><td>❌</td></tr>
<tr><td>태그별 작품 목록 조회</td><td>❌</td></tr>
<tr><td>빠른 이동 검색 후보 조회</td><td>❌</td></tr>
<tr><td rowspan="14">랭킹·트렌드 관리</td><td rowspan="14">45 작품 랭킹·인기 추이</td><td>전체 작품 랭킹 조회</td><td>❌</td><td rowspan="14"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/12">PR #12</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/13">PR #13</a> · <a href="#미등록-070">미등록-070</a></td></tr>
<tr><td>원작 작품 랭킹 조회</td><td>❌</td></tr>
<tr><td>Fork 작품 랭킹 조회</td><td>❌</td></tr>
<tr><td>최신 작품 순위 조회</td><td>❌</td></tr>
<tr><td>인기 작품 순위 조회</td><td>❌</td></tr>
<tr><td>조회수 순위 조회</td><td>❌</td></tr>
<tr><td>실시간 인기 TOP10 조회</td><td>❌</td></tr>
<tr><td>24시간 인기 급상승 조회</td><td>❌</td></tr>
<tr><td>방금 업데이트 작품 조회</td><td>❌</td></tr>
<tr><td>최신 Fork 작품 조회</td><td>❌</td></tr>
<tr><td>이번 주 인기 무료 소설 조회</td><td>❌</td></tr>
<tr><td>랭킹 집계 기준 확정</td><td>❌</td></tr>
<tr><td>기간별 랭킹 집계</td><td>❌</td></tr>
<tr><td>랭킹 갱신 시각 조회</td><td>❌</td></tr>
<tr><td rowspan="6">홈 큐레이션 관리</td><td rowspan="4">46 홈 추천·편성</td><td>에디터 Pick 작품 조회</td><td>❌</td><td rowspan="4"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/12">PR #12</a> · <a href="#미등록-071">미등록-071</a></td></tr>
<tr><td>오늘의 발견 작품 조회</td><td>❌</td></tr>
<tr><td>홈 장르별 작품 조회</td><td>❌</td></tr>
<tr><td>에디터 Pick 선정 관리 방식 결정</td><td>❌</td></tr>
<tr><td rowspan="2">55 홈 탐색 필터</td><td>홈 무료 작품만 보기</td><td>❌</td><td rowspan="2"><a href="#미등록-080">미등록-080</a></td></tr>
<tr><td>홈 Fork가 있는 원작만 보기</td><td>❌</td></tr>
<tr><td rowspan="3">검색 트렌드 검토</td><td rowspan="3">47 인기 검색어(추가 검토)</td><td>인기 검색어 제공 여부 결정</td><td>❌</td><td rowspan="3"><a href="#미등록-072">미등록-072</a></td></tr>
<tr><td>인기 검색어 집계 기준 결정</td><td>❌</td></tr>
<tr><td>인기 검색어 순위 조회(도입 승인 후)</td><td>❌</td></tr>
<tr><td rowspan="17">캐릭터챗 관리</td><td rowspan="9">76 캐릭터챗 탐색·대화방</td><td>대화 가능한 공개 작품·캐릭터 챗 목록 조회</td><td>❌</td><td rowspan="9"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/47">#47</a> · <a href="#미등록-101">미등록-101</a></td></tr>
<tr><td>캐릭터챗 원작·Fork 유형 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 작품 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 인물 필터</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 최신순 정렬</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 인기순 정렬</td><td>❌</td></tr>
<tr><td>캐릭터챗 연결 작품 조회순 정렬</td><td>❌</td></tr>
<tr><td>작품·인물을 선택해 대화방 조회·재개</td><td>❌</td></tr>
<tr><td>작품·인물별 기존 대화 기록 조회</td><td>❌</td></tr>
<tr><td rowspan="8">78 캐릭터챗 운영</td><td>운영 캐릭터챗 연결 목록·상태 조회</td><td>❌</td><td rowspan="8"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/47">#47</a> · <a href="#미등록-103">미등록-103</a></td></tr>
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
<tr><td rowspan="73">콘텐츠 서비스 + AI 서비스</td><td rowspan="8">AI 설정 추출</td><td rowspan="8">25 추출·후보 관리</td><td>설정 추출 요청</td><td>❌</td><td rowspan="8"><a href="#미등록-047">미등록-047</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>추출 결과 조회</td><td>❌</td></tr>
<tr><td>추출 후보 목록 조회</td><td>❌</td></tr>
<tr><td>추출 후보 상세 조회</td><td>❌</td></tr>
<tr><td>추출 후보 수정</td><td>❌</td></tr>
<tr><td>추출 후보 채택</td><td>❌</td></tr>
<tr><td>추출 후보 제외</td><td>❌</td></tr>
<tr><td>추출 근거 조회</td><td>❌</td></tr>
<tr><td rowspan="14">AI 시뮬레이션</td><td rowspan="14">26 실행·결과 관리</td><td>시뮬레이션 조건 등록</td><td>❌</td><td rowspan="14"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58">#58</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="#미등록-048">미등록-048</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
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
<tr><td rowspan="13">AI 집필 지원</td><td rowspan="13">27 대화·제안 관리</td><td>허용 문맥 미리보기</td><td>❌</td><td rowspan="13"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57">#57</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56">#56</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62">#62</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55">#55</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="#미등록-049">미등록-049</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a></td></tr>
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
<tr><td rowspan="7">AI 피드백 지원</td><td rowspan="7">29 응대·유해 필터</td><td>질문 답변 생성</td><td>❌</td><td rowspan="7"><a href="#미등록-050">미등록-050</a> · <a href="#미등록-051">미등록-051</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60">#60</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-052">미등록-052</a></td></tr>
<tr><td>단순 오류 수정안 생성</td><td>❌</td></tr>
<tr><td>스토리 오류 검증 근거 생성</td><td>❌</td></tr>
<tr><td>피드백 유해 콘텐츠 검사</td><td>❌</td></tr>
<tr><td>유해 콘텐츠 재검사</td><td>❌</td></tr>
<tr><td>필터 결과 조회</td><td>❌</td></tr>
<tr><td>AI 응대 실패 상태 조회</td><td>❌</td></tr>
<tr><td rowspan="8">AI 이미지 지원</td><td rowspan="8">38 일러스트 후보 관리</td><td>일러스트 생성 장면 지정</td><td>❌</td><td rowspan="8"><a href="#미등록-053">미등록-053</a> · <a href="#미등록-054">미등록-054</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87">#87</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-055">미등록-055</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90">PR #90</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a></td></tr>
<tr><td>일러스트 생성 요청</td><td>❌</td></tr>
<tr><td>일러스트 후보 목록 조회</td><td>❌</td></tr>
<tr><td>일러스트 후보 상세 조회</td><td>❌</td></tr>
<tr><td>일러스트 후보 채택</td><td>❌</td></tr>
<tr><td>일러스트 후보 거절</td><td>❌</td></tr>
<tr><td>일러스트 후보 삭제</td><td>❌</td></tr>
<tr><td>채택 이미지 원고 삽입</td><td>❌</td></tr>
<tr><td rowspan="10">자율 연재 관리</td><td rowspan="10">39 일정·생성·발행 관리</td><td>자율 연재 일정 등록</td><td>❌</td><td rowspan="10"><a href="#미등록-056">미등록-056</a> · <a href="#미등록-057">미등록-057</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-058">미등록-058</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a></td></tr>
<tr><td>자율 연재 일정 조회</td><td>❌</td></tr>
<tr><td>자율 연재 일정 수정</td><td>❌</td></tr>
<tr><td>자율 연재 켜기</td><td>❌</td></tr>
<tr><td>자율 연재 일시정지</td><td>❌</td></tr>
<tr><td>진행 중 생성 중지 요청</td><td>❌</td></tr>
<tr><td>다음 회차 자동 생성</td><td>❌</td></tr>
<tr><td>생성 회차 발행 조건 검사</td><td>❌</td></tr>
<tr><td>생성 회차 자동 발행</td><td>❌</td></tr>
<tr><td>자율 연재 실행 기록 조회</td><td>❌</td></tr>
<tr><td rowspan="5">캐릭터챗 관리</td><td rowspan="5">77 캐릭터 응답·문맥 보호</td><td>추천 질문 선택 후 캐릭터 답변 요청</td><td>❌</td><td rowspan="5"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/47">#47</a> · <a href="#미등록-102">미등록-102</a></td></tr>
<tr><td>자유 질문 입력 후 캐릭터 답변 요청</td><td>❌</td></tr>
<tr><td>읽은 회차 기준으로 인물·답변 범위 제한</td><td>❌</td></tr>
<tr><td>응답 근거 회차·근거 없음 표시</td><td>❌</td></tr>
<tr><td>미열람 회차 질문의 답변 보류·스포일러 차단</td><td>❌</td></tr>
</tbody>
</table>

## 운영 관리 서비스 — 운영 업무·LLMOps

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="90">운영 관리 서비스</td><td>실행 기반</td><td>89 독립 앱 실행</td><td>운영 서비스 독립 Spring Boot 실행 골격</td><td>❌</td><td><a href="#미등록-112">미등록-112</a></td></tr>
<tr><td rowspan="1">권한 관리</td><td rowspan="1">03 접근·공개 범위 관리</td><td>운영 권한 확인</td><td>❌</td><td rowspan="1"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td rowspan="13">신고·운영 관리</td><td rowspan="13">34 신고·소명·조치 관리</td><td>권리 침해 신고 접수</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>유해 콘텐츠 신고 접수</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>내 신고 목록 조회</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 신고 목록 조회</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>신고 상세 조회</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>신고 증거 보완</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>작품 소유자 소명 제출</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>소명 조회</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 검토 결과 기록</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>대상 콘텐츠 제한</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>대상 콘텐츠 제한 해제</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>운영 조치 이력 조회</td><td>❌</td><td><a href="#미등록-035">미등록-035</a> · <a href="#미등록-036">미등록-036</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="#미등록-037">미등록-037</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a></td></tr>
<tr><td>작품 등록자에게 권리 증빙 요청</td><td>❌</td><td><a href="#미등록-107">미등록-107</a></td></tr>
<tr><td rowspan="8">정기 작업 관리</td><td rowspan="8">35 일정·실행 관리</td><td>정기 작업 일정 등록</td><td>❌</td><td rowspan="8"><a href="#미등록-038">미등록-038</a> · <a href="#미등록-039">미등록-039</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50">#50</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="#미등록-040">미등록-040</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a></td></tr>
<tr><td>정기 작업 일정 조회</td><td>❌</td></tr>
<tr><td>정기 작업 일정 변경</td><td>❌</td></tr>
<tr><td>정기 작업 일정 취소</td><td>❌</td></tr>
<tr><td>예정 작업 실행</td><td>❌</td></tr>
<tr><td>작업 실행 기록 조회</td><td>❌</td></tr>
<tr><td>실패 작업 조회</td><td>❌</td></tr>
<tr><td>실패 작업 수동 재실행</td><td>❌</td></tr>
<tr><td rowspan="6">고객지원 관리</td><td rowspan="6">67 문의 접수·답변</td><td>이용·계정·권리 등 문의 유형을 선택해 문의 등록</td><td>❌</td><td rowspan="6"><a href="#미등록-092">미등록-092</a></td></tr>
<tr><td>내 고객지원 문의 목록 조회</td><td>❌</td></tr>
<tr><td>내 고객지원 문의 본문·처리 상태 조회</td><td>❌</td></tr>
<tr><td>내 고객지원 문의의 운영팀 답변 조회</td><td>❌</td></tr>
<tr><td>운영 고객지원 문의 목록·상태 조회</td><td>❌</td></tr>
<tr><td>운영팀 문의 답변 등록</td><td>❌</td></tr>
<tr><td rowspan="3">공지 관리</td><td rowspan="3">68 공지 게시·조회</td><td>공지 목록 조회</td><td>❌</td><td rowspan="3"><a href="#미등록-093">미등록-093</a></td></tr>
<tr><td>공지 상세 조회</td><td>❌</td></tr>
<tr><td>운영 공지 게시</td><td>❌</td></tr>
<tr><td rowspan="5">이벤트 관리</td><td rowspan="5">69 이벤트 안내·운영</td><td>이벤트 목록 조회</td><td>❌</td><td rowspan="5"><a href="#미등록-094">미등록-094</a></td></tr>
<tr><td>이벤트 상세·기간·진행 상태 조회</td><td>❌</td></tr>
<tr><td>운영 이벤트 등록</td><td>❌</td></tr>
<tr><td>운영 이벤트 목록 조회</td><td>❌</td></tr>
<tr><td>이벤트 진행·종료 상태 변경</td><td>❌</td></tr>
<tr><td rowspan="4">관리자 계정·권한 관리</td><td rowspan="4">71 관리자 계정 등록·권한</td><td>관리자 계정 목록 조회</td><td>❌</td><td rowspan="4"><a href="#미등록-096">미등록-096</a></td></tr>
<tr><td>관리자 계정 생성</td><td>❌</td></tr>
<tr><td>관리자 계정 생성 시 업무별 권한 부여</td><td>❌</td></tr>
<tr><td>관리자별 부여 권한 조회</td><td>❌</td></tr>
<tr><td rowspan="2">운영 감사 관리</td><td rowspan="2">72 관리자 활동 기록</td><td>관리자 조치의 수행자·시각·대상·내역 기록</td><td>❌</td><td rowspan="2"><a href="#미등록-097">미등록-097</a></td></tr>
<tr><td>관리자 전체 활동 로그 최신순 조회</td><td>❌</td></tr>
<tr><td rowspan="7">회원 운영 관리</td><td rowspan="7">73 운영 회원 조회·조치</td><td>운영 회원 목록·역할·상태 조회</td><td>❌</td><td rowspan="7"><a href="#미등록-098">미등록-098</a></td></tr>
<tr><td>역할별 회원 목록 필터</td><td>❌</td></tr>
<tr><td>회원 이름·이메일 검색</td><td>❌</td></tr>
<tr><td>회원 가입 최신순 정렬</td><td>❌</td></tr>
<tr><td>회원 가입 오래된순 정렬</td><td>❌</td></tr>
<tr><td>회원 이용 제한</td><td>❌</td></tr>
<tr><td>회원 이용 제한 해제</td><td>❌</td></tr>
<tr><td rowspan="9">콘텐츠 운영 관리</td><td rowspan="5">74 운영 작품 조회</td><td>운영 작품 목록·작성자·권리·공개 상태 조회</td><td>❌</td><td rowspan="5"><a href="#미등록-099">미등록-099</a></td></tr>
<tr><td>운영 작품 원작·Fork 필터</td><td>❌</td></tr>
<tr><td>운영 작품명·작성자·권리 유형 검색</td><td>❌</td></tr>
<tr><td>운영 작품 제목순 정렬</td><td>❌</td></tr>
<tr><td>운영 작품 제목 역순 정렬</td><td>❌</td></tr>
<tr><td rowspan="4">75 운영 댓글 조회·조치</td><td>작품별 운영 댓글 필터</td><td>❌</td><td rowspan="4"><a href="#미등록-100">미등록-100</a></td></tr>
<tr><td>운영 댓글 내용·작품명·작성자 검색</td><td>❌</td></tr>
<tr><td>운영 댓글 공감 많은순 정렬</td><td>❌</td></tr>
<tr><td>운영 댓글 공감 적은순 정렬</td><td>❌</td></tr>
<tr><td rowspan="2">운영 현황 관리</td><td rowspan="2">85 업무·데이터 현황 조회</td><td>답변 대기 문의·접수 신고·작가 검토 대기 수 조회</td><td>❌</td><td rowspan="2"><a href="#미등록-110">미등록-110</a></td></tr>
<tr><td>수집 자료 출처·수량·형식·사용처 명세 조회</td><td>❌</td></tr>
<tr><td rowspan="29">LLMOps</td><td rowspan="7">40-A AI 호출 추적</td><td>AI 작업별 추적 기록 저장</td><td>❌</td><td rowspan="7"><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>AI 호출 기록 목록 조회</td><td>❌</td></tr>
<tr><td>AI 호출 기록 상세 조회</td><td>❌</td></tr>
<tr><td>요청 ID 기반 실행 단계 조회</td><td>❌</td></tr>
<tr><td>토큰 사용량 조회</td><td>❌</td></tr>
<tr><td>응답 지연 조회</td><td>❌</td></tr>
<tr><td>실행 성공·실패 상태 조회</td><td>❌</td></tr>
<tr><td rowspan="6">40-B 프롬프트·모델 버전 관리</td><td>모델 버전 등록</td><td>❌</td><td rowspan="6"><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>모델 버전 조회</td><td>❌</td></tr>
<tr><td>프롬프트 버전 등록</td><td>❌</td></tr>
<tr><td>프롬프트 버전 조회</td><td>❌</td></tr>
<tr><td>프롬프트 이전 버전 복원</td><td>❌</td></tr>
<tr><td>생성 결과의 사용 모델·프롬프트 버전 조회</td><td>❌</td></tr>
<tr><td rowspan="5">40-C 회귀 평가</td><td>고정 평가 세트 관리 범위 확정</td><td>❌</td><td rowspan="5"><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>회귀 평가 실행</td><td>❌</td></tr>
<tr><td>회귀 평가 결과 조회</td><td>❌</td></tr>
<tr><td>기존 버전과 평가 결과 비교</td><td>❌</td></tr>
<tr><td>배포 전 평가 통과 여부 확인</td><td>❌</td></tr>
<tr><td rowspan="8">40-D 품질·비용 지표</td><td>AI 오류 지표 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>AI 시간 초과율 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>AI 비용 지표 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>제안 채택률 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>수정안 승인률 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>필터 복원률 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>운영 경고 조회</td><td>❌</td><td><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>실패·지연 경고 확인 및 수동 조치 완료 기록</td><td>❌</td><td><a href="#미등록-106">미등록-106</a></td></tr>
<tr><td rowspan="3">40-E 정보 누설 표본 검사</td><td>AI 응답 정보 누설 표본 검사</td><td>❌</td><td rowspan="3"><a href="#미등록-059">미등록-059</a> · <a href="#미등록-060">미등록-060</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="#미등록-061">미등록-061</a></td></tr>
<tr><td>정보 누설 의심 결과 조회</td><td>❌</td></tr>
<tr><td>정보 누설 의심 경고 기록</td><td>❌</td></tr>
</tbody>
</table>

## Frontend · 앱 · 운영 기반

<table>
<thead><tr><th>서비스</th><th>서브시스템</th><th>중간 기능</th><th>세부 기능</th><th>개발 완료</th><th>관련 이슈</th></tr></thead>
<tbody>
<tr><td rowspan="32">Frontend</td><td rowspan="21">웹 화면</td><td rowspan="13">41 업무 화면 연결</td><td>목록 화면 API 연결</td><td>❌</td><td rowspan="13"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92">#92</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/29">#29</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/23">#23</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/25">#25</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95">PR #95</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="#미등록-062">미등록-062</a></td></tr>
<tr><td>상세 화면 API 연결</td><td>❌</td></tr>
<tr><td>등록 화면 API 연결</td><td>❌</td></tr>
<tr><td>수정 화면 API 연결</td><td>❌</td></tr>
<tr><td>삭제 확인 화면 API 연결</td><td>❌</td></tr>
<tr><td>파일 업로드 화면 연결</td><td>❌</td></tr>
<tr><td>파일 다운로드 처리</td><td>❌</td></tr>
<tr><td>AI 실행 화면 연결</td><td>❌</td></tr>
<tr><td>승인 화면 연결</td><td>❌</td></tr>
<tr><td>저장 충돌 안내</td><td>❌</td></tr>
<tr><td>인증 만료 안내</td><td>❌</td></tr>
<tr><td>키보드 접근성 확인</td><td>❌</td></tr>
<tr><td>모바일 화면 대응</td><td>❌</td></tr>
<tr><td rowspan="1">56 공통 사용자 환경</td><td>앱 라이트·다크 모드 전환</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-081">미등록-081</a></td></tr>
<tr><td rowspan="1">60 설정 문서 탐색</td><td>설정 본문·속성의 다른 문서 이름을 내부 링크로 탐색</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-085">미등록-085</a></td></tr>
<tr><td rowspan="1">63 원고 편집 보조</td><td>원고 글자 수 확인</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-088">미등록-088</a></td></tr>
<tr><td rowspan="1">64 발행 전 검토</td><td>공개 확정 전 선택 저장 원고 미리보기</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-089">미등록-089</a></td></tr>
<tr><td rowspan="1">65 미저장 작업 보호</td><td>미저장 원고·설정이 있을 때 이탈 또는 대상 전환 확인</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-090">미등록-090</a></td></tr>
<tr><td rowspan="3">66 요청 제어</td><td>진행 중 원고 저장 요청 취소</td><td>❌</td><td rowspan="3"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/92">#92</a> · <a href="/Users/yunseongho/.hermes/cache/scratch/pull/93">PR #93</a> · <a href="#미등록-091">미등록-091</a></td></tr>
<tr><td>진행 중 파일 요청 취소</td><td>❌</td></tr>
<tr><td>취소 후 서버 처리 여부 재확인 안내</td><td>❌</td></tr>
<tr><td rowspan="7">독서 관리</td><td rowspan="1">48 공개 열람</td><td>공개 회차 목록 오래된 순·최신 순 전환</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-073">미등록-073</a></td></tr>
<tr><td rowspan="3">50 공유</td><td>작품 링크 공유</td><td>❌</td><td rowspan="3"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-075">미등록-075</a></td></tr>
<tr><td>회차 링크 공유</td><td>❌</td></tr>
<tr><td>선택 문장 인용 공유</td><td>❌</td></tr>
<tr><td rowspan="3">51 열람 환경 설정</td><td>뷰어 배경 모드 변경</td><td>❌</td><td rowspan="3"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/73">#73</a> · <a href="#미등록-076">미등록-076</a></td></tr>
<tr><td>뷰어 배경 움직임 켜기·끄기</td><td>❌</td></tr>
<tr><td>뷰어 글자 크기 조절</td><td>❌</td></tr>
<tr><td rowspan="1">이벤트 관리</td><td rowspan="1">70 이벤트 안내·운영</td><td>이벤트 안내에서 관련 기능으로 이동</td><td>❌</td><td rowspan="1"><a href="#미등록-095">미등록-095</a></td></tr>
<tr><td rowspan="1">알림 관리</td><td rowspan="1">80 알림 대상 화면 이동</td><td>알림 선택 후 관련 업무 화면으로 이동</td><td>❌</td><td rowspan="1"><a href="/Users/yunseongho/.hermes/cache/scratch/issues/89">#89</a> · <a href="#미등록-105">미등록-105</a></td></tr>
<tr><td rowspan="2">창작 이용 안내</td><td rowspan="2">84 집필 방식·저작권 사전 확인</td><td>Fork 집필 정책과 저작권 안내 개별 확인 후 계속</td><td>❌</td><td rowspan="2"><a href="#미등록-109">미등록-109</a></td></tr>
<tr><td>원고 가져오기 정책과 AI 처리 이용 권한 안내 개별 확인 후 계속</td><td>❌</td></tr>
<tr><td rowspan="4">Android / iOS</td><td rowspan="4">모바일 앱</td><td rowspan="4">42 앱 제공</td><td>Android 지원 범위 결정</td><td>❌</td><td rowspan="4"><a href="#미등록-063">미등록-063</a> · <a href="#미등록-064">미등록-064</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="#미등록-065">미등록-065</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93">PR #93</a></td></tr>
<tr><td>Android 앱 제공</td><td>❌</td></tr>
<tr><td>iOS 지원 범위 결정</td><td>❌</td></tr>
<tr><td>iOS 앱 제공</td><td>❌</td></tr>
<tr><td rowspan="10">운영·인프라</td><td rowspan="10">운영 기반</td><td rowspan="10">43 저장·배포·복구 관리</td><td>Core Health 조회</td><td>❌</td><td rowspan="10"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/63">#63</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/64">#64</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/67">PR #67</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/80">PR #80</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/94">PR #94</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/65">PR #65</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/77">PR #77</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/45">PR #45</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/103">#103</a> · <a href="#미등록-066">미등록-066</a> · <a href="#미등록-114">미등록-114</a></td></tr>
<tr><td>AI Health 조회</td><td>❌</td></tr>
<tr><td>DB 마이그레이션 관리 · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/98">PR #98</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/104">PR #104</a></td><td>❌ (WorldStudio CD stdin·인증 테스트를 Content Service 이관에 맞춰 통합·PR 미병합·실제 개발 DB 미확인·기본 비활성)</td></tr>
<tr><td>파일 저장소 연결 관리</td><td>❌</td></tr>
<tr><td>백업 생성</td><td>❌</td></tr>
<tr><td>복원 수행</td><td>❌</td></tr>
<tr><td>CI 결과 확인</td><td>❌</td></tr>
<tr><td>Core·Content 동시 이미지 빌드의 Gradle 공유 캐시 잠금 <small>(정적 회귀 확인·hosted CI 대기)</small></td><td>❌</td></tr>
<tr><td>배포 상태 확인</td><td>❌</td></tr>
<tr><td>장애 상태 확인</td><td>❌</td></tr>
</tbody>
</table>

## 공통 이슈

| 이슈 | 추적 |
|---|---|
| 구현 상태 문서 정렬 | <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/72">#72</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73">#73</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/75">#75</a> |
| 전체 서비스와 MVP 정책 충돌 정리 | <a href="#미등록-067">미등록-067</a> |
| 회원·작품·Fork·정본·파일의 삭제 정책 구분 | <a href="#미등록-068">미등록-068</a> |
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


## 근거·관리 범위

- 전체 서비스 기능의 출발점: [요구사항 색인](requirements.md), [유스케이스](usecase.md). 원문의 모든 세부 요구사항을 일대일 대조한 완전성 감사는 아니며 서브시스템·중간 기능·개별 동작으로 재분류했다.
- 현행 MVP와 정책: [설계](design/design.md), [결정 기록](design/decisions.md), [Core 설계](design/services/core-api.md). 과거 저장 기술·공개·자동 처리 정책을 이 표만으로 되살리지 않는다.
- 현재 구현 확인: [작품 API](../backend/content-service/src/main/kotlin/ai/storyfork/content/work/controller/WorkController.kt), [작품 Service](../backend/content-service/src/main/kotlin/ai/storyfork/content/work/service/WorkService.kt), [Auth](../backend/core-api/src/main/kotlin/ai/storyfork/core/auth/controller/SessionController.kt), [가입](../backend/core-api/src/main/kotlin/ai/storyfork/core/auth/controller/SignupController.kt), [회원 정보](../backend/core-api/src/main/kotlin/ai/storyfork/core/auth/controller/ProfileController.kt), [첨부](../backend/content-service/src/main/kotlin/ai/storyfork/content/attachment/controller/SettingAttachmentController.kt), [표지](../backend/content-service/src/main/kotlin/ai/storyfork/content/attachment/controller/WorkCoverController.kt), [원고 이미지](../backend/content-service/src/main/kotlin/ai/storyfork/content/attachment/controller/EpisodeImageController.kt), [AI 생성](../backend/ai-service/app/generation/router.py), [통합 안내](content-integration.md).
- 기존 기능표 작성 시 GitHub 이슈 55개(열림·종료 포함)의 제목·본문·상태를 조회해 연결했다. 이번 Core→Content 추출에서는 소스 상태와 기존 미등록-111/113의 세부 동작만 갱신했으며 GitHub 이슈 생성·수정이나 새 CI 조회는 하지 않았다.


## 미등록 항목 번호

아래 번호는 GitHub 이슈 번호가 아니다. 기존 이슈가 없거나 직접 구현·정책 범위를 소유하는 이슈를 확인하지 못한 항목이다. 기존 광범위 이슈의 단순 언급·제외 항목은 전용 구현 이슈가 있다고 간주하지 않았다. 별도 이슈 등록 후 해당 링크로 교체한다.

| 관리 번호 | 중간 기능 | 구분 | 남길 내용 |
|---|---|---|---|
| <a id="미등록-001"></a>미등록-001 | 01 | 핵심 이슈 | 탈퇴 후 작품·세계관·Fork 참조·댓글·크레딧 처리 |
| <a id="미등록-002"></a>미등록-002 | 01 | 선행 기능·이슈 | 회원 식별자·탈퇴 시 데이터 보관 계약 |
| <a id="미등록-003"></a>미등록-003 | 04 | 선행 기능·이슈 | 03 권한, 세계관·작품 소유·연결 계약 |
| <a id="미등록-004"></a>미등록-004 | 07 | 선행 기능·이슈 | 06, 시점·인지 정보 표현 계약 |
| <a id="미등록-005"></a>미등록-005 | 08 | 선행 기능·이슈 | 05~07, 그래프·버전 정합성 계약 |
| <a id="미등록-006"></a>미등록-006 | 10 | 선행 기능·이슈 | 09, 저장 충돌·삭제 계약 |
| <a id="미등록-007"></a>미등록-007 | 11 | 핵심 이슈 | 계획과 확정 사건·인물 상태를 구분 |
| <a id="미등록-008"></a>미등록-008 | 12 | 선행 기능·이슈 | 05~08·10, 시점 고정 계약 |
| <a id="미등록-009"></a>미등록-009 | 13 | 선행 기능·이슈 | 03·10·12; 예약은 35 |
| <a id="미등록-010"></a>미등록-010 | 14 | 핵심 이슈 | 원작 기준 회차·버전 유지, 재분기·중복 제한, 삭제 시 참조 보호 |
| <a id="미등록-011"></a>미등록-011 | 15 | 선행 기능·이슈 | 14·07·08·12; 별도 알림함은 31 |
| <a id="미등록-012"></a>미등록-012 | 16 | 선행 기능·이슈 | 03, 05·09·10의 대상 식별자, 파일 수명 계약 |
| <a id="미등록-013"></a>미등록-013 | 17 | 선행 기능·이슈 | 03·05, 허용 형식·저장소 계약 |
| <a id="미등록-014"></a>미등록-014 | 18 | 보안 이슈 | DRM·이용 권리, 압축 폭탄·외부 리소스 로딩·경로 조작 차단, Fork 원작 원고 내보내기 제한 |
| <a id="미등록-015"></a>미등록-015 | 19 | 핵심 이슈 | 기본 세계관 복사와 작품 Fork를 구분, 복사 대상·관계 범위 확정 |
| <a id="미등록-016"></a>미등록-016 | 19 | 선행 기능·이슈 | 03~08·12, 이용·복사 정책 |
| <a id="미등록-017"></a>미등록-017 | 21 | 핵심 이슈 | 중복 집계·조회수 기준·기록 보관, UI 목업과 실제 저장 구분 |
| <a id="미등록-018"></a>미등록-018 | 21 | 보안 이슈 | 타인의 관심 목록·독서 위치 비공개, 집계 남용 방지 |
| <a id="미등록-019"></a>미등록-019 | 22 | 핵심 이슈 | 대상 회차·발행 버전 고정, 숨김과 삭제 구분 |
| <a id="미등록-020"></a>미등록-020 | 22 | 보안 이슈 | 작성자 확인, XSS·스팸·스포일러·유해 입력, 필터 실패 처리 |
| <a id="미등록-021"></a>미등록-021 | 22 | 선행 기능·이슈 | 02·13·20, 29 필터 |
| <a id="미등록-022"></a>미등록-022 | 23 | 핵심 이슈 | 댓글과 제보 구분, 전달 후 정정·철회와 원본 보존 |
| <a id="미등록-023"></a>미등록-023 | 23 | 보안 이슈 | 비공개 제보는 제보자·작가만, 읽은 회차 이후 근거 노출 금지 |
| <a id="미등록-024"></a>미등록-024 | 24 | 선행 기능·이슈 | 10·12·13·23·27 |
| <a id="미등록-025"></a>미등록-025 | 30 | 핵심 이슈 | 수동·작가 검토·끔 기본값, 자동 처리와 비용 동의 |
| <a id="미등록-026"></a>미등록-026 | 30 | 보안 이슈 | 소유자만 변경, 설정으로 권리·비용 검사 우회 금지 |
| <a id="미등록-027"></a>미등록-027 | 30 | 선행 기능·이슈 | 03·09, 해당 자동 기능·32 |
| <a id="미등록-028"></a>미등록-028 | 31 | 선행 기능·이슈 | 02, 알림 발생 기능·수신자 계약 |
| <a id="미등록-029"></a>미등록-029 | 32 | 핵심 이슈 | 사용량과 금전성 정산 분리, 동시 요청·중복 차감·오류·취소 정책 |
| <a id="미등록-030"></a>미등록-030 | 32 | 보안 이슈 | Core만 잔액 확정, 부정 지급·중복 차감·사용량 위조 방지 |
| <a id="미등록-031"></a>미등록-031 | 32 | 선행 기능·이슈 | 01·02·27, 과금 정책 충돌 정리 |
| <a id="미등록-032"></a>미등록-032 | 33 | 핵심 이슈 | 가격·환불·만료·구독 정책 미정, 외부 결제 서비스 사전 결정 |
| <a id="미등록-033"></a>미등록-033 | 33 | 보안 이슈 | 결제정보 직접 저장 최소화, 웹훅 인증·중복·재전송 검증 |
| <a id="미등록-034"></a>미등록-034 | 33 | 선행 기능·이슈 | 32, 결제·법적 정책 확정 |
| <a id="미등록-035"></a>미등록-035 | 34 | 핵심 이슈 | 신고만으로 침해 확정 금지, 원작·Fork 파급·중첩 제한·보관 정책 |
| <a id="미등록-036"></a>미등록-036 | 34 | 보안 이슈 | 신고자·증거 개인정보 보호, 최소 운영 권한, 무제한 비공개 원고 열람 금지 |
| <a id="미등록-037"></a>미등록-037 | 34 | 선행 기능·이슈 | 03·09·14·23, 운영·권리 정책 |
| <a id="미등록-038"></a>미등록-038 | 35 | 핵심 이슈 | 중복 실행·서버 중단 후 지연·재실행 계약, 큐·worker 선제 도입 금지 |
| <a id="미등록-039"></a>미등록-039 | 35 | 보안 이슈 | 운영자 실행 권한, 재실행 시 중복 차감·중복 발행 방지 |
| <a id="미등록-040"></a>미등록-040 | 35 | 선행 기능·이슈 | 실행할 업무의 정책·저장 계약, 13·32·01과 기능별 연결 |
| <a id="미등록-041"></a>미등록-041 | 36 | 핵심 이슈 | 저장 한도·과금·삭제 복원·참조 중 파일 보호 |
| <a id="미등록-042"></a>미등록-042 | 36 | 보안 이슈 | 한도 초과로 기존 작품 자동 삭제 금지, 타인 파일 정리 금지 |
| <a id="미등록-043"></a>미등록-043 | 36 | 선행 기능·이슈 | 16·17·32, 보관·한도 정책 |
| <a id="미등록-044"></a>미등록-044 | 37 | 핵심 이슈 | 성인 콘텐츠와 금지 유해 콘텐츠 구분, 법적 기준·AI 지원 미정 |
| <a id="미등록-045"></a>미등록-045 | 37 | 보안 이슈 | 연령 확인 정보 최소 보관, 서버에서 접근 제한 |
| <a id="미등록-046"></a>미등록-046 | 37 | 선행 기능·이슈 | 03·20·29·34, 법적·등급 정책 |
| <a id="미등록-047"></a>미등록-047 | 25 | 핵심 이슈 | 기존 설정 충돌·중복·근거·부분 실패, 채택과 실제 저장 분리 |
| <a id="미등록-048"></a>미등록-048 | 26 | 선행 기능·이슈 | 07·08·12·27, 독자 검증은 23·32 |
| <a id="미등록-049"></a>미등록-049 | 27 | 선행 기능·이슈 | 03·07·10·12, Core 허용 문맥 계약 |
| <a id="미등록-050"></a>미등록-050 | 29 | 핵심 이슈 | 유형은 독자 선택, 필터 실패·응대 실패·운영 판단을 구분 |
| <a id="미등록-051"></a>미등록-051 | 29 | 보안 이슈 | 공개 근거만 사용, 필터 실패 시 공개 처리 정책 확인, 자동 수정 범위 제한 |
| <a id="미등록-052"></a>미등록-052 | 29 | 선행 기능·이슈 | 22·23·24·27, 필터 입력·실패 계약 |
| <a id="미등록-053"></a>미등록-053 | 38 | 핵심 이슈 | 생성·선택·삽입 분리, 기록 삭제와 원고 버전 이미지 보존 구분 |
| <a id="미등록-054"></a>미등록-054 | 38 | 보안 이슈 | 최소 장면·외형만 전송, 안전 정책·권리·생성 표시 검토 |
| <a id="미등록-055"></a>미등록-055 | 38 | 선행 기능·이슈 | 16·27·32, 모델·권리 정책 |
| <a id="미등록-056"></a>미등록-056 | 39 | 핵심 이슈 | 중지와 실행 중 취소 구분, 지연·실패·비용 한도·중복 실행 |
| <a id="미등록-057"></a>미등록-057 | 39 | 보안 이슈 | 발행 시점 권리 재확인, 제한 우회·중복 발행·무동의 과금 방지 |
| <a id="미등록-058"></a>미등록-058 | 39 | 선행 기능·이슈 | 13·27·30·32·35 |
| <a id="미등록-059"></a>미등록-059 | 40 | 핵심 이슈 | 도구 선정·보관·평가 기준, 사용자 기록과 기술 로그 분리 |
| <a id="미등록-060"></a>미등록-060 | 40 | 보안 이슈 | 원고 전문·개인정보·키를 추적 시스템에 전송하지 않기 |
| <a id="미등록-061"></a>미등록-061 | 40 | 선행 기능·이슈 | 27·32, 추적 도입·보관·평가 정책 |
| <a id="미등록-062"></a>미등록-062 | 41 | 선행 기능·이슈 | 해당 Core API 계약; API와 화면 작업은 계약 후 병렬 가능 |
| <a id="미등록-063"></a>미등록-063 | 42 | 핵심 이슈 | 웹 반응형과 네이티브 앱 구분, 기능 동등성 임의 약속 금지 |
| <a id="미등록-064"></a>미등록-064 | 42 | 보안 이슈 | 안전한 토큰 보관, 딥링크·파일·사용자 정보 보호 |
| <a id="미등록-065"></a>미등록-065 | 42 | 선행 기능·이슈 | 02·41, 앱 제공 범위 결정 |
| <a id="미등록-066"></a>미등록-066 | 43 | 선행 기능·이슈 | 업무별 저장 계약·배포 범위; 새 인프라를 일괄 선제 도입하지 않음 |
| <a id="미등록-067"></a>미등록-067 | 공통 | 공통 이슈 | 전체 서비스와 MVP 정책 충돌 정리 |
| <a id="미등록-068"></a>미등록-068 | 공통 | 공통 이슈 | 회원·작품·Fork·정본·파일의 삭제 정책 구분 |
| <a id="미등록-069"></a>미등록-069 | 44 | 관련 이슈 | 서버 검색·필터·정렬·페이지네이션·빠른 이동 권한 계약 |
| <a id="미등록-070"></a>미등록-070 | 45 | 관련 이슈 | 랭킹 집계 기간·산식·중복 방지·갱신 기준 |
| <a id="미등록-071"></a>미등록-071 | 46 | 관련 이슈 | 홈 편성·선정 권한·공개 대상 검증 |
| <a id="미등록-072"></a>미등록-072 | 47 | 관련 이슈 | 인기 검색어 도입 여부·개인정보·집계 조작 방지 |
| <a id="미등록-073"></a>미등록-073 | 48 | 화면 누락 기능 | 독서 관리 / 공개 열람의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-074"></a>미등록-074 | 20 | 화면 누락 기능 | 독서 관리 / 공개 열람의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-075"></a>미등록-075 | 50 | 화면 누락 기능 | 독서 관리 / 공유의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-076"></a>미등록-076 | 51 | 화면 누락 기능 | 독서 관리 / 열람 환경 설정의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-077"></a>미등록-077 | 21-C | 화면 누락 기능 | 독서 관리 / 독서 기록 관리의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-078"></a>미등록-078 | 53 | 화면 누락 기능 | Fork 관리 / 공개 Fork 탐색의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-079"></a>미등록-079 | 54 | 화면 누락 기능 | Fork 관리 / Fork 생성 준비의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-080"></a>미등록-080 | 55 | 화면 누락 기능 | 홈 큐레이션 관리 / 홈 탐색 필터의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-081"></a>미등록-081 | 56 | 화면 누락 기능 | 웹 화면 / 공통 사용자 환경의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-082"></a>미등록-082 | 57 | 화면 누락 기능 | 세계관 관리 / 세계관·작품 연결의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-083"></a>미등록-083 | 05 | 화면 누락 기능 | 세계관 관리 / 설정 항목 편집의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-084"></a>미등록-084 | 59 | 화면 누락 기능 | 세계관 관리 / 설정 문서 속성 편집의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-085"></a>미등록-085 | 60 | 화면 누락 기능 | 웹 화면 / 설정 문서 탐색의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-086"></a>미등록-086 | 61 | 화면 누락 기능 | 세계관 관리 / 설정 문서 참조 조회의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-087"></a>미등록-087 | 62 | 화면 누락 기능 | 회차·원고 관리 / 회차 부가 내용 편집의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-088"></a>미등록-088 | 63 | 화면 누락 기능 | 웹 화면 / 원고 편집 보조의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-089"></a>미등록-089 | 64 | 화면 누락 기능 | 웹 화면 / 발행 전 검토의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-090"></a>미등록-090 | 65 | 화면 누락 기능 | 웹 화면 / 미저장 작업 보호의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-091"></a>미등록-091 | 66 | 화면 누락 기능 | 웹 화면 / 요청 제어의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-092"></a>미등록-092 | 67 | 화면 누락 기능 | 고객지원 관리 / 문의 접수·답변의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-093"></a>미등록-093 | 68 | 화면 누락 기능 | 공지 관리 / 공지 게시·조회의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-094"></a>미등록-094 | 69 | 화면 누락 기능 | 이벤트 관리 / 이벤트 안내·운영의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-095"></a>미등록-095 | 70 | 화면 누락 기능 | 이벤트 관리 / 이벤트 안내·운영의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-096"></a>미등록-096 | 71 | 화면 누락 기능 | 관리자 계정·권한 관리 / 관리자 계정 등록·권한의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-097"></a>미등록-097 | 72 | 화면 누락 기능 | 운영 감사 관리 / 관리자 활동 기록의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-098"></a>미등록-098 | 73 | 화면 누락 기능 | 회원 운영 관리 / 운영 회원 조회·조치의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-099"></a>미등록-099 | 74 | 화면 누락 기능 | 콘텐츠 운영 관리 / 운영 작품 조회의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-100"></a>미등록-100 | 75 | 화면 누락 기능 | 콘텐츠 운영 관리 / 운영 댓글 조회·조치의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-101"></a>미등록-101 | 76 | 화면 누락 기능 | 캐릭터챗 관리 / 캐릭터챗 탐색·대화방의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-102"></a>미등록-102 | 77 | 화면 누락 기능 | 캐릭터챗 관리 / 캐릭터 응답·문맥 보호의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-103"></a>미등록-103 | 78 | 화면 누락 기능 | 캐릭터챗 관리 / 캐릭터챗 운영의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-104"></a>미등록-104 | 31 | 화면 누락 기능 | 알림 관리 / 31 알림 CRUD·수신 설정의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-105"></a>미등록-105 | 80 | 화면 누락 기능 | 알림 관리 / 31 알림 CRUD·수신 설정의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-106"></a>미등록-106 | 40-D | 화면 누락 기능 | LLMOps / 40-D 품질·비용 지표의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-107"></a>미등록-107 | 34 | 화면 누락 기능 | 신고·운영 관리 / 34 신고·소명·조치 관리의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-108"></a>미등록-108 | 83 | 화면 누락 기능 | Fork 관리 / Fork 정합성 운영 점검의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-109"></a>미등록-109 | 84 | 화면 누락 기능 | 창작 이용 안내 / 집필 방식·저작권 사전 확인의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-110"></a>미등록-110 | 85 | 화면 누락 기능 | 운영 현황 관리 / 업무·데이터 현황 조회의 구현 범위·정책 및 전용 이슈 등록 검토 |
| <a id="미등록-111"></a>미등록-111 | 89 | 실행 기반 | 기존 콘텐츠·첨부·Studio 코드/테스트 추출, 업무별 fresh V1~V9·writer 소유 분리, 공개 라우팅·Content 이미지/Compose/CD·CI 소비자 선택을 로컬 구현; Auth·첨부·Studio SQL 바이트 보존. 실제 DB 대상/보존·복구 승인·hosted 재생·앱 기동·게시/배포·병합/최신 head Required CI 확인 전이므로 모든 이전 행은 ❌ 유지 |
| <a id="미등록-112"></a>미등록-112 | 89 | 실행 기반 | 운영 독립 Gradle·Spring Boot 진입점·loopback 설정·선택 단위 테스트 골격을 로컬 구현; 업무·DB·배포 구현, 앱 기동, 병합·최신 head Required CI 확인 전이므로 ❌ 유지 |
| <a id="미등록-113"></a>미등록-113 | 90 | 인증 연계 | POST /internal/v1/auth/verify의 별도 서비스 자격·서명/만료/UUID JWT 확인, Content HTTP Service proxy·timeout/장애/401 구분·UUID Principal·CSRF/CORS 경계를 소스 구현; 캐시/재시도/fallback/키 공유 없음. bc672a0의 hosted Content 통합은 성공했으나 시스템 인증 장애의 503/504 기대 불일치로 Required CI 실패; 네트워크를 유지한 pause/unpause·정확한 504/CORE_AUTH_TIMEOUT 회귀 보완은 hosted 재검증·병합 전이므로 ❌ 유지 |
| <a id="미등록-114"></a>미등록-114 | 43 | 빌드 캐시 잠금 | Core·Content Dockerfile의 `/root/.gradle` cache mount에 `sharing=locked`를 적용해 서비스 간·동일 서비스 동시 빌드의 캐시 사용 구간을 보호; 정적 계약 RED→GREEN 확인. 실제 이미지 빌드·병합·최신 head Required CI 검증 전이므로 ❌ 유지 |

## 연결한 GitHub 이슈

조회 기준: 2026-11-04. 상태는 조회 당시 기준이며 이후 바뀔 수 있다. 열린 이슈라고 코드가 전혀 없다는 뜻도, 병합된 관련 PR이 있다고 이슈 전체가 완료됐다는 뜻도 아니다.

| 이슈 | 제목 | 조회 당시 상태 |
|---|---|---|
| [#10](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/10) | fix: 집필실 사전 편집을 모두 같은 저장 대기열로 처리 (백엔드 연결 시) | OPEN |
| [#23](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/23) | fix: 회차 뷰어 문장 선택을 키보드로 조작할 수 있게 개선 | OPEN |
| [#25](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/25) | fix: 토스트 알림이 스크린 리더에 안내되도록 live region 유지 | OPEN |
| [#29](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/29) | fix: useAsyncData가 deps 변경 시 이전 데이터를 비우도록 수정 | OPEN |
| [#30](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/30) | fix: 내 서재 세계관 기능의 소유권 검사와 비공개 규칙 노출 차단 | OPEN |
| [#31](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/31) | fix: 가져오기 저장 시 편집된 정리 결과 검증 | OPEN |
| [#32](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/32) | fix: 피드백함 수정안 승인·반영 실패 흐름 정리 | OPEN |
| [#33](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/33) | fix: 세계관 복원 실패 시 성공 토스트 표시 오류 | OPEN |
| [#34](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/34) | fix: 집필실 회차 공개 중복 발행과 공개 시트 제목 초기값 | OPEN |
| [#48](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48) | feat: 세계관 생성·설정 관리 기능 구현 | OPEN |
| [#49](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49) | feat: 작품 생성 및 관리 기능 구현 | OPEN |
| [#50](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/50) | feat: 회차 생성 및 원고 관리 기능 구현 | OPEN |
| [#52](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52) | feat: 회원 가입·로그인 및 Auth 모듈 구현 | OPEN |
| [#54](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54) | feat: 집필 AI 요청·문맥·권한 계약 수립 | OPEN |
| [#55](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/55) | feat: LangGraph 라우터와 공통 가드레일 구현 | OPEN |
| [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56) | feat: 작품 자료 검색과 근거 기반 답변 구현 | OPEN |
| [#57](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/57) | feat: 집필 AI 멀티턴 문맥과 세션 재개 구현 | OPEN |
| [#58](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/58) | feat: 캐릭터 다중 에이전트 시뮬레이션 구현 | OPEN |
| [#59](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/59) | feat: 작품 자료 검수와 조건부 시뮬레이션 구현 | OPEN |
| [#60](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/60) | feat: AI 수정 제안과 승인 후 정본 반영 구현 | OPEN |
| [#61](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/61) | feat: 콘티 구체화와 다중 문서 변경안 생성 | OPEN |
| [#62](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/62) | feat: 문체·인물 말투 변환과 문장 생성 구현 | OPEN |
| [#63](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/63) | ci: GHCR 비공개 Docker 이미지 게시 자동화 | OPEN |
| [#64](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/64) | ci: Tailscale 기반 서버 CD 워크플로 구성 | OPEN |
| [#72](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/72) | test: 병합된 콘텐츠 코드·요구사항 정합성 재리뷰 | OPEN |
| [#73](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/73) | feat: 콘텐츠 사용자 화면을 최신 요구사항과 실제 API에 정렬 | OPEN |
| [#74](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/74) | fix: 인증 갱신의 일시 장애와 세션 만료 구분 | OPEN |
| [#75](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/75) | refactor: Auth 공개 계약 문서와 요청 DTO 위치 정렬 | OPEN |
| [#84](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/84) | refactor: content 책임 분리와 단순 Episode CRUD 구조 정리 | OPEN |
| [#87](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/87) | feat: 이미지·파일 CRUD와 MinIO 저장 연동 구현 | OPEN |
| [#89](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/89) | feat: 알림함·알림 설정 및 RabbitMQ 웹 알림·AWS SNS 모바일 푸시 구현 | OPEN |
| [#92](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/92) | feat: 프론트 이미지·파일 업로드와 작품 표지·원고 이미지 저장 연결 | OPEN |

## 연결한 Pull Request

조회 기준: 2026-11-04. 최신 head의 Required CI 조회 결과이며, PR 본문에 남은 과거 대기 문구와 구분한다. `미확인`은 성공이 아니다.

| PR | 제목 | 상태 | Required CI |
|---|---|---|---|
| [PR #45](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/45) | ci: GitHub Actions CI와 로컬·CI 검증 지침 추가 | MERGED | SUCCESS |
| [PR #65](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/65) | ci: Tailscale 기반 develop 이미지 배포 추가 | MERGED | SUCCESS |
| [PR #67](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/67) | ci: CI·이미지 게시·배포 워크플로 분리 | MERGED | SUCCESS |
| [PR #68](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68) | feat: 회차 생성 및 원고 버전 관리 기능 구현 | MERGED | SUCCESS |
| [PR #71](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71) | feat: 회원 인증·프로필 API와 인증 화면 연결 | MERGED | SUCCESS |
| [PR #76](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76) | feat: 세계관 직접 작성·저장·재조회 추가 | CLOSED | SUCCESS |
| [PR #77](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/77) | fix: 배포 SSH 대상 Tailscale 주소 수정 | MERGED | SUCCESS |
| [PR #79](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/79) | fix: 인증 갱신 장애 구분과 Auth 공개 계약 정렬 | MERGED | SUCCESS |
| [PR #80](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/80) | fix: 이미지 게시와 배포 대상을 develop으로 제한 | MERGED | SUCCESS |
| [PR #81](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81) | feat: 작품 등록 메타데이터 검증 규칙 추가 | OPEN | SUCCESS |
| [PR #83](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/83) | fix: 집필실 중복 발행 방지 및 공개 시트 제목 동기화 | OPEN | SUCCESS |
| [PR #86](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86) | docs: 초기 세계관 저장 모델 및 회차 연동 계약 제안 | OPEN | SUCCESS |
| [PR #88](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88) | refactor: Auth 계층과 JPA 영속성 책임 정리 | MERGED | SUCCESS |
| [PR #90](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/90) | feat: 설정 이미지·파일 CRUD와 S3 저장 연동 구현 | MERGED | SUCCESS |
| [PR #91](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91) | refactor: 콘텐츠 업무 책임 분리 및 기존 ERD 기반 JPA 전환 | OPEN | 미확인 |
| [PR #93](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/93) | feat: 이미지·파일 업로드와 작품 표지·원고 이미지 저장 연결 | MERGED | SUCCESS |
| [PR #94](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/94) | ci: 변경 영향 기반 테스트와 Compose CD 통합 | MERGED | SUCCESS |
| [PR #95](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/95) | refactor: 첨부파일 패키지와 서비스를 하나로 통합 | MERGED | SUCCESS |

## 검색·랭킹 화면 근거

- [검색·랭킹·태그 화면](../frontend/src/presentation/features/reading/view/ExplorePages.tsx)
- [홈 인기·급상승·최신·큐레이션 화면](../frontend/src/presentation/features/home/view/HomePage.tsx)
- [데모 조회·정렬](../frontend/src/domain/usecases/ReadingUseCase.ts): TOP10은 좋아요 정렬, 급상승은 조회수 정렬, 에디터 Pick·주간은 고정 ID 목록이다. 실제 기간별 통계·개인화 추천으로 간주하지 않는다.

### 화면 대조 항목의 해석

기존 01~47 묶음과 의미가 겹치는 항목은 제외하고 실제 화면·핸들러에서 확인한 누락 동작만 추가했다. 화면 대조로 추가한 행의 ❌는 화면이 없다는 뜻이 아니라 **업무 서버·수용 검증까지의 개발 완료를 확인하지 못했다**는 뜻이다. 관련 기존 이슈는 연계 범위이고, 새 미등록 번호는 해당 기능 전체의 등록 검토용이다. 특히 #47은 캐릭터챗 클라이언트 취소·중복 전송 지적이지 캐릭터챗 전체 구현 이슈가 아니다.

- 관리자 세부 권한·사용자 정의 속성·정합성 해시·자료 명세 등은 **데모 화면에서 식별한 검토 대상**이다. 기존 단일 운영 역할이나 DEC-37을 화면에 맞춰 변경하지 않는다. 개별 권한 모델·고정 해시 알고리즘·복수 세계관 연결·외부 수집/학습을 승인한 것이 아니다.
- 캐릭터챗은 집필 AI 대화와 별도인 독자 기능이며 전체 서비스 후보로 포함한다. 현재 고정 응답을 실제 LLM 기능으로 간주하지 않는다.
- 문의·공지·이벤트·신고·회원 운영 등은 DEC-41에 따라 운영 관리 서비스의 목표 책임으로 재분류했다. 회원 제한은 Core, 콘텐츠 제한은 콘텐츠 서비스에 적용 요청한다. 과거 화면 조사는 분리 전 구현의 근거다.


## 화면 조사 범위·추가 행 근거

소스 기준 병렬 조사이며 실제 브라우저 실행·클릭·서버 호출 검증은 하지 않았다. App.tsx의 32개 Route 등록(리다이렉트·catch-all 포함), 런타임 화면·공통 TSX 44개를 조사 목록과 대조했다. 테스트 TSX 5개는 화면 수에서 제외했다. 하위 ViewModel·UseCase·상태·저장소도 관련 호출을 확인했다. Graphify에는 오래된 커밋·누락 파일이 있어 최종 판단은 현재 소스에 근거한다.

| 확인한 화면·공통 UI 소스 |
|---|
| [AccountPage.tsx](../frontend/src/presentation/features/account/view/AccountPage.tsx) |
| [Devices.tsx](../frontend/src/presentation/features/account/view/Devices.tsx) |
| [AdminPage.tsx](../frontend/src/presentation/features/admin/view/AdminPage.tsx) |
| [AuthLayout.tsx](../frontend/src/presentation/features/auth/view/AuthLayout.tsx) |
| [LoginPage.tsx](../frontend/src/presentation/features/auth/view/LoginPage.tsx) |
| [RecoveryPage.tsx](../frontend/src/presentation/features/auth/view/RecoveryPage.tsx) |
| [Signup.tsx](../frontend/src/presentation/features/auth/view/Signup.tsx) |
| [VerifyEmailPage.tsx](../frontend/src/presentation/features/auth/view/VerifyEmailPage.tsx) |
| [ChatPages.tsx](../frontend/src/presentation/features/chat/view/ChatPages.tsx) |
| [ContextPreview.tsx](../frontend/src/presentation/features/content/view/ContextPreview.tsx) |
| [EpisodePage.tsx](../frontend/src/presentation/features/content/view/EpisodePage.tsx) |
| [WorldPanel.tsx](../frontend/src/presentation/features/content/view/WorldPanel.tsx) |
| [ForkPage.tsx](../frontend/src/presentation/features/fork/view/ForkPage.tsx) |
| [ForkedPage.tsx](../frontend/src/presentation/features/fork/view/ForkedPage.tsx) |
| [WritingPolicyPage.tsx](../frontend/src/presentation/features/fork/view/WritingPolicyPage.tsx) |
| [HomePage.tsx](../frontend/src/presentation/features/home/view/HomePage.tsx) |
| [InboxPage.tsx](../frontend/src/presentation/features/inbox/view/InboxPage.tsx) |
| [NotificationsPage.tsx](../frontend/src/presentation/features/inbox/view/NotificationsPage.tsx) |
| [ImportPage.tsx](../frontend/src/presentation/features/library/view/ImportPage.tsx) |
| [LibraryPage.tsx](../frontend/src/presentation/features/library/view/LibraryPage.tsx) |
| [NewWorkPage.tsx](../frontend/src/presentation/features/library/view/NewWorkPage.tsx) |
| [Amb.tsx](../frontend/src/presentation/features/reading/view/Amb.tsx) |
| [ExplorePages.tsx](../frontend/src/presentation/features/reading/view/ExplorePages.tsx) |
| [ReaderPage.tsx](../frontend/src/presentation/features/reading/view/ReaderPage.tsx) |
| [Sheets.tsx](../frontend/src/presentation/features/reading/view/Sheets.tsx) |
| [WorkPage.tsx](../frontend/src/presentation/features/reading/view/WorkPage.tsx) |
| [StudioPage.tsx](../frontend/src/presentation/features/studio/view/StudioPage.tsx) |
| [StudioSheets.tsx](../frontend/src/presentation/features/studio/view/StudioSheets.tsx) |
| [StudioViews.tsx](../frontend/src/presentation/features/studio/view/StudioViews.tsx) |
| [WritingStudio.tsx](../frontend/src/presentation/features/studio/view/WritingStudio.tsx) |
| [Go.tsx](../frontend/src/presentation/shared/Go.tsx) |
| [Portrait.tsx](../frontend/src/presentation/shared/Portrait.tsx) |
| [Sheet.tsx](../frontend/src/presentation/shared/Sheet.tsx) |
| [art.tsx](../frontend/src/presentation/shared/art.tsx) |
| [CoreApiConnectionStatus.tsx](../frontend/src/presentation/shared/core-api-status/CoreApiConnectionStatus.tsx) |
| [icons.tsx](../frontend/src/presentation/shared/icons.tsx) |
| [MediaPanel.tsx](../frontend/src/presentation/shared/media/MediaPanel.tsx) |
| [RequireRole.tsx](../frontend/src/presentation/shared/session/RequireRole.tsx) |
| [AccountMenu.tsx](../frontend/src/presentation/shared/shell/AccountMenu.tsx) |
| [GlobalChrome.tsx](../frontend/src/presentation/shared/shell/GlobalChrome.tsx) |
| [Gnb.tsx](../frontend/src/presentation/shared/shell/Gnb.tsx) |
| [PolicySheet.tsx](../frontend/src/presentation/shared/shell/PolicySheet.tsx) |
| [QuickJump.tsx](../frontend/src/presentation/shared/shell/QuickJump.tsx) |
| [ThemeButton.tsx](../frontend/src/presentation/shared/shell/ThemeButton.tsx) |

| 중간 기능 번호 | 추가 동작 | 소스 근거 |
|---|---|---|
| 48 | 공개 회차 목록 오래된 순·최신 순 전환 | [WorkPage.tsx:63](../frontend/src/presentation/features/reading/view/WorkPage.tsx#L63) |
| 20 | 작품 내 공개 회차 제목·본문 검색 | [WorkPage.tsx:66](../frontend/src/presentation/features/reading/view/WorkPage.tsx#L66) |
| 50 | 작품 링크 공유 | [WorkPage.tsx:53](../frontend/src/presentation/features/reading/view/WorkPage.tsx#L53) |
| 50 | 회차 링크 공유 | [ReaderPage.tsx:69](../frontend/src/presentation/features/reading/view/ReaderPage.tsx#L69) |
| 50 | 선택 문장 인용 공유 | [ReaderPage.tsx:143](../frontend/src/presentation/features/reading/view/ReaderPage.tsx#L143) |
| 51 | 뷰어 배경 모드 변경 | [Sheets.tsx:105](../frontend/src/presentation/features/reading/view/Sheets.tsx#L105) |
| 51 | 뷰어 배경 움직임 켜기·끄기 | [Sheets.tsx:106](../frontend/src/presentation/features/reading/view/Sheets.tsx#L106) |
| 51 | 뷰어 글자 크기 조절 | [Sheets.tsx:107](../frontend/src/presentation/features/reading/view/Sheets.tsx#L107) |
| 21-C | 읽은 회차 기록 저장 | [ReadingUseCase.ts:93](../frontend/src/domain/usecases/ReadingUseCase.ts#L93) |
| 21-C | 회차별 읽음 상태 조회 | [WorkPage.tsx:73](../frontend/src/presentation/features/reading/view/WorkPage.tsx#L73) |
| 53 | 선택 원작의 공개 Fork 작품 목록 조회 | [ExplorePages.tsx:135](../frontend/src/presentation/features/reading/view/ExplorePages.tsx#L135) |
| 54 | 원작의 Fork 허용 회차 목록 조회 | [ForkPage.tsx:38](../frontend/src/presentation/features/fork/view/ForkPage.tsx#L38) |
| 54 | 선택 기준 회차에서 가져올 공개 세계관·인물·사건 미리보기 | [ForkPage.tsx:42](../frontend/src/presentation/features/fork/view/ForkPage.tsx#L42) |
| 55 | 홈 무료 작품만 보기 | [ReadingUseCase.ts:11](../frontend/src/domain/usecases/ReadingUseCase.ts#L11) |
| 55 | 홈 Fork가 있는 원작만 보기 | [ReadingUseCase.ts:12](../frontend/src/domain/usecases/ReadingUseCase.ts#L12) |
| 56 | 앱 라이트·다크 모드 전환 | [ThemeButton.tsx:3](../frontend/src/presentation/shared/shell/ThemeButton.tsx#L3) |
| 57 | 작품에 사용할 기존 세계관 선택·연결 | [NewWorkPage.tsx:69](../frontend/src/presentation/features/library/view/NewWorkPage.tsx#L69) |
| 05 | 설정 항목 별칭 추가 | [StudioViews.tsx:121](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L121) |
| 05 | 설정 항목 별칭 제거 | [StudioViews.tsx:121](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L121) |
| 59 | 설정 문서 사용자 정의 속성 추가 | [StudioViews.tsx:125](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L125) |
| 59 | 설정 문서 사용자 정의 속성 이름 변경 | [StudioViews.tsx:125](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L125) |
| 59 | 설정 문서 사용자 정의 속성 값 수정 | [StudioViews.tsx:125](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L125) |
| 60 | 설정 본문·속성의 다른 문서 이름을 내부 링크로 탐색 | [StudioViews.tsx:88](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L88) |
| 61 | 현재 설정 문서를 언급한 다른 문서 목록 조회 | [StudioViews.tsx:114](../frontend/src/presentation/features/studio/view/StudioViews.tsx#L114) |
| 62 | 회차 작가의 말 작성 | [StudioPage.tsx:175](../frontend/src/presentation/features/studio/view/StudioPage.tsx#L175) |
| 62 | 회차 작가의 말 수정 | [StudioPage.tsx:175](../frontend/src/presentation/features/studio/view/StudioPage.tsx#L175) |
| 63 | 원고 글자 수 확인 | [StudioPage.tsx:176](../frontend/src/presentation/features/studio/view/StudioPage.tsx#L176) |
| 64 | 공개 확정 전 선택 저장 원고 미리보기 | [EpisodePage.tsx:79](../frontend/src/presentation/features/content/view/EpisodePage.tsx#L79) |
| 65 | 미저장 원고·설정이 있을 때 이탈 또는 대상 전환 확인 | [useWritingViewModel.ts:33](../frontend/src/presentation/features/studio/viewmodel/useWritingViewModel.ts#L33) |
| 66 | 진행 중 원고 저장 요청 취소 | [WritingStudio.tsx:46](../frontend/src/presentation/features/studio/view/WritingStudio.tsx#L46) |
| 66 | 진행 중 파일 요청 취소 | [WritingStudio.tsx:46](../frontend/src/presentation/features/studio/view/WritingStudio.tsx#L46) |
| 66 | 취소 후 서버 처리 여부 재확인 안내 | [WritingStudio.tsx:46](../frontend/src/presentation/features/studio/view/WritingStudio.tsx#L46) |
| 67 | 이용·계정·권리 등 문의 유형을 선택해 문의 등록 | [AccountPage.tsx:124](../frontend/src/presentation/features/account/view/AccountPage.tsx#L124) |
| 67 | 내 고객지원 문의 목록 조회 | [AccountPage.tsx:130](../frontend/src/presentation/features/account/view/AccountPage.tsx#L130) |
| 67 | 내 고객지원 문의 본문·처리 상태 조회 | [AccountPage.tsx:132](../frontend/src/presentation/features/account/view/AccountPage.tsx#L132) |
| 67 | 내 고객지원 문의의 운영팀 답변 조회 | [AccountPage.tsx:132](../frontend/src/presentation/features/account/view/AccountPage.tsx#L132) |
| 67 | 운영 고객지원 문의 목록·상태 조회 | [AdminPage.tsx:182](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L182) |
| 67 | 운영팀 문의 답변 등록 | [AdminPage.tsx:184](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L184) |
| 68 | 공지 목록 조회 | [AccountPage.tsx:64](../frontend/src/presentation/features/account/view/AccountPage.tsx#L64) |
| 68 | 공지 상세 조회 | [AccountPage.tsx:62](../frontend/src/presentation/features/account/view/AccountPage.tsx#L62) |
| 68 | 운영 공지 게시 | [AdminPage.tsx:115](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L115) |
| 69 | 이벤트 목록 조회 | [AccountPage.tsx:69](../frontend/src/presentation/features/account/view/AccountPage.tsx#L69) |
| 69 | 이벤트 상세·기간·진행 상태 조회 | [AccountPage.tsx:67](../frontend/src/presentation/features/account/view/AccountPage.tsx#L67) |
| 69 | 운영 이벤트 등록 | [AdminPage.tsx:110](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L110) |
| 69 | 운영 이벤트 목록 조회 | [AdminPage.tsx:111](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L111) |
| 69 | 이벤트 진행·종료 상태 변경 | [AdminPage.tsx:112](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L112) |
| 70 | 이벤트 안내에서 관련 기능으로 이동 | [AccountPage.tsx:67](../frontend/src/presentation/features/account/view/AccountPage.tsx#L67) |
| 71 | 관리자 계정 목록 조회 | [AdminPage.tsx:199](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L199) |
| 71 | 관리자 계정 생성 | [AdminPage.tsx:195](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L195) |
| 71 | 관리자 계정 생성 시 업무별 권한 부여 | [AdminPage.tsx:197](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L197) |
| 71 | 관리자별 부여 권한 조회 | [AdminPage.tsx:200](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L200) |
| 72 | 관리자 조치의 수행자·시각·대상·내역 기록 | [AdminUseCase.ts:33](../frontend/src/domain/usecases/AdminUseCase.ts#L33) |
| 72 | 관리자 전체 활동 로그 최신순 조회 | [AdminPage.tsx:118](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L118) |
| 73 | 운영 회원 목록·역할·상태 조회 | [AdminPage.tsx:82](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L82) |
| 73 | 역할별 회원 목록 필터 | [AdminPage.tsx:80](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L80) |
| 73 | 회원 이름·이메일 검색 | [AdminPage.tsx:81](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L81) |
| 73 | 회원 가입 최신순 정렬 | [AdminPage.tsx:80](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L80) |
| 73 | 회원 가입 오래된순 정렬 | [AdminPage.tsx:80](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L80) |
| 73 | 회원 이용 제한 | [AdminPage.tsx:83](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L83) |
| 73 | 회원 이용 제한 해제 | [AdminPage.tsx:83](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L83) |
| 74 | 운영 작품 목록·작성자·권리·공개 상태 조회 | [AdminPage.tsx:88](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L88) |
| 74 | 운영 작품 원작·Fork 필터 | [AdminPage.tsx:87](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L87) |
| 74 | 운영 작품명·작성자·권리 유형 검색 | [AdminPage.tsx:86](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L86) |
| 74 | 운영 작품 제목순 정렬 | [AdminPage.tsx:87](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L87) |
| 74 | 운영 작품 제목 역순 정렬 | [AdminPage.tsx:87](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L87) |
| 75 | 작품별 운영 댓글 필터 | [AdminPage.tsx:100](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L100) |
| 75 | 운영 댓글 내용·작품명·작성자 검색 | [AdminPage.tsx:99](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L99) |
| 75 | 운영 댓글 공감 많은순 정렬 | [AdminPage.tsx:100](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L100) |
| 75 | 운영 댓글 공감 적은순 정렬 | [AdminPage.tsx:100](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L100) |
| 76 | 대화 가능한 공개 작품·캐릭터 챗 목록 조회 | [ChatPages.tsx:28](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L28) |
| 76 | 캐릭터챗 원작·Fork 유형 필터 | [ChatPages.tsx:29](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L29) |
| 76 | 캐릭터챗 작품 필터 | [ChatPages.tsx:34](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L34) |
| 76 | 캐릭터챗 인물 필터 | [ChatPages.tsx:35](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L35) |
| 76 | 캐릭터챗 연결 작품 최신순 정렬 | [ChatPages.tsx:37](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L37) |
| 76 | 캐릭터챗 연결 작품 인기순 정렬 | [ChatPages.tsx:37](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L37) |
| 76 | 캐릭터챗 연결 작품 조회순 정렬 | [ChatPages.tsx:37](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L37) |
| 76 | 작품·인물을 선택해 대화방 조회·재개 | [ChatPages.tsx:72](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L72) |
| 76 | 작품·인물별 기존 대화 기록 조회 | [ChatPages.tsx:78](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L78) |
| 77 | 추천 질문 선택 후 캐릭터 답변 요청 | [ChatPages.tsx:81](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L81) |
| 77 | 자유 질문 입력 후 캐릭터 답변 요청 | [ChatPages.tsx:82](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L82) |
| 77 | 읽은 회차 기준으로 인물·답변 범위 제한 | [ChatPages.tsx:73](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L73) |
| 77 | 응답 근거 회차·근거 없음 표시 | [ChatPages.tsx:80](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L80) |
| 77 | 미열람 회차 질문의 답변 보류·스포일러 차단 | [ChatPages.tsx:81](../frontend/src/presentation/features/chat/view/ChatPages.tsx#L81) |
| 78 | 운영 캐릭터챗 연결 목록·상태 조회 | [AdminPage.tsx:93](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L93) |
| 78 | 공개 작품·캐릭터 연결로 캐릭터챗 등록 | [AdminPage.tsx:171](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L171) |
| 78 | 캐릭터챗 운영 중지 | [AdminPage.tsx:95](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L95) |
| 78 | 캐릭터챗 운영 재개 | [AdminPage.tsx:95](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L95) |
| 78 | 운영 캐릭터챗 원작·Fork 분류 | [AdminPage.tsx:93](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L93) |
| 78 | 운영 캐릭터챗 작품명·캐릭터 검색 | [AdminPage.tsx:92](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L92) |
| 78 | 운영 캐릭터챗 작품 제목순 정렬 | [AdminPage.tsx:93](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L93) |
| 78 | 운영 캐릭터챗 작품 제목 역순 정렬 | [AdminPage.tsx:93](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L93) |
| 31 | 전체 알림 일괄 읽음 처리 | [NotificationsPage.tsx:14](../frontend/src/presentation/features/inbox/view/NotificationsPage.tsx#L14) |
| 80 | 알림 선택 후 관련 업무 화면으로 이동 | [NotificationsPage.tsx:23](../frontend/src/presentation/features/inbox/view/NotificationsPage.tsx#L23) |
| 40-D | 실패·지연 경고 확인 및 수동 조치 완료 기록 | [AdminPage.tsx:155](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L155) |
| 34 | 작품 등록자에게 권리 증빙 요청 | [AdminPage.tsx:142](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L142) |
| 83 | Fork 스냅샷 해시·원작 해시·인물 상태 차이 점검 결과 조회 | [AdminPage.tsx:147](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L147) |
| 84 | Fork 집필 정책과 저작권 안내 개별 확인 후 계속 | [WritingPolicyPage.tsx:38](../frontend/src/presentation/features/fork/view/WritingPolicyPage.tsx#L38) |
| 84 | 원고 가져오기 정책과 AI 처리 이용 권한 안내 개별 확인 후 계속 | [WritingPolicyPage.tsx:38](../frontend/src/presentation/features/fork/view/WritingPolicyPage.tsx#L38) |
| 85 | 답변 대기 문의·접수 신고·작가 검토 대기 수 조회 | [AdminPage.tsx:126](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L126) |
| 85 | 수집 자료 출처·수량·형식·사용처 명세 조회 | [AdminPage.tsx:130](../frontend/src/presentation/features/admin/view/AdminPage.tsx#L130) |

## WorldStudio 프런트엔드 선별 통합

메모리 데모이며 PostgreSQL HTTP API와 연결되지 않는다. 미병합 PR은 완료 표시하지 않는다.

| 서비스 | 서브시스템 | 중간 기능 | 세부 기능 | 개발 완료 | 관련 이슈 |
|---|---|---|---|---|---|
| Frontend | WorldStudio 데모 | 설정 카드 | 세계관 작업실 진입 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 세계관 기본 정보 작성 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 설정 카드 추가 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 설정 카드 선택 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 설정 카드 수정 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 카드 유형 선택(8종) | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 설정 영역 선택(7종) | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 별칭 보존 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 태그 보존 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 사용자 분류 보존 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio 데모 | 설정 카드 | 기존 메타데이터 보존 | ❌ | [PR #112](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/112) |
| Frontend | WorldStudio | 관계 편집 | 관계 source·target 선택 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 구조 관계 생성·수정 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 방향별 감정 관계 생성·수정 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 대칭·방향 관계와 기존 ID 유지 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 관계 없는 상태 안내 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 인물 삭제와 연결 관계 삭제 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 외부 참조가 있는 인물 삭제 차단 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 관계 편집 | 인물 삭제 후 동일 ID로 되돌리기 | ❌ | [PR #113](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/113) |
| Frontend | WorldStudio | 세계관 탐색 | 저장된 세계관 지도 표시 | ❌ | [PR #114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) |
| Frontend | WorldStudio | 세계관 탐색 | 설정 검색·선택 | ❌ | [PR #114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) |
| Frontend | WorldStudio | 세계관 탐색 | 연결된 설정 탐색 | ❌ | [PR #114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) |
| Frontend | WorldStudio | 세계관 탐색 | 인물 관계도 표시 | ❌ | [PR #114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) |
| Frontend | WorldStudio | 세계관 탐색 | 빈 세계관 안내 | ❌ | [PR #114](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/114) |
