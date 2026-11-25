package ai.storyfork.content.world.service.dto

/**
 * 채울 문서([target]: `body`=IDENTITY·`soul`)의 줄 하나다. [quote]는 연결된 소설의 [episode]화 저장 원고에 글자 그대로 있는 문장이고
 * [kind]는 `fact`(인물을 단정하는 서술)·`description`(겉모습·말투를 보여 주는 묘사나 대사)이다. 화면이 `[사실] 문장`·`[묘사] 문장` 줄로 문서에 싣는다.
 */
data class WorldDocFillLine(val target: String, val kind: String, val episode: Int, val quote: String)

/**
 * 인물 문서 채우기 응답(docs/design/world-review-contract.md). [lines]가 비면 원고에서 근거를 찾지 못한 것이다(오류가 아니다). [skipped]는 AI가 원고에서
 * 확인하지 못해 뺀 줄 수이고 [model]은 응답한 모델이다(AI를 부르지 않았으면 빈 글). 제안만 돌려주며 카드를 바꾸지도, 결과를 저장하지도 않는다.
 */
data class WorldDocFillResponse(val cardId: String, val lines: List<WorldDocFillLine>, val skipped: Int, val model: String)
