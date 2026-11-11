package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class InitialWorldAdditionTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val fixture=mapper.readTree(requireNotNull(javaClass.getResource("/initial-world-contract/honggildong.json")).readText())["valid"]
    private val input=mapper.treeToValue(fixture["input"],InitialWorldInput::class.java)
    private val output=InitialWorldOutputValidation.parse(input,mapper.writeValueAsString(fixture["output"]))
    @Test fun `seven approved kinds append existing references without generating entity copies`() {
        val decisions=output.candidates.map { InitialWorldDecisionRecord(UUID.randomUUID(),it.localRef,1,"approved",it) }
        val ids=decisions.associate { it.candidateId to UUID.randomUUID() }
        val draft=WorldDraftResponse(input.worldId,input.basis.draftRevision,null,null,"원본","설명",emptyList(),emptyList(),input.basis.relationshipVersion)
        val request=InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),draft,decisions,ids)
        assertFalse(request.replace);assertEquals(6,request.cards.size);assertEquals(1,request.relationships.size)
        assertTrue(request.cards.none { it.cardType in setOf("character","location","organization") })
        assertEquals(draft.name,request.name);assertEquals(draft.description,request.description)
        request.cards.forEach { card ->
            assertEquals("private",card.visibility);assertTrue(card.aliases.isEmpty() && card.tags.isEmpty())
            val metadata=card.semanticMetadata["preprocessing"] as Map<*,*>
            assertEquals(input.analysisId.toString(),metadata["analysisId"])
            assertEquals("ai_extraction",metadata["provenance"])
            assertEquals(input.basis.draftRevision,metadata["basisDraftRevision"])
        }
        val expected=output.candidates.single { it.type=="relation" }.relation!!
        assertEquals(expected.sourceCardId,request.relationships.single().sourceCardId)
        assertEquals(expected.targetCardId,request.relationships.single().targetCardId)
    }
    @Test fun `author revision has no copied AI evidence and duplicate relationships are rejected`() {
        val ai=output.candidates.first()
        val revised=ai.copy(text="작가가 새로 작성",provenance="author_revision",evidence=emptyList())
        val decision=InitialWorldDecisionRecord(UUID.randomUUID(),ai.localRef,3,"approved",revised)
        val draft=WorldDraftResponse(input.worldId,1,null,null,"원본","",emptyList(),emptyList())
        val result=InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),draft,listOf(decision),mapOf(decision.candidateId to UUID.randomUUID()))
        val metadata=result.cards.single().semanticMetadata["preprocessing"] as Map<*,*>
        assertEquals("author_revision",metadata["provenance"]);assertEquals(emptyList<Any>(),metadata["evidence"])
        val relation=output.candidates.single { it.type=="relation" }
        val row=InitialWorldDecisionRecord(UUID.randomUUID(),relation.localRef,1,"approved",relation)
        val added=InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),draft,listOf(row),mapOf(row.candidateId to UUID.randomUUID()))
        assertThrows(IllegalArgumentException::class.java) {
            InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),draft.copy(relationships=added.relationships),listOf(row),mapOf(row.candidateId to UUID.randomUUID()))
        }
    }
}
