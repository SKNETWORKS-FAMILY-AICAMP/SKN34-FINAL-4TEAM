package ai.storyfork.core.world.service

import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.repository.WorldStudioStore
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

@Service
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class WorldStudioService(private val store:WorldStudioStore) {
 fun list(actor:String)=store.list(actor)
 fun read(actor:String,id:String)=store.read(actor,id) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND)
 private fun validate(name:String,description:String,settings:List<StudioSetting>) {
  require(name.isNotBlank() && name.length<=100 && description.length<=20000) {"이름은 필수이며 100자 이내입니다. 설명은 20,000자 이내로 입력하세요."}
  require(settings.size<=250 && settings.map {it.item.id}.distinct().size==settings.size) {"설정 항목 수와 중복 ID를 확인하세요."}
  settings.forEach {s->
   require(s.item.id.isNotBlank() && s.item.id.length<=100 && s.item.title.isNotBlank() && s.item.title.length<=200 && (s.item.kind=="entity" || s.item.text.isNotBlank()) && s.item.text.length<=3000) {"항목 이름과 내용을 입력하고 길이를 확인하세요."}
   require(s.item.kind in setOf("entity","fact","note") && s.item.origin=="author_addition" && s.item.decision=="approved" && s.item.authorText==s.item.text) {"직접 작성한 설정만 확정 저장할 수 있습니다."}
   require(s.item.category in setOf("basic","space","history","society","culture","special","conflict") && s.item.topics.isEmpty()) {"직접 작성 분류를 확인하세요."}
   require(if(s.item.kind=="entity") s.item.entityType in setOf("character","location") else s.item.entityType==null) {"인물·장소 종류를 확인하세요."}
   require(s.userCategory.isNotBlank() && s.userCategory.length<=50 && s.tags.size<=20 && s.tags.all {it.isNotBlank() && it.length<=50}) {"분류와 태그를 확인하세요."}
  }
 }
 fun create(actor:String,name:String,description:String):StudioWorld=store.transaction {
  validate(name,description,emptyList());StudioWorld(UUID.randomUUID().toString(),name,description).also {store.insert(actor,it)}
 }
 fun save(actor:String,id:String,version:Int,name:String,description:String,settings:List<StudioSetting>):StudioWorld=store.transaction {
  val w=read(actor,id)
  require(w.version==version) {"다른 곳에서 변경되었습니다. 다시 열어 비교한 뒤 저장하세요."}
  validate(name,description,settings)
  require(settings.map {it.item.id}.containsAll(w.settings.map {it.item.id})) {"기존 항목은 삭제할 수 없습니다. 내용을 정정해 새 버전으로 저장하세요."}
  w.copy(name=name,description=description,settings=settings,version=w.version+1).also {store.save(actor,w.version,it)}
 }
 fun history(actor:String,id:String):List<StudioWorld> {read(actor,id);return store.revisions(id)}
}
