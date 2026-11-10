# TASK 13 — Template Recommendation 인수 계약

2026-11-10 현재 코드 기준으로 누락 링크를 보완했다. 최초 구현은 `43aa1db`이며 과거 인수 원문의 복원이 아니다.
직접 연결은 [#56](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN34-FINAL-4TEAM/issues/56), 검색 계약 참고는 #125다. 이슈 상태는 변경하지 않는다.

## 호출·반환

`app/agents/template_recommendation.py`의 `TemplateRecommendationRequest(query, context, customize=False)`를
`template_recommendation(request, content=..., retriever=..., model=...)`에 전달한다.
`CatalogContext`는 언어·장르·태그·선택 요약·기존 설정 태그·기존 템플릿 ID/버전의 `ExactSource`들을 가진다.
Content에서 확인한 공개 setting만 검색 입력으로 만들며 원고·원래 자유문·인물/문서 필터를 전달하지 않는다.

기존 `TemplateVectorRetriever.search(query)`는 유지하고 `search(query, tags=())` 선택 필터만 추가했다.
라이선스·활성·만료·언어·장르·버전을 조회 전후 확인하고, 적용된 같은 ID는 중복, `conflicts_with`와 기존 태그 교집합은 명시 충돌로 표시한다.
단순 추천은 모델 0회, `customize=True`일 때만 `model.explain(ImpactRequest)`의 ID/버전별 설명을 받는다.

`Recommendations`는 items·sources·gaps·status·이유·`is_mock`를 가진다. item은 ID/버전·이름·목적·추천 이유·기대 변화·중복·충돌·라이선스·근거를 포함한다.
철회·갱신·권한 변경 시 본문·인용을 폐기하며 실패를 정상 빈 카탈로그로 숨기지 않는다.

## Run·한계

`REGISTRY['template']`와 run별 `TemplateRecommendationHandler`를 주입한다. 본문은 메모리, 실행기에는 참조·상태만 전달한다.
실제 카탈로그·구매/권리 확정·임베딩/Vector DB·설정 적용·공개 Run 자동 조립은 미연결이다.

## 검증

`tests/test_template_recommendation.py`의 33개 단위 대조쌍으로 권리·판본·만료·공개 입력·중복·충돌·모델 선택·실행기 경계를 확인한다.
현재 재실행 명령·결과는 [TASK 14 검증 기록](task14-handoff.md#검증)에 기록한다.
설계 근거: [03 §13](03-rag-simulation-design.md#13-template-recommendation), [07 카탈로그 계약](07-retrieval-contract-and-mocks.md), DEC-36·41.
