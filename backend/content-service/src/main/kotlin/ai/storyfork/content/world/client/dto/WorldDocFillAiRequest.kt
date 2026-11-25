package ai.storyfork.content.world.client.dto

/** AI `POST /internal/v1/world-reviews/fill`의 요청 본문이다(docs/design/world-review-contract.md). 채울 문서와 발췌를 만드는 규칙은 `WorldDocFillInput`이 갖는다. */
data class WorldDocFillAiRequest(val cardId: String, val title: String, val aliases: List<String>, val targets: List<String>, val passages: List<WorldDocFillAiPassage>)

/** 원고 발췌 하나: 연결된 소설의 [episode]화 저장 원고에서 인물 이름이 나온 곳의 앞뒤 글이다. */
data class WorldDocFillAiPassage(val episode: Int, val text: String)
