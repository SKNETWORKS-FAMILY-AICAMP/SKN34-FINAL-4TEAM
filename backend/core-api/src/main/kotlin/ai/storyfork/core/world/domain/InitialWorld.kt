package ai.storyfork.core.world.domain

data class InitialTarget(val id:String,val name:String,val kind:String,val sourceId:String,val quote:String)
data class InitialEntry(val id:String,val name:String,val description:String="",val kind:String)
data class InitialInput(val name:String,val description:String,val characters:String="",val locations:String="",
 @get:com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_EMPTY)
 val targets:List<InitialTarget> = emptyList(),
 @get:com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
 val entries:List<InitialEntry>?=null) {
 fun sources():Map<String,String> = buildMap {
  putAll(mapOf("name" to name,"description" to description,"characters" to characters,"locations" to locations))
  this@InitialInput.entries.orEmpty().forEach {put("${it.id}:name",it.name);put("${it.id}:description",it.description)}
 }
 // Only explicit name | introduction entries are recognized; free prose remains untouched.
 fun withTargets(previous:InitialInput?=null):InitialInput {
  if(entries!=null) {
   require(entries.size<=100 && entries.map {it.id}.distinct().size==entries.size) {"대상 항목 수 또는 중복 ID를 확인하세요."}
   val populated=entries.filter {it.name.isNotBlank() || it.description.isNotBlank()}
   populated.forEach {require(it.name.isNotBlank() && it.name.length<=100 && it.description.length<=3000 && it.kind in setOf("character","location") && it.id.matches(Regex("author-[A-Za-z0-9-]{1,80}"))) {"대상 이름과 설명을 확인하세요. 이름은 필수입니다."}}
   return copy(entries=populated,targets=populated.map {InitialTarget(it.id,it.name,it.kind,"${it.id}:"+if(it.description.isNotBlank()) "description" else "name",it.description.ifBlank {it.name})})
  }
  require(targets.size<=100 && targets.map {it.id}.distinct().size==targets.size)
  val previousIds=previous?.targets?.map {it.id}?.toSet() ?: emptySet()
  val available=(targets.filter {it.id in previousIds}+(previous?.targets ?: emptyList())).distinctBy {it.id}.toMutableList()
  val found=mutableListOf<InitialTarget>()
  for((source,kind) in listOf("characters" to "character","locations" to "location")) {
   val text=sources().getValue(source)
   val starts=Regex("(?m)^[^|\\r\\n]+\\|").findAll(text).map {it.range.first}.toList()
   for((index,start) in starts.withIndex()) {
    val line=text.substring(start,starts.getOrElse(index+1){text.length}).trimEnd('\r','\n')
    val label=line.substringBefore('|').trim()
    if(label.isBlank()) continue
    require(label.length<=100 && line.length<=3000) {"대상 이름과 소개 길이를 확인하세요."}
    val old=available.firstOrNull {it.sourceId==source && it.kind==kind && it.name==label && it.quote==line}
    if(old!=null) available.remove(old)
    found.add(old ?: InitialTarget("author-"+java.util.UUID.randomUUID(),label,kind,source,line))
   }
  }
  require(found.size<=100)
  return copy(targets=found)
 }
 fun directItems():List<InitialItem> = listOf(InitialItem("author-world-name","fact","세계관 이름",name,
  evidence=listOf(InitialEvidence("name",name)),origin="author_input",topics=listOf("basic.name"))) + targets.map {
   InitialItem(it.id,"entity",it.name,it.quote,entityType=it.kind,evidence=(if(entries!=null) listOf(InitialEvidence("${it.id}:name",it.name)) else emptyList())+listOf(InitialEvidence(it.sourceId,it.quote)).filterNot {entries!=null && it.sourceId.endsWith(":name")},origin="author_input",category=if(it.kind=="location") "space" else "basic")
  }
 fun targetReferences():List<Map<String,Any>> {
  val offsets=mutableMapOf<String,Int>()
  return targets.map { t->
   val start=sources().getValue(t.sourceId).indexOf(t.quote,offsets[t.sourceId] ?: 0)
   require(start>=0);offsets[t.sourceId]=start+t.quote.length
   // JSON offsets are Unicode code points, matching the Python service rather than UTF-16.
   val source=sources().getValue(t.sourceId)
   mapOf("id" to t.id,"name" to t.name,"kind" to t.kind,"sourceId" to t.sourceId,
    "start" to source.codePointCount(0,start),"end" to source.codePointCount(0,start+t.quote.length))
  }
 }
 fun validate() { require(name.isNotBlank() && name.length<=100 && description.isNotBlank() && description.length<=20000 && characters.length<=5000 && locations.length<=5000) { "이름과 설정 설명을 입력하고 길이를 확인하세요." } }
}
data class InitialEvidence(val sourceId:String,val quote:String)
data class InitialItem(val id:String,val kind:String,val title:String,val text:String,val entityType:String?=null,
 val subjectId:String?=null,val targetId:String?=null,val predicate:String?=null,val polarity:String="asserted",
 val relatedIds:List<String> = emptyList(),val condition:String="",val timeText:String="",val afterId:String?=null,
 val orderEvidence:List<InitialEvidence> = emptyList(),val evidence:List<InitialEvidence> = emptyList(),
 val origin:String="extraction",val authorText:String?=null,val decision:String="pending",val category:String="basic",val topics:List<String> = emptyList()) {
 fun refs()=(listOfNotNull(subjectId,targetId,afterId)+relatedIds).distinct()
}
data class InitialDraft(val id:String,val owner:String,val input:InitialInput,val version:Int=1,val status:String="draft",
 val activeRunId:String?=null,val registerKey:String?=null,val registeredVersion:Int?=null)
data class InitialRun(val id:String,val draftId:String,val input:InitialInput,val inputHash:String,val requestKey:String,
 val mode:String,val status:String="running",val rawOutput:String?=null,val usage:Map<String,Any> = emptyMap(),val error:String?=null,val coverage:List<InitialCoverage>?=null,
 val sourceRunId:String?=null,val sourceAuditId:String?=null,val rawHash:String?=null,
 val linkChanges:List<InitialLinkChange> = emptyList(),val validationIssues:List<String> = emptyList(),
 val reviewedCoverage:List<InitialCoverage>?=null,val coverageReviews:List<InitialCoverageReview> = emptyList(),val contentReviewed:Boolean=false)
data class InitialReview(val itemId:String,val action:String,val before:InitialItem?,val after:InitialItem,val at:String)
data class InitialView(val draft:InitialDraft,val run:InitialRun?,val items:List<InitialItem>,val history:List<InitialReview>,val issues:List<String>,val stale:Boolean)
data class InitialExtraction(val items:List<InitialItem>,val rawOutput:String,val usage:Map<String,Any> = emptyMap(),val coverage:List<InitialCoverage>?=null)

fun assembleInitialSemantic(input:InitialInput,items:List<InitialItem>,rows:List<InitialCoverage>,raw:String,usage:Map<String,Any> = emptyMap()):InitialExtraction {
 val seeds=input.directItems();val ids=seeds.map {it.id}.toSet()
 require(items.none {it.id in ids || "basic.name" in it.topics}) {"모델이 직접 입력한 항목을 다시 생성했습니다."}
 require(rows.size==26 && rows.map {it.topic}.toSet()==initialTopics.keys-"basic.name" && rows.all {it.itemIds.isEmpty()}) {"모델은 의미 판단만 반환해야 합니다."}
 val all=seeds+items.map {it.copy(origin="extraction",decision="pending",authorText=null)}
 val coverage=rows.map {r->r.copy(itemIds=all.filter {r.topic in it.topics}.map {it.id})}+
  InitialCoverage("basic.name","present",listOf("author-world-name"),listOf(InitialEvidence("name",input.name)))
 return InitialExtraction(all,raw,usage,coverage)
}

val initialRelationLabels=mapOf("sibling_of" to "남매·형제자매", "child_of" to "자녀", "spouse_of" to "배우자", "trusts" to "신뢰", "hostile_to" to "적대", "member_of" to "소속", "leads" to "이끎", "can_use" to "사용 가능", "located_in" to "위치")
fun validateInitialItems(items:List<InitialItem>,input:InitialInput) {
 val issues=initialItemIssues(items,input);require(issues.isEmpty()) {issues.joinToString("; ")}
}
fun initialItemIssues(items:List<InitialItem>,input:InitialInput,reviewDisplay:Boolean=false):List<String> {
 val issues=mutableListOf<String>();var context="items"
 fun check(ok:Boolean,message:()->Any={"필드 계약을 확인하세요."}) {if(!ok) issues.add("$context: ${message()}")}

 check(items.size<=250 && items.map { it.id }.distinct().size==items.size) { "중복 항목 또는 항목 수 초과" }
 val byId=items.associateBy { it.id };val sources=input.sources()
 for(i in items) {
  context=i.id
  check(i.id.isNotBlank() && i.id.length<=100 && i.title.isNotBlank() && i.title.length<=200 && i.text.isNotBlank() && i.text.length<=3000)
  check(i.kind in setOf("entity","fact","rule","constraint","claim","relation","undetermined","event","note"))
  check(i.category in setOf("basic","space","history","society","culture","special","conflict"))
  check(i.topics.distinct().size==i.topics.size && i.topics.all {it in initialTopics}) { "잘못된 세부 내용 항목입니다." }
  check(i.topics.isEmpty() || i.topics.any {it.substringBefore('.')==i.category}) { "내용 항목과 주 분류가 다릅니다." }
  check(i.kind!="note" || i.topics.isEmpty()) { "집필 계획은 초기 설정 내용을 대신하지 않습니다." }
  if(i.kind=="event") check(i.category=="history") { "시간선은 초기 역사 사건만 표시합니다." }
  check(i.decision in setOf("pending","approved","held","rejected"))
  check(i.polarity in setOf("asserted","denied"))
  check(i.refs().all { it in byId }) { "참조하는 항목을 찾을 수 없습니다: ${i.title}" }
  check((listOfNotNull(i.subjectId,i.targetId)+i.relatedIds).all { byId[it]?.kind=="entity" })
  check(i.relatedIds.distinct().size==i.relatedIds.size)
  if(i.origin=="author_addition") {
   check(!i.authorText.isNullOrBlank() && i.authorText.length<=5000 && i.evidence.isEmpty() && i.orderEvidence.isEmpty()) { "새 설정은 별도 작가 입력을 출처로 사용합니다." }
  } else {
   check(i.origin in setOf("extraction","correction","author_input") && i.authorText==null && i.evidence.isNotEmpty())
   check((i.evidence+i.orderEvidence).all { it.quote.isNotBlank() && sources[it.sourceId]?.contains(it.quote)==true }) { "분석 당시 입력에 없는 근거입니다: ${i.title}" }
  }
  if(i.kind=="entity") check(i.entityType in setOf("character","location","organization","ability")) else check(i.entityType==null)
  if(i.kind=="relation") {
   check(i.predicate in initialRelationLabels && i.subjectId!=null && i.targetId!=null && i.subjectId!=i.targetId)
   val pair=byId[i.subjectId]?.entityType to byId[i.targetId]?.entityType
   val valid=when(i.predicate) {
    "sibling_of","child_of","spouse_of","trusts","hostile_to" -> pair==("character" to "character")
    "member_of","leads" -> pair==("character" to "organization")
    "can_use" -> pair==("character" to "ability")
    "located_in" -> pair.first in setOf("character","location","organization") && pair.second=="location"
    else -> false
   };check(valid) { "관계의 대상 종류가 맞지 않습니다." }
   check(i.condition.isEmpty()) { "조건부 관계는 조건을 보존한 제약 항목으로 저장하세요." }
  } else check(i.predicate==null)
  if(i.kind=="claim" && !reviewDisplay) check(byId[i.subjectId]?.entityType=="character") { "주장의 발언자를 확인하세요. 인물 발언이 아닌 서술이라면 설정으로 정정하세요." }
  if(i.kind!="event") check(i.timeText.isEmpty() && i.afterId==null && i.orderEvidence.isEmpty())
  if(i.afterId!=null) check(i.kind=="event" && i.afterId!=i.id && byId[i.afterId]?.kind=="event" && (i.origin=="author_addition" || i.orderEvidence.isNotEmpty())) { "사건 순서에는 명시적인 근거가 필요합니다." }
 }
 for(i in items.filter { it.kind=="event" }) {
  val seen=mutableSetOf(i.id);var next=i.afterId
  while(next!=null) {if(!seen.add(next)) {issues.add("${i.id}: 사건 순서가 순환합니다.");break};next=byId[next]?.afterId}
 }
 return issues.distinct()
}

val initialTopics=mapOf(
 "basic.name" to "세계관 이름",
 "basic.genre" to "장르",
 "basic.era" to "시대",
 "basic.background" to "배경",
 "basic.concept" to "핵심 콘셉트",
 "space.country" to "국가",
 "space.region" to "지역",
 "space.city" to "도시",
 "space.place" to "주요 장소",
 "space.time_structure" to "시간 구조",
 "history.past_event" to "주요 과거 사건",
 "history.chronology" to "연대기",
 "history.background" to "역사적 배경",
 "society.politics" to "정치",
 "society.economy" to "경제",
 "society.law" to "법률",
 "society.class" to "사회계층",
 "society.organization" to "주요 조직",
 "culture.lifestyle" to "생활양식",
 "culture.religion" to "종교",
 "culture.technology" to "기술 수준",
 "special.law" to "세계 고유 법칙",
 "special.condition" to "조건",
 "special.constraint" to "제약",
 "conflict.factions" to "세력 대립",
 "conflict.social_issue" to "사회 문제",
 "conflict.threat" to "세계의 위협"
)
data class InitialCoverage(val topic:String,val status:String,val itemIds:List<String> = emptyList(),val evidence:List<InitialEvidence> = emptyList())
fun validateInitialCoverage(rows:List<InitialCoverage>,items:List<InitialItem>,input:InitialInput) {
 require(rows.size==initialTopics.size && rows.map {it.topic}.toSet()==initialTopics.keys) { "27개 세부 내용 점검이 필요합니다." }
 val byId=items.associateBy {it.id}
 for(r in rows) {
  require(r.status in setOf("present","not_provided"))
  val linked=items.filter {r.topic in it.topics}.map {it.id}.toSet()
  if(r.status=="not_provided") require(r.itemIds.isEmpty() && r.evidence.isEmpty() && linked.isEmpty()) { "입력 없음과 연결 기록이 충돌합니다." }
  else {
   require(r.itemIds.isNotEmpty() && r.evidence.isNotEmpty()) { "입력에 있는 내용의 추출 기록이 누락됐습니다." }
   require(r.itemIds.distinct().size==r.itemIds.size && r.itemIds.toSet()==linked && r.itemIds.all {it in byId}) { "내용 점검의 연결 기록이 다릅니다." }
   require(r.evidence.all {it.quote.isNotBlank() && input.sources()[it.sourceId]?.contains(it.quote)==true}) { "내용 점검에 원문 근거가 필요합니다." }
  }
 }
}

data class InitialLinkChange(val topic:String,val before:List<String>,val after:List<String>,val added:List<String>)
data class InitialInspection(val coverage:List<InitialCoverage>,val changes:List<InitialLinkChange>,val issues:List<String>)
data class InitialCoverageReview(val before:List<InitialCoverage>,val after:List<InitialCoverage>,val reason:String,val at:String)
fun inspectInitialOutput(items:List<InitialItem>,rows:List<InitialCoverage>,input:InitialInput):InitialInspection {
 val issues=initialItemIssues(items,input).toMutableList();val byId=items.associateBy {it.id}
 if(rows.size!=initialTopics.size || rows.map {it.topic}.toSet()!=initialTopics.keys) issues.add("27개 세부 내용 점검이 필요합니다.")
 val changes=mutableListOf<InitialLinkChange>()
 val derived=rows.map {r->
  val linked=items.filter {r.topic in it.topics}.map {it.id}
  if(r.status !in setOf("present","not_provided","unknown")) issues.add("${r.topic}: 잘못된 입력 판단")
  if(r.status=="unknown" && (r.itemIds.isNotEmpty() || r.evidence.isNotEmpty() || linked.isNotEmpty())) issues.add("${r.topic}: 미확인과 연결 기록이 충돌합니다.")
  if(r.itemIds.distinct().size!=r.itemIds.size || r.itemIds.any {it !in byId || r.topic !in byId[it]!!.topics}) issues.add("${r.topic}: 존재하지 않거나 다른 주제의 참조")
  if(r.status=="not_provided" && (r.itemIds.isNotEmpty() || r.evidence.isNotEmpty() || linked.isNotEmpty())) issues.add("${r.topic}: 입력 없음과 기록이 충돌합니다.")
  if(r.status=="present" && (linked.isEmpty() || r.evidence.isEmpty())) issues.add("${r.topic}: 내용 또는 근거 누락")
  if(r.evidence.any {it.quote.isBlank() || input.sources()[it.sourceId]?.contains(it.quote)!=true}) issues.add("${r.topic}: 원문에 없는 근거")
  if(r.status=="present" && r.itemIds.toSet()!=linked.toSet()) changes.add(InitialLinkChange(r.topic,r.itemIds,linked,linked-r.itemIds.toSet()))
  r.copy(itemIds=if(r.status=="present") linked else r.itemIds)
 }
 return InitialInspection(derived,if(issues.isEmpty()) changes else emptyList(),issues.distinct())
}

// Display permits an unidentified speaker, never unidentified records or unverifiable evidence.
fun validateInitialReviewDisplay(items:List<InitialItem>,rows:List<InitialCoverage>,input:InitialInput) {
 val issues=initialItemIssues(items,input,reviewDisplay=true)
 require(issues.isEmpty()) {issues.joinToString("; ")}
 require(items.isNotEmpty() && rows.size==initialTopics.size && rows.map {it.topic}.toSet()==initialTopics.keys)
 val ids=items.map {it.id}.toSet()
 for(r in rows) {
  require(r.status in setOf("present","not_provided","unknown") && r.itemIds.all {it in ids}) {"내용 점검의 대상을 식별할 수 없습니다."}
  require(r.evidence.all {it.quote.isNotBlank() && input.sources()[it.sourceId]?.contains(it.quote)==true}) {"내용 점검의 원문 근거가 일치하지 않습니다."}
 }
}
