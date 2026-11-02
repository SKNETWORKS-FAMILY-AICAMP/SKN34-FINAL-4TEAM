package ai.storyfork.core.world.domain

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class InitialMinimalTest {
 @Test fun `history events allow additional culture topic but retain timeline category`() {
  val input=InitialInput("설정집","과거에 꿈을 꾸었다.")
  val event=InitialItem("r38","event","꿈","과거에 꿈을 꾸었다.",category="history",topics=listOf("history.past_event","culture.lifestyle"),evidence=listOf(InitialEvidence("description",input.description)))
  assertTrue(initialItemIssues(listOf(event),input).isEmpty())
  assertTrue(initialItemIssues(listOf(event.copy(category="culture")),input).isNotEmpty())
  assertTrue(initialItemIssues(listOf(event.copy(topics=listOf("history.past_event","invalid.topic"))),input).isNotEmpty())
 }
 @Test fun `unreported topics are reviewable unknown but cannot register`() {
  val input=InitialInput("설정집","아직 정리 중")
  val rows=initialTopics.keys.filter {it!="basic.name"}.map {InitialCoverage(it,"unknown")}
  val output=assembleInitialSemantic(input,emptyList(),rows,"{\"records\":[]}")
  assertTrue(inspectInitialOutput(output.items,output.coverage!!,input).issues.isEmpty())
  validateInitialReviewDisplay(output.items,output.coverage!!,input)
  assertThrows(IllegalArgumentException::class.java) {validateInitialCoverage(output.coverage!!,output.items,input)}
  assertEquals("unknown",output.coverage!!.first {it.topic=="society.law"}.status)
 }
 @Test fun `unknown cannot hide contradictory records or evidence`() {
  val input=InitialInput("설정집","아직 정리 중")
  val rows=initialTopics.keys.map {InitialCoverage(it,"unknown")}
  val inspection=inspectInitialOutput(input.directItems(),rows,input)
  assertTrue(inspection.issues.any {it.contains("basic.name")})
 }
}
