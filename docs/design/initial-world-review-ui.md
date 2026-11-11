# 초기 세계관 후보 검토 UI — 7단계

## 7-A 저장 호환성

기준은 #284 HEAD cf3289346a74fae5c97b3ebba5a9dc51e87f9b01이다. #219/#225/#235/#262/#266/#270/#284는 Draft 의존성이며 병합하지 않는다.

HttpWorldStudioRepository는 기존 완전한 studio DTO와 6-B의 엄격히 검증한 부분 studio + preprocessing DTO를 구분한다. 부분 DTO는 카드/관계의 정본 필드를 사용하여 화면 모델을 구성한다. fact/goal/plan은 fact, conjecture는 claim, rule/event는 해당 의미 유형, relation은 관계로 표현하며 전부 메모로 변환하지 않는다. 목표/계획의 세부 유형은 preprocessing에 유지한다.

serverMetadata는 서버에서 받은 의미 정보와 근거의 보존용이다. replace:true 저장 시 화면의 studio만 갱신하고 preprocessing 및 추가 metadata는 보존한다. authorEdit의 화면 원문 수정은 기존처럼 근거를 비우며 preprocessing은 최초 적용의 출처 이력이다. 현재 원문의 새 근거로 표시하지 않는다.

관계 category/direction/polarity/endpoints는 서버 필드에서 복원한다. 기존 관계는 기존 predicate를 유지한다. 7-A 단독에서는 방향 없는 감정을 명시적으로 차단한다. 7-B 수용 점검에서 백엔드가 대칭 감정도 지원함을 대조하여, 해당 관계는 대칭·감정 predicate로 조회/재저장을 지원하고 기존 방향별 감정 편집 패널에서는 읽기 전용으로 표시하도록 보완했다. 방향을 임의로 바꾸거나 구조 관계로 변환하지 않는다.

## 검증

부분 DTO 재조회 실패를 먼저 재현한 단위 테스트를 추가했다. DTO 파싱, 전체 저장 및 재조회 후 원래 provenance/근거/식별자/순번/semanticType 보존과 기존 카드/관계 회귀를 검사한다. 실제 배포 서버와 유료 모델은 호출하지 않는다. 화면 연결과 브라우저 수용 QA는 후속 7-B 범위다.

## 7-B 검토·반영 화면

7-A 위에 별도 Draft로 연결한다. 실제 모드만 Content 공개 API를 사용하며 목업에서는 분석/검토/반영을 비활성화한다. 저장된 초안만 분석하고 미저장 세계관/관계 입력이 있으면 분석·반영을 막는다.

후보의 현재 상태는 가장 큰 decisionSequence로 계산한다. edit는 author_revision 및 빈 evidence로 보내며 별도 approve가 필요하다. held/rejected/pending은 적용 선택 불가다. 원래 AI 제안/근거와 작가 수정본을 구분하고 UUID/hash/revision은 기본 화면에 표시하지 않는다.

요청 전 계정 ID+세계관 ID로 구분한 localStorage에 key/path/payload를 보존한다. 이 기록에는 작성한 후보 수정문이 포함될 수 있다. 응답 결과/다른 계정 분석을 로컬에서 복원해 표시하지 않으며 서버 소유권 조회를 먼저 거친다. 저장소 기록 실패 시 전송하지 않는다. 로그아웃 후 동일 계정 재로그인에서는 같은 요청 복구만 제공한다. 브라우저 데이터 삭제/다른 장치에서는 이 복구 기록이 없으며 예약 취소 API를 가장하지 않는다. 서버가 명시적으로 409/422를 반환한 요청은 새 변경을 위해 정리하고 통신 실패/503/unknown은 보존한다. Web Locks와 화면 요청 ref로 중복 클릭·다른 탭의 동시 전송을 차단한다.

반영 applied 응답만으로 성공 문구를 내지 않는다. GET receipt와 서버 초안 재조회가 모두 끝난 뒤 요청 기록을 제거하고 완료를 안내한다. 조회 실패 시 같은 application 요청을 유지한다. 일부 반영으로 조회가 실패한 세계관도 분석 영역의 같은 요청 복구를 제공한다. 분석 중/unknown은 자동 새 key 호출 없이 명시적 결과 확인을 제공한다.

검증: 저장소 대역 단위(키·payload 보존, 재생성, 타 계정 격리, 보존 실패), UseCase 단위(최신 승인 순번·stale·보류/거절·author_revision), React 통합(서버 receipt+재조회 후 완료, 재조회 실패 시 성공 금지)을 추가했다. 통합/브라우저는 CI 및 별도 QA로 구분한다. 실제 유료 모델·개발 DB는 호출하지 않는다.

## 브라우저 QA (7-C 확인, 2026-11-11)

로컬 Vite 실제 HTTP 어댑터 + 별도 localhost HTTP 대역만 사용했다. 개발 배포 서버·PostgreSQL·Neo4j·유료 모델을 사용한 end-to-end 검증이 아니다.

- 실제 브라우저: 분석 요청 → 후보 표시 → 작가 수정 저장(pending, 체크박스 비활성) → Enter 승인 → Space 후보 선택 → application 503/unknown → 새로고침/세션 복원 → 같은 요청 복구 → GET receipt/초안 재조회 → 적용 카드와 stale 표시를 확인했다.
- 7-A 파싱을 사용하는 실제 화면에서 AI 부분 metadata 카드 재조회 성공. 재조회에서 receipt의 생성 ID와 revision이 존재하는지도 확인한 뒤 완료를 안내한다.
- 모바일 요청 390×844에서 Aside가 보고한 실제 CSS viewport는 488px, documentWidth 469px, 검토 영역 437px였다. 가로 넘침 없음, 주요 버튼 높이 44px. 모바일 CSS 배치 확인이며 정확한 390px 실기기 검증은 아니다.
- Aside screenshot은 full-page/viewport 모두 CDP timeout이 발생하여 이미지 육안 검증을 완료하지 못했다. 픽셀 수준 검토 및 실기기/배포 서버/실제 재로그인 수용 검증은 후속으로 남긴다.
- Impeccable detector 대상 JSX/CSS 지적 없음. Ponytail review: 기존 Web Locks·CSRF·인증·DI·저장 어댑터 재사용, 신규 라이브러리·백엔드 구조 추가 없음.

- 일반 세계관 이름 수정→replace:true 재저장 뒤 기존 인물과 적용 카드 2개, goal/author_revision/analysisId/candidateId/decisionSequence/evidence=[] 유지도 로컬 HTTP 대역의 실제 요청 데이터로 확인했다.
