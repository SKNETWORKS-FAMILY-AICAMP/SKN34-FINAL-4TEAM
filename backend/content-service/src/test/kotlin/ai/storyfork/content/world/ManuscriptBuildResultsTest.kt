package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ManuscriptBuildResultsTest {
    private val first=ManuscriptBuildSource(1,"episode-1","version-1","첫 만남","😀 길동은 산채에 왔다.")
    private val second=ManuscriptBuildSource(2,"episode-2","version-2","계획","길동은 떠날 계획이다.")
    private val input=ManuscriptBuildInput(listOf(first,second))
    private fun result(source:ManuscriptBuildSource)=ManuscriptEpisodeResult(
        ManuscriptBuildResultBasis(source.number,source.versionId,source.hash),
        listOf(ManuscriptQuote(0,source.body.length,source.body)),mapOf("mentions" to emptyList<Any>(),"deferred" to listOf("대상 판정 보류")))

    @Test fun `retry selects only missing episodes and combines preserved success`() {
        val stored=result(first)
        assertEquals(listOf(second),input.missing(listOf(stored)))
        input.requireResults(listOf(result(second),stored))
        assertEquals(listOf("대상 판정 보류"),stored.extraction["deferred"])
    }
    @Test fun `missing duplicate foreign and mismatching results cannot finish`() {
        assertThrows(IllegalArgumentException::class.java) { input.requireResults(listOf(result(first))) }
        assertThrows(IllegalArgumentException::class.java) { input.missing(listOf(result(first),result(first))) }
        assertThrows(IllegalArgumentException::class.java) { input.missing(listOf(result(first).copy(basis=ManuscriptBuildResultBasis(3,first.versionId,first.hash)))) }
        assertThrows(IllegalArgumentException::class.java) { input.missing(listOf(result(first).copy(basis=ManuscriptBuildResultBasis(1,"changed",first.hash)))) }
    }
    @Test fun `evidence mismatch and UTF16 surrogate splitting cannot be persisted`() {
        assertThrows(IllegalArgumentException::class.java) { input.missing(listOf(result(first).copy(evidence=listOf(ManuscriptQuote(0,1,"?"))))) }
        assertThrows(IllegalArgumentException::class.java) { input.missing(listOf(result(first).copy(evidence=listOf(ManuscriptQuote(3,5,"없는"))))) }
        input.missing(listOf(result(first).copy(evidence=listOf(ManuscriptQuote(0,2,"😀")))))
    }
}
