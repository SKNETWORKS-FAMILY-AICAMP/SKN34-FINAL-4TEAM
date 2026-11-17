package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class ManuscriptExtractionVerifierTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private fun row()=mapper.readTree(checkNotNull(javaClass.getResourceAsStream("/initial-build/ai-result.json"))).path("extractions").get(0)
    private fun source()=row().let { ManuscriptBuildSource(1,"episode-1","version-1",it.path("title").asString(),it.path("source").asString()) }
    @Test fun `valid source evidence and IDs produce a version bound persisted envelope`() {
        val result=ManuscriptExtractionVerifier.verify(source(),row(),mapper)
        assertEquals(source().hash,result.basis.sourceHash)
        assertTrue(result.evidence.isNotEmpty())
    }
    @Test fun `altered original quote hash and entity references are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source().copy(body="다른 원고"),row(),mapper) }
        val raw=row().toString()
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source(),mapper.readTree(raw.replace("\"m1\"","\"missing\"",ignoreCase=false).replace("\"id\":\"missing\"","\"id\":\"m1\"")),mapper) }
        val quoteHash=row().path("evidence").get(0).path("quoteHash").asString()
        assertThrows(IllegalArgumentException::class.java) { ManuscriptExtractionVerifier.verify(source(),mapper.readTree(raw.replace(quoteHash,"0".repeat(64))),mapper) }
    }
}
