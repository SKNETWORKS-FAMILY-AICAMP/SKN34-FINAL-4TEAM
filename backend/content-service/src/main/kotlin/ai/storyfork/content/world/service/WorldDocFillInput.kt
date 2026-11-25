package ai.storyfork.content.world.service

import ai.storyfork.content.world.client.dto.WorldDocFillAiPassage
import ai.storyfork.content.world.service.dto.CardPayload

/**
 * 인물 문서 채우기(docs/design/world-review-contract.md)의 AI 요청 재료: 채울 문서·이름·연결된 소설의 저장 원고 발췌.
 * ponytail: 이름이 나온 곳의 앞 [BEFORE]자·뒤 [AFTER]자를 발췌로 보내고(앞 발췌가 덮은 곳의 이름은 건너뛴다) 합계 [MAX_PASSAGE_CHARS]자에서 멈춘다. 자주 나오는 인물은 앞 회차 발췌만
 * 가서 뒤 회차의 성격은 빠진다(그런 인물은 대개 전처리가 이미 채웠다). 두 글자 미만의 이름은 어디서나 걸려 쓰지 않고, 호칭 변형(`치삼이`)은 별칭에 있어야 걸린다.
 */
object WorldDocFillInput {
    /** AI `MAX_FILL_CHARS`와 같은 수다. */
    const val MAX_PASSAGE_CHARS = 12000
    const val BEFORE = 150
    const val AFTER = 350
    private const val MIN_NAME = 2

    /** 비어 있는 필수 문서: IDENTITY(`body`)·SOUL(`soul`) 순. 공백뿐이면 빈 것이고(화면의 `missingCharacterDocs`와 같다) 문서 모양이 어긋나면 SOUL은 없는 것이다. */
    fun targets(card: CardPayload): List<String> = listOfNotNull(
        "body".takeIf { card.body.isBlank() },
        "soul".takeIf { ((card.semanticMetadata["characterDocs"] as? Map<*, *>)?.get("soul") as? String).isNullOrBlank() },
    )

    /** 원고에서 찾을 이름: 제목과 별칭을 다듬고 두 글자 이상만, 같은 이름은 한 번만. */
    fun names(card: CardPayload): List<String> = (listOf(card.title) + card.aliases).map(String::trim).filter { it.length >= MIN_NAME }.distinct()

    /** [episodes](회차 번호 → 저장 원고)에서 [names]가 나온 곳의 발췌를 회차 순서대로. 합계가 [MAX_PASSAGE_CHARS]를 넘기 전의 앞쪽만 담는다. */
    fun passages(names: List<String>, episodes: List<Pair<Int, String>>): List<WorldDocFillAiPassage> {
        val found = mutableListOf<WorldDocFillAiPassage>()
        var total = 0
        for ((number, body) in episodes.sortedBy { it.first }) {
            var covered = 0 // 앞 발췌가 끝난 곳: 그 앞은 다시 보내지 않고, 이 뒤에서 처음 나온 이름부터 새 발췌를 만든다
            while (true) {
                val hit = names.mapNotNull { name -> body.indexOf(name, covered).takeIf { it >= 0 } }.minOrNull() ?: break
                val start = body.pairStart(maxOf(covered, hit - BEFORE))
                val end = body.pairStart(minOf(body.length, hit + AFTER))
                if (total + (end - start) > MAX_PASSAGE_CHARS) return found
                found += WorldDocFillAiPassage(number, body.substring(start, end))
                total += end - start
                covered = end
            }
        }
        return found
    }

    /** [index]가 서로게이트 쌍의 가운데면 그 쌍의 앞으로 옮긴다(발췌가 글자 반쪽으로 시작하거나 끝나지 않게). */
    private fun String.pairStart(index: Int) = if (index in 1 until length && this[index].isLowSurrogate()) index - 1 else index
}
