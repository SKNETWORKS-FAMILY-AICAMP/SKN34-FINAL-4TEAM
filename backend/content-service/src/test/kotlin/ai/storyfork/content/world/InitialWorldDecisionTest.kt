package ai.storyfork.content.world

import ai.storyfork.content.world.studio.entity.InitialWorldDecision
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class InitialWorldDecisionTest {
    private fun decision(action: String, provenance: String, evidence: List<Any> = emptyList(), sequence: Long = 1) =
        InitialWorldDecision(worldId=UUID.randomUUID(), analysisId=UUID.randomUUID(), candidateId=UUID.randomUUID(),
            sequence=sequence, action=action, actorId=UUID.randomUUID(),
            content=mapOf("provenance" to provenance, "evidence" to evidence))

    @Test fun `editing remains pending and cannot claim original AI evidence`() {
        assertEquals("pending", decision("edit", "author_revision").state)
        assertThrows(IllegalArgumentException::class.java) { decision("edit", "ai_extraction", listOf("quote")) }
        assertThrows(IllegalArgumentException::class.java) { decision("edit", "author_revision", listOf("quote")) }
    }

    @Test fun `review action maps to state without approving an edit implicitly`() {
        for ((action,state) in mapOf("approve" to "approved", "hold" to "held", "reject" to "rejected")) {
            assertEquals(state, decision(action,"ai_extraction",listOf("original evidence")).state)
        }
        assertThrows(IllegalArgumentException::class.java) { decision("publish","author_revision") }
        assertThrows(IllegalArgumentException::class.java) { decision("approve","author_revision",sequence=0) }
    }
}
