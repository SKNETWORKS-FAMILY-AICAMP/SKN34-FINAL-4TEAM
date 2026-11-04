# STORYFORK 기능 분류표

> 예시 이미지처럼 **서비스 → 서브시스템 → 중간 기능 → 세부 기능**을 계층으로 묶고, **세부 동작 하나당 한 행**으로 정리한다. 현재 구현과 앞으로 개발할 전체 서비스 기능을 함께 포함한다.

## 표 기준

> **서비스 열은 DEC-41의 목표 소유권이다.** [서비스 경계·실행 구조](design/service-boundaries.md)를 따른다. 기존 ✅는 해당 동작의 종전 구현 근거이지 새 서비스로의 이전 완료가 아니다. 현재 코드·API·DB는 분리 전 상태다. LLMOps는 운영 영역으로 분류하되 Langfuse 자체 UI와 운영 화면 API 통합은 미정이며 Spring 내부 구현을 뜻하지 않는다. 정기 작업 행은 운영의 감시·관리 관점이고 실제 실행은 업무 소유 서비스에 둔다.


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
- 독립 WorldStudio 저장소·Service의 로컬 구현 범위는 해당 행에 표시했다. Content 없이 전용 schema에서 동작하며 HTTP API·프런트·Graph·이미지·회차 연동은 포함하지 않는다. 미병합이므로 완료 표시는 ❌를 유지한다.
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
<tr><td rowspan="286">콘텐츠 서비스</td><td rowspan="8">권한 관리</td><td rowspan="8">03 접근·공개 범위 관리</td><td>작품 소유권 확인</td><td>❌</td><td rowspan="8"><a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/48">#48</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/49">#49</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/54">#54</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/76">PR #76</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/86">PR #86</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/81">PR #81</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/71">PR #71</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/68">PR #68</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/91">PR #91</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/52">#52</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/88">PR #88</a> · <a href="https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/pull/97">PR #97</a></td></tr>
<tr><td>세계관 소유권 확인</td><td>❌ <small>(독립 JPA 내부 구현·미병합/HTTP 미연결)</small></td></tr>
