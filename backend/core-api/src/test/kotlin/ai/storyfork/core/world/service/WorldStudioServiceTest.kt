package ai.storyfork.core.world.service

import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.repository.WorldStudioStore
import ai.storyfork.core.world.client.InitialWorldClient
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.util.UUID

class WorldStudioServiceTest {
 private val ds=DriverManagerDataSource("jdbc:h2:mem:${UUID.randomUUID()};DB_CLOSE_DELAY=-1","sa","")
 private val store=WorldStudioStore(JdbcTemplate(ds),JsonMapper.builder().addModule(KotlinModule.Builder().build()).build(),TransactionTemplate(DataSourceTransactionManager(ds)))
 private val client=mock(InitialWorldClient::class.java)
 private val service=WorldStudioService(store,client,true)
 private fun setting(text:String="첫 줄 | 원문\n둘째 줄")=StudioSetting(InitialItem("stable-item","fact","항구의 법칙",text,origin="author_addition",authorText=text,decision="approved"),"설정",listOf("항구"))

 @Test fun directSavePreservesIdsTextAndImmutableVersionsWithoutAI() {
  val first=service.create("author","항구","")
  val saved=service.save("author",first.id,first.version,"항구","",listOf(setting()))
  val edited=service.save("author",first.id,saved.version,"항구","",listOf(setting("수정한 내용")))
  assertEquals("stable-item",service.read("author",first.id).settings.single().item.id)
  assertEquals("수정한 내용",edited.settings.single().item.text)
  assertEquals("첫 줄 | 원문\n둘째 줄",store.revisions(first.id)[1].settings.single().item.text)
  assertThrows(IllegalArgumentException::class.java) {service.save("author",first.id,saved.version,"항구","",emptyList())}
  assertEquals(edited,service.read("author",first.id))
  verifyNoInteractions(client)
 }
 @Test fun directlyAuthoredCharactersAndPlacesMayHaveEmptyDescriptions() {
  val w=service.create("author","인물과 장소","")
  val rows=listOf("character" to "basic","location" to "space").mapIndexed {n,(type,area)->
   StudioSetting(InitialItem("entity-$n","entity","이름 $n","",entityType=type,category=area,origin="author_addition",authorText="",decision="approved"),"사용자 분류",listOf("태그"))
  }
  val saved=service.save("author",w.id,w.version,w.name,"",rows)
  assertEquals(rows,service.read("author",w.id).settings)
  assertEquals(2,saved.version)
  verifyNoInteractions(client)
 }
 @Test fun failedAnalysisAndInvalidSavePreserveConfirmedData() {
  val first=service.create("author","항구","원문")
  val saved=service.save("author",first.id,first.version,"항구","원문",listOf(setting()))
  doThrow(ai.storyfork.core.world.client.exception.InitialValidationException("raw-invalid",emptyMap(),listOf(mapOf("record_id" to "r1","field" to "evidence","code" to "invalid_reference","cause" to "근거가 없습니다")))).`when`(client).analyze(InitialInput("항구","원문\n\n항구의 법칙\n첫 줄 | 원문\n둘째 줄",entries=emptyList()))
  val failed=service.analyze("author",first.id,saved.version,true)
  assertEquals("failed",failed.analysis!!.status)
  assertEquals("raw-invalid",failed.analysis!!.rawOutput)
  assertTrue(failed.analysis!!.issues.single().contains("invalid_reference"))
  assertEquals(saved.settings,failed.settings)
  assertThrows(IllegalArgumentException::class.java) {service.approve("author",first.id,failed.version,listOf("missing"))}
  assertThrows(IllegalArgumentException::class.java) {service.save("author",first.id,failed.version,"항구","",listOf(setting("")))}
  assertEquals(saved.settings,service.read("author",first.id).settings)
 }
 @Test fun ownerBoundaryDoesNotExposePrivateWorlds() {
  val world=service.create("author","비밀","")
  assertTrue(service.list("reader1").isEmpty())
  assertThrows(org.springframework.web.server.ResponseStatusException::class.java) {service.read("reader1",world.id)}
 }
 @Test fun restartMarksInterruptedAnalysisFailedWithoutChangingSettingsOrCallingAI() {
  val first=service.create("author","항구","원문")
  val saved=service.save("author",first.id,first.version,first.name,first.description,listOf(setting()))
  store.transaction {store.save("author",saved.version,saved.copy(version=saved.version+1,analysis=StudioAnalysis("interrupted","running",InitialInput("항구","원문"))))}
  val restarted=WorldStudioStore(JdbcTemplate(ds),JsonMapper.builder().addModule(KotlinModule.Builder().build()).build(),TransactionTemplate(DataSourceTransactionManager(ds)))
  val read=restarted.read("author",first.id)!!
  assertEquals("failed",read.analysis!!.status)
  assertEquals(saved.settings,read.settings)
  verifyNoInteractions(client)
 }
 @Test fun directWritesCannotPretendToBeAiApprovals() {
  val world=service.create("author","항구","")
  val forged=setting().let {it.copy(item=it.item.copy(origin="extraction",authorText=null,evidence=listOf(InitialEvidence("name","만들어 낸 근거"))))}
  val saved=service.save("author",world.id,world.version,world.name,"",listOf(forged))
  assertEquals("author_addition",saved.settings.single().item.origin)
  assertEquals(saved.settings.single().item.text,saved.settings.single().item.authorText)
  assertTrue(saved.settings.single().item.evidence.isEmpty())
  verifyNoInteractions(client)
 }
 @Test fun successfulCandidatesRequireExplicitApprovalAndKeepAuthorLabels() {
  val first=service.create("author","항구","과거에 등대가 세워졌다.")
  val saved=service.save("author",first.id,first.version,first.name,first.description,listOf(setting()))
  val input=InitialInput(first.name,"과거에 등대가 세워졌다.\n\n항구의 법칙\n첫 줄 | 원문\n둘째 줄",entries=emptyList()).withTargets()
  val candidate=InitialItem("r1","event","등대 건립","과거에 등대가 세워졌다.",category="history",topics=listOf("history.past_event"),evidence=listOf(InitialEvidence("description","과거에 등대가 세워졌다.")))
  val items=input.directItems()+candidate
  val coverage=initialTopics.keys.map {topic->val linked=items.filter {topic in it.topics};InitialCoverage(topic,if(linked.isEmpty()) "not_provided" else "present",linked.map {it.id},linked.flatMap {it.evidence})}
  doReturn(InitialExtraction(items,"fixture",coverage=coverage)).`when`(client).analyze(input)
  val reviewed=service.analyze("author",first.id,saved.version,true)
  assertEquals("review",reviewed.analysis!!.status)
  assertEquals(saved.settings,reviewed.settings)
  val id=reviewed.analysis!!.candidates.single {it.kind=="event"}.id
  val approved=service.approve("author",first.id,reviewed.version,listOf(id))
  assertEquals(saved.settings.first(),approved.settings.first())
  assertEquals(2,approved.settings.size)
  assertEquals("approved",approved.settings.last().item.decision)
  assertThrows(IllegalArgumentException::class.java) {service.approve("author",first.id,approved.version,listOf(id))}
 }
}
