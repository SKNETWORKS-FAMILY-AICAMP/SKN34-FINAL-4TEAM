package ai.storyfork.core.world.service
import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.repository.WorldStudioStore
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.util.UUID

class WorldStudioServiceTest {
 private val ds=DriverManagerDataSource("jdbc:h2:mem:${UUID.randomUUID()};DB_CLOSE_DELAY=-1","sa","")
 private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
 private val store=WorldStudioStore(JdbcTemplate(ds),mapper,TransactionTemplate(DataSourceTransactionManager(ds)))
 private val service=WorldStudioService(store)
 private fun setting(text:String="첫 줄 | 그대로\n둘째 줄")=StudioSetting(AuthorSetting("stable-id","항구 법칙",text),"설정",listOf("항구"))
 @Test fun directSaveKeepsIdTextAndImmutableRevisions() {
  val w=service.create("author","항구","")
  val s=service.save("author",w.id,w.version,w.name,"",listOf(setting()))
  val edited=service.save("author",w.id,s.version,w.name,"",listOf(setting("수정 원문")))
  assertEquals("stable-id",service.read("author",w.id).settings.single().item.id)
  assertEquals("수정 원문",edited.settings.single().item.text)
  assertEquals("첫 줄 | 그대로\n둘째 줄",store.revisions(w.id)[1].settings.single().item.text)
  assertEquals(edited,WorldStudioStore(JdbcTemplate(ds),mapper,TransactionTemplate(DataSourceTransactionManager(ds))).read("author",w.id))
 }
 @Test fun charactersAndPlacesSurviveSaveEditAndRepositoryReload() {
  val w=service.create("author","메뉴 검증","")
  val rows=listOf("character" to "basic","location" to "space").mapIndexed {n,(entity,area)->
   StudioSetting(mapper.convertValue(mapOf("id" to "menu-$n","title" to "항목 $n","text" to "", "kind" to "entity", "entityType" to entity,"category" to area),AuthorSetting::class.java),"나의 분류",listOf("태그"))
  }
  val saved=service.save("author",w.id,w.version,w.name,"",rows)
  val updated=rows.map {it.copy(item=it.item.copy(text="수정 | 원문\n다음 줄",authorText="수정 | 원문\n다음 줄"))}
  val edited=service.save("author",w.id,saved.version,w.name,"",updated)
  val reopened=WorldStudioStore(JdbcTemplate(ds),mapper,TransactionTemplate(DataSourceTransactionManager(ds))).read("author",w.id)!!
  assertEquals(edited,reopened)
  reopened.settings.forEachIndexed {n,s->assertEquals("menu-$n",s.item.id);assertEquals(updated[n],s)}
  assertTrue(mapper.writeValueAsString(reopened).contains("entityType"))
 }
 @Test fun staleVersionAndInvalidInputKeepConfirmedData() {
  val w=service.create("author","항구","")
  val saved=service.save("author",w.id,w.version,w.name,"",listOf(setting()))
  assertThrows(IllegalArgumentException::class.java) {service.save("author",w.id,w.version,w.name,"",emptyList())}
  assertThrows(IllegalArgumentException::class.java) {service.save("author",w.id,saved.version,w.name,"",listOf(setting("")))}
  assertEquals(saved,service.read("author",w.id))
 }
 @Test fun privateWorldsAreOwnedAndCannotBeReadOrEditedByOtherActor() {
  val w=service.create("author","비밀","")
  assertTrue(service.list("reader1").isEmpty())
  assertThrows(org.springframework.web.server.ResponseStatusException::class.java) {service.read("reader1",w.id)}
  assertThrows(org.springframework.web.server.ResponseStatusException::class.java) {service.save("reader1",w.id,w.version,"타인 변경","",emptyList())}
  assertEquals(w,service.read("author",w.id))
 }
}
