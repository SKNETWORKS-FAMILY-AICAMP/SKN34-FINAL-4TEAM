package ai.storyfork.content.world

import ai.storyfork.content.world.service.InitialWorldInput
import ai.storyfork.content.world.service.InitialWorldOutputValidation
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode
import tools.jackson.module.kotlin.KotlinModule

class InitialWorldOutputTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val valid=mapper.readTree(requireNotNull(javaClass.getResource("/initial-world-contract/honggildong.json")))["valid"]
    private val input=mapper.treeToValue(valid["input"],InitialWorldInput::class.java)
    private val output=mapper.writeValueAsString(valid["output"])

    @Test fun `shared seven kinds validate without altering input`() {
        val before=mapper.writeValueAsString(input)
        val result=InitialWorldOutputValidation.parse(input,output)
        assertEquals(7,result.candidates.size)
        assertEquals(valid["output"],mapper.readTree(mapper.writeValueAsString(result)))
        assertEquals(before,mapper.writeValueAsString(input))
    }

    @Test fun `reject unknown entity invalid evidence duplicate and incomplete output`() {
        fun bad(change:(ObjectNode)->Unit) {
            val node=mapper.readTree(output) as ObjectNode
            change(node)
            assertThrows<IllegalArgumentException> { InitialWorldOutputValidation.parse(input,mapper.writeValueAsString(node)) }
        }
        bad { (it["candidates"][0] as ObjectNode).put("subjectId","00000000-0000-4000-8000-000000000099") }
        bad { (it["candidates"][0]["evidence"][0] as ObjectNode).put("quote","다른 원문") }
        bad { (it["candidates"][0]["evidence"][0] as ObjectNode).put("quoteHash","0".repeat(64)) }
        bad { (it["candidates"][0]["evidence"][0] as ObjectNode).put("start",Long.MAX_VALUE) }
        bad { (it["candidates"][1] as ObjectNode).put("localRef","c1") }
        bad { (it["candidates"][0] as ObjectNode).put("type","memory") }
        bad { (it["candidates"][0] as ObjectNode).put("provenance","author_revision") }
        bad { (it["candidates"][1]["relation"] as ObjectNode).put("targetCardId",it["candidates"][1]["relation"]["sourceCardId"].asString()) }
        bad { (it["candidates"][1]["relation"] as ObjectNode).put("direction","wrong") }
        bad { (it["candidates"][0] as ObjectNode).put("type","goal").putNull("subjectId") }
        bad { it.put("analysisId","unexpected model binding") }
        bad { (it["candidates"][0] as ObjectNode).remove("relation") }
        bad { (it["candidates"][0]["evidence"][0] as ObjectNode).put("start","78") }
        assertThrows<IllegalArgumentException> { InitialWorldOutputValidation.parse(input,"{") }
    }
}
