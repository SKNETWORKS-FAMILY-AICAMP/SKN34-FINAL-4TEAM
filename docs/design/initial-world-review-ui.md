# 초기 세계관 후보 검토 UI — 7단계

## 7-A 저장 호환성

기준은 #284 HEAD cf3289346a74fae5c97b3ebba5a9dc51e87f9b01이다. #219/#225/#235/#262/#266/#270/#284는 Draft 의존성이며 병합하지 않는다.

HttpWorldStudioRepository는 기존 완전한 studio DTO와 6-B의 엄격히 검증한 부분 studio + preprocessing DTO를 구분한다. 부분 DTO는 카드/관계의 정본 필드를 사용하여 화면 모델을 구성한다. fact/goal/plan은 fact, conjecture는 claim, rule/event는 해당 의미 유형, relation은 관계로 표현하며 전부 메모로 변환하지 않는다. 목표/계획의 세부 유형은 preprocessing에 유지한다.

serverMetadata는 서버에서 받은 의미 정보와 근거의 보존용이다. replace:true 저장 시 화면의 studio만 갱신하고 preprocessing 및 추가 metadata는 보존한다. authorEdit의 화면 원문 수정은 기존처럼 근거를 비우며 preprocessing은 최초 적용의 출처 이력이다. 현재 원문의 새 근거로 표시하지 않는다.

관계 category/direction/polarity/endpoints는 서버 필드에서 복원한다. 기존 관계는 기존 predicate를 유지한다. 현재 편집기가 지원하지 않는 방향 없는 감정은 성공한 편집 대상으로 표시하지 않고 명시적으로 읽기 오류를 내며 원본을 서버에 남긴다.

## 검증

부분 DTO 재조회 실패를 먼저 재현한 단위 테스트를 추가했다. DTO 파싱, 전체 저장 및 재조회 후 원래 provenance/근거/식별자/순번/semanticType 보존과 기존 카드/관계 회귀를 검사한다. 실제 배포 서버와 유료 모델은 호출하지 않는다. 화면 연결과 브라우저 수용 QA는 후속 7-B 범위다.
