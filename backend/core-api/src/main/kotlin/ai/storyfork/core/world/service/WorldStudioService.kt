package ai.storyfork.core.world.service

import ai.storyfork.core.world.domain.*
import ai.storyfork.core.world.repository.WorldStudioStore
import ai.storyfork.core.world.client.InitialWorldClient
import ai.storyfork.core.world.client.exception.InitialValidationException
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

@Service
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class WorldStudioService(private val store:WorldStudioStore,private val client:InitialWorldClient,
 @param:Value("\${WORLD_STUDIO_AI_ENABLED:false}") private val aiEnabled:Boolean=false) {
 fun capabilities()=mapOf("aiEnabled" to aiEnabled)
 fun list(actor:String)=store.list(actor)
 fun read(actor:String,id:String)=store.read(actor,id) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND)
 private fun editable(actor:String,id:String,version:Int)=read(actor,id).also {
  require(it.version==version) {"다른 곳에서 변경되었습니다. 다시 열어 비교한 뒤 저장하세요."}
  require(it.analysis?.status!="running") {"AI 분석이 진행 중입니다. 완료 후 다시 저장하세요."}
 }
 private fun validate(name:String,description:String,settings:List<StudioSetting>) {
  require(name.isNotBlank() && name.length<=100 && description.length<=20000) {"세계관 이름은 필수이며 100자 이내입니다. 설명은 20,000자 이내로 입력하세요."}
  require(settings.size<=250 && settings.all {it.userCategory.isNotBlank() && it.userCategory.length<=50 && it.tags.size<=20 && it.tags.all {t->t.isNotBlank() && t.length<=50}}) {"항목 분류와 태그 길이를 확인하세요."}
  require(settings.all {it.item.decision=="approved"}) {"확정한 항목만 저장할 수 있습니다."}
  require(settings.all {it.item.title.isNotBlank() && (it.item.kind=="entity" || it.item.text.isNotBlank())}) {"모든 설정 항목에 이름과 내용을 입력해 주세요."}
  require(settings.none {it.item.kind=="relation" && it.item.subjectId==it.item.targetId}) {"관계 주체와 대상은 서로 다른 항목을 선택해 주세요."}
  // Approval retains source evidence; author edits are new explicit author statements.
  // Original author entries allow a name without a description. Validate their name as the source without rewriting stored text.
  val direct=settings.map {s->val text=s.item.text.ifBlank {if(s.item.kind=="entity") s.item.title else s.item.text};s.item.copy(text=text,origin="author_addition",authorText=text,evidence=emptyList(),orderEvidence=emptyList())}
  require(initialItemIssues(direct,InitialInput(name,description)).isEmpty()) {"설정의 종류·내용·연결 대상을 확인해 주세요."}
 }
 fun create(actor:String,name:String,description:String):StudioWorld=store.transaction {
  validate(name,description,emptyList());StudioWorld(UUID.randomUUID().toString(),name,description).also {store.insert(actor,it)}
 }
 fun save(actor:String,id:String,version:Int,name:String,description:String,settings:List<StudioSetting>):StudioWorld=store.transaction {
  val w=editable(actor,id,version)
  val authored=settings.map {s->if(w.settings.any {it.item==s.item}) s else s.copy(item=s.item.copy(origin="author_addition",authorText=s.item.text,evidence=emptyList(),orderEvidence=emptyList()))}
  validate(name,description,authored)
  // Explicit character/relation removal creates a revision; validation above rejects remaining dangling references.
  require(settings.map {it.item.id}.containsAll(w.settings.filter {it.item.kind!="relation" && !(it.item.kind=="entity" && it.item.entityType=="character")}.map {it.item.id})) {"인물과 관계 외의 기존 설정 항목은 삭제할 수 없습니다."}
  val relations=authored.map {it.item}.filter {it.kind=="relation"}
  for(r in relations.filter {next->w.settings.none {it.item==next}}) {
   require(relations.none {other->other.id!=r.id && other.predicate==r.predicate && other.polarity==r.polarity && (r.predicate !in setOf("custom_relation","custom_relation_directed","custom_emotion") || other.text==r.text) &&
    (other.subjectId==r.subjectId && other.targetId==r.targetId || r.predicate in setOf("custom_relation","friend_of","sibling_of","spouse_of") && other.subjectId==r.targetId && other.targetId==r.subjectId)}) {"같은 방향과 종류의 관계가 이미 있습니다."}
  }
  w.copy(name=name,description=description,settings=authored,version=w.version+1,analysis=null).also {store.save(actor,w.version,it)}
 }
 private fun input(w:StudioWorld):InitialInput {
  val entries=w.settings.filter {it.item.kind=="entity" && it.item.entityType in setOf("character","location")}.map {
   InitialEntry("author-"+UUID.nameUUIDFromBytes(it.item.id.toByteArray()),it.item.title,it.item.text,requireNotNull(it.item.entityType))
  }
  val description=(listOf(w.description)+w.settings.filter {it.item.kind!="entity" || it.item.entityType !in setOf("character","location")}.map {it.item.title+"\n"+it.item.text}).filter {it.isNotBlank()}.joinToString("\n\n")
  return InitialInput(w.name,description,entries=entries).also {it.validate()}.withTargets()
 }
 fun analyze(actor:String,id:String,version:Int,consent:Boolean):StudioWorld {
  require(aiEnabled && consent) {"AI 분석은 현재 꺼져 있거나 외부 처리 동의가 없습니다."}
  val begun=store.transaction {
   val w=editable(actor,id,version);val analysis=StudioAnalysis(UUID.randomUUID().toString(),"running",input(w))
   w.copy(version=w.version+1,analysis=analysis).also {store.save(actor,w.version,it)}
  }
  val run=requireNotNull(begun.analysis)
  var raw:String?=null
  val result=try {
   val output=client.analyze(run.input);raw=output.rawOutput
   val inspection=inspectInitialOutput(output.items,requireNotNull(output.coverage),run.input)
   require(inspection.issues.isEmpty()) {inspection.issues.joinToString("; ")}
   val ids=output.items.associate {item->
    val author=begun.settings.firstOrNull {"author-"+UUID.nameUUIDFromBytes(it.item.id.toByteArray())==item.id}
    item.id to (author?.item?.id ?: if(item.origin=="author_input") item.id else "ai-"+UUID.nameUUIDFromBytes((run.id+item.id).toByteArray()))
   }
   val candidates=output.items.map {item->item.copy(id=ids.getValue(item.id),subjectId=item.subjectId?.let {ids.getValue(it)},targetId=item.targetId?.let {ids.getValue(it)},afterId=item.afterId?.let {ids.getValue(it)},relatedIds=item.relatedIds.map {ids.getValue(it)},decision=if(item.origin=="author_input") "approved" else "pending")}
   run.copy(status="review",candidates=candidates,coverage=inspection.coverage.map {it.copy(itemIds=it.itemIds.map(ids::getValue))},rawOutput=raw)
  } catch(e:Exception) {
   val failure=e as? InitialValidationException
   run.copy(status="failed",issues=failure?.issues ?: listOf("분석 결과를 검증하지 못했습니다. 확정 설정은 유지됩니다. 입력과 연결 상태를 확인하세요."),rawOutput=failure?.rawOutput ?: raw)
  }
  return store.transaction {
   val current=read(actor,id)
   require(current.version==begun.version && current.analysis?.id==run.id) {"분석 기준이 변경되었습니다. 다시 열어 확인하세요."}
   current.copy(version=current.version+1,analysis=result).also {store.save(actor,current.version,it)}
  }
 }
 fun approve(actor:String,id:String,version:Int,ids:List<String>,edits:List<InitialItem> = emptyList()):StudioWorld=store.transaction {
  val w=editable(actor,id,version);val run=requireNotNull(w.analysis) {"검토할 후보가 없습니다."}
  require(run.status=="review" && ids.isNotEmpty() && ids.distinct().size==ids.size && ids.all {key->run.candidates.any {it.id==key}}) {"성공한 분석의 후보를 선택해 주세요."}
  require(ids.all {key->run.candidates.single {it.id==key}.decision!="approved"}) {"이미 확정한 후보입니다. 설정 작성에서 내용을 정정하세요."}
  require(edits.map {it.id}.distinct().size==edits.size && edits.all {it.id in ids})
  val candidates=run.candidates.map {c->edits.singleOrNull {it.id==c.id}?.copy(origin="author_addition",authorText=edits.single {it.id==c.id}.text,evidence=emptyList(),orderEvidence=emptyList(),decision="pending") ?: c}
  validateInitialItems(candidates,run.input)
  val selected=candidates.filter {it.id in ids}.map {it.copy(decision="approved")}
  require(selected.all {i->i.refs().all {ref->ref in ids || w.settings.any {it.item.id==ref}}}) {"연結先の項目も選択してください。"}
  require(selected.none {it.kind=="note" || it.kind=="undetermined"}) {"미해결 후보는 확정할 수 없습니다."}
  // Preserve author entries and IDs even when extraction returns its own seed projections.
  val next=w.settings+selected.filter {s->w.settings.none {it.item.id==s.id} && !(s.origin=="author_input" && (s.id=="author-world-name" || run.input.targets.any {it.id==s.id}))}.map {StudioSetting(it)}
  validate(w.name,w.description,next)
  w.copy(settings=next,version=w.version+1,analysis=run.copy(candidates=candidates.map {if(it.id in ids) it.copy(decision="approved") else it})).also {store.save(actor,w.version,it)}
 }
 fun history(actor:String,id:String):List<StudioWorld> {read(actor,id);return store.revisions(id)}
}
