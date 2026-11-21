package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ManuscriptBuildInputTest {
    private val first=ManuscriptBuildSource(1,"episode-a","saved-a","1화","😀\r\n길동은 떠났다.")
    private val second=ManuscriptBuildSource(2,"episode-b","saved-b","2화","길동은 돌아왔다.")

    @Test fun `fixed manifest requires exactly the complete saved episode set`() {
        val input=ManuscriptBuildInput(listOf(first,second))
        val complete=listOf(ManuscriptBuildResultBasis(2,"saved-b",second.hash),ManuscriptBuildResultBasis(1,"saved-a",first.hash))
        input.requireComplete(complete)
        assertThrows(IllegalArgumentException::class.java) { input.requireComplete(complete.take(1)) }
        assertThrows(IllegalArgumentException::class.java) { input.requireComplete(complete+complete.first()) }
        assertThrows(IllegalArgumentException::class.java) { input.requireComplete(complete.map { it.copy(versionId="new-version") }) }
        assertThrows(IllegalArgumentException::class.java) { input.requireComplete(complete.map { it.copy(sourceHash="0".repeat(64)) }) }
    }

    @Test fun `source hash and UTF16 evidence keep exact raw text`() {
        assertNotEquals(first.hash,first.copy(body=first.body.replace("\r\n","\n")).hash)
        assertNotEquals(first.hash,first.copy(versionId="later").hash)
        first.requireQuote(4,12,"길동은 떠났다.")
        assertThrows(IllegalArgumentException::class.java) { first.requireQuote(1,2,"\uDE00") }
        assertThrows(IllegalArgumentException::class.java) { first.requireQuote(4,12,"다른 인용문") }
    }

    @Test fun `first build does not accept duplicate episode or empty source set`() {
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildInput(emptyList()) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildInput(listOf(first,first)) }
        assertThrows(IllegalArgumentException::class.java) { ManuscriptBuildInput(listOf(second,first)) }
    }
}
