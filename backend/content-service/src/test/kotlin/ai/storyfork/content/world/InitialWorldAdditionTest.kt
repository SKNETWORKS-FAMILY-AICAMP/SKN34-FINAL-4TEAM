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
    @Test fun `approved additions count only active cards against ten thousand`() {
        val candidate=output.candidates.first { it.type!="relation" }
        val decision=InitialWorldDecisionRecord(UUID.randomUUID(),candidate.localRef,1,"approved",candidate)
        val additionId=UUID.randomUUID()
        val cards=(1..9999).map { CardPayload(UUID.randomUUID(),"기존","원문","other","basic") }
        val removed=CardPayload(UUID.randomUUID(),"삭제","원문","other","basic",lifecycle="removed")
        val draft=WorldDraftResponse(input.worldId,1,null,null,"원본","",cards+removed,emptyList())
        fun build(value:WorldDraftResponse)=InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),value,listOf(decision),mapOf(decision.candidateId to additionId))
        assertEquals(additionId,assertDoesNotThrow<EditWorldDraftRequest> { build(draft) }.cards.single().id)
        val full=draft.copy(cards=cards+removed.copy(lifecycle="active"))
        val error=assertThrows(IllegalArgumentException::class.java) { build(full) }
        assertEquals("설정 카드는 10,000개까지 저장할 수 있습니다.",error.message)
        assertEquals("원문",full.cards.first().body)
        assertThrows(IllegalArgumentException::class.java) {
            InitialWorldAdditionMapper.build(input.analysisId,UUID.randomUUID(),draft,listOf(decision),mapOf(decision.candidateId to cards.first().id))
        }
    }
    @Test fun `seven approved kinds append existing references without generating entity copies`() {
        val decisions=output.candidates.map { InitialWorldDecisionRecord(UUID.randomUUID(),it.localRef,1,"approved",it) }
        val ids=decisions.associate { it.candidateId to UUID.randomUUID() }
        val draft=WorldDraftResponse(input.worldId,input.basis.draftRevision,null,null,"원본","설명",input.entities.map { CardPayload(it.cardId,it.name,"원문",it.entityType,"basic") },emptyList(),input.basis.relationshipVersion)
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
        val draft=WorldDraftResponse(input.worldId,1,null,null,"원본","",input.entities.map { CardPayload(it.cardId,it.name,"원문",it.entityType,"basic") },emptyList())
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
    @Test fun `application DTOs preserve the shared contract fixture`() {
        val request=mapper.treeToValue(fixture["applicationRequest"],InitialWorldApplicationRequest::class.java)
        val response=mapper.treeToValue(fixture["applicationResponse"],InitialWorldApplicationResponse::class.java)
        assertEquals(fixture["applicationRequest"],mapper.readTree(mapper.writeValueAsString(request)))
        assertEquals(fixture["applicationResponse"],mapper.readTree(mapper.writeValueAsString(response)))
    }
}
