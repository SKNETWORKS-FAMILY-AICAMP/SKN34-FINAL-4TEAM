package ai.storyfork.content.world

import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class InitialWorldReviewTest {
    private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val fixture=mapper.readTree(requireNotNull(javaClass.getResource("/initial-world-contract/honggildong.json")).readText())["valid"]
    private val input=mapper.treeToValue(fixture["input"],InitialWorldInput::class.java)
    private val original=InitialWorldOutputValidation.parse(input,mapper.writeValueAsString(fixture["output"])).candidates.first()
    private fun request(action:String,edit:InitialWorldCandidateOutput?=null)=InitialWorldDecisionRequest("review",0,action,edit,"작가 의견😀")

    @Test fun `approve hold reject use latest content while edit removes AI evidence`() {
        val before=mapper.writeValueAsString(original)
        for(action in listOf("approve","hold","reject")) assertEquals(original,InitialWorldDecisionValidation.review(input,original,request(action)))
        val edited=original.copy(text="작가 수정",provenance="author_revision",evidence=emptyList())
        assertEquals(edited,InitialWorldDecisionValidation.review(input,original,request("edit",edited)))
        assertEquals(edited,InitialWorldDecisionValidation.review(input,edited,request("approve")))
        assertEquals(before,mapper.writeValueAsString(original))
    }
    @Test fun `reject forged provenance evidence references and invalid request`() {
        val edit=original.copy(provenance="author_revision",evidence=emptyList())
        for(bad in listOf(edit.copy(evidence=original.evidence),original,edit.copy(provenance="author_addition"),
            edit.copy(localRef="other"),edit.copy(subjectId=UUID.randomUUID()),edit.copy(type="goal",subjectId=null),
            edit.copy(type="unsupported"),edit.copy(type="relation",relation=null))) {
            assertThrows<IllegalArgumentException> { InitialWorldDecisionValidation.review(input,original,request("edit",bad)) }
        }
        for(bad in listOf(request("edit"),request("approve",edit),request("wrong"),request("hold").copy(key="bad/key"),
            request("hold").copy(expectedDecisionSequence=-1),request("hold").copy(comment="x".repeat(3001)))) {
            assertThrows<IllegalArgumentException> { InitialWorldDecisionValidation.review(input,original,bad) }
        }
    }
}
