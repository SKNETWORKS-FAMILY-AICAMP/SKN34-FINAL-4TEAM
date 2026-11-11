package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.helper.RelationshipInputHelper
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import ai.storyfork.content.world.service.dto.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** PostgreSQL은 권한·카드·버전을, Neo4j는 관계의 현재 상태 하나만 소유한다. 네트워크 호출은 PG transaction 밖이다. */
@Service
class WorldStudioService(
    private val worlds:StudioWorldRepository,private val drafts:WorldDraftRepository,
    private val cards:SettingCardRepository,private val cardDrafts:SettingCardDraftRepository,
    private val cardVersions:SettingCardVersionRepository,private val revisions:WorldRevisionRepository,
    private val revisionCards:WorldRevisionCardRepository,private val requests:WorldSaveRequestRepository,
    private val states:WorldRelationshipStateRepository,private val applications:InitialWorldApplicationRepository,private val graph:Neo4jRelationshipRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,private val mapper:JsonMapper,
) {
    private val transaction=TransactionTemplate(manager)
    private fun <T:Any> tx(action:()->T):T=transaction.execute { action() }
    private fun owned(id:UUID,subject:UUID)=worlds.lockOwned(id,subject) ?: throw WorldNotFound()
    private fun draft(id:UUID)=drafts.findById(id).orElseThrow { WorldNotFound() }
    private fun state(id:UUID)=states.findById(id).orElseThrow { WorldStudioFailure.migration() }
    private fun expected(draft:WorldDraft,revision:Long,unprepared:Boolean=false) { if(draft.draftRevision!=revision) throw if(unprepared) WorldStudioFailure.rejected() else WorldConflict() }
    private fun ready(state:WorldRelationshipState) { if(!state.completed) throw WorldStudioFailure.incomplete() }

    fun list(subject:UUID):List<WorldStudioSummaryResponse> = tx {
        worlds.findAllByOwnerSubjectOrderByCreatedAtDesc(subject).map { world ->
            val draft=draft(world.id);val state=states.findById(world.id).orElse(null)
            WorldStudioSummaryResponse(world.id,draft.name,draft.description,draft.draftRevision,
                if(state==null) "migration_required" else if(!state.completed) "incomplete" else "current")
        }
    }

    fun create(subject:UUID,request:CreateWorldRequest):WorldDraftResponse {
        validateName(request.name,request.description)
        val hash=hash("create",request.id,request);val key=request.id.toString()
        val complete=tx {
            val existing=worlds.findById(request.id).orElse(null)
            if(existing!=null) {
                owned(request.id,subject)
                val state=state(request.id)
                if(state.creationHash!=hash) throw WorldConflict()
                if(!state.completed && (state.requestKey!=key || state.requestHash!=hash)) throw WorldStudioFailure.incomplete()
                state.completed
            } else {
                worlds.saveAndFlush(StudioWorld(id=request.id,ownerSubject=subject))
                drafts.saveAndFlush(WorldDraft(worldId=request.id,name=request.name,description=request.description))
                states.saveAndFlush(WorldRelationshipState(request.id,creationHash=hash,requestKey=key,requestHash=hash))
                false
            }
        }
        if(!complete) {
            val stored=graph.replace(request.id,-1,key,hash,emptyList())
            tx {
                owned(request.id,subject);val state=state(request.id)
                if(state.requestKey!=key || state.requestHash!=hash || stored.worldId!=request.id || stored.version!=0L || stored.key!=key || stored.hash!=hash) throw WorldConflict()
                state.graphVersion=0;state.completed=true;states.flush()
            }
        }
        return draft(request.id,subject)
    }

    fun draft(worldId:UUID,subject:UUID):WorldDraftResponse {
        val loaded=tx { val world=owned(worldId,subject);val state=state(worldId);ready(state);readDraft(world,state) }
        val stored=graph.read(worldId)
        if(stored.worldId!=worldId || stored.version!=loaded.relationshipVersion) throw WorldStudioFailure.mismatch()
        try { RelationshipInputHelper.merge(emptyList(),stored.relationships,true,loaded.cards.filter { it.lifecycle=="active" }.map { it.id }.toSet()) }
        catch(_:IllegalArgumentException) { throw WorldStudioFailure.mismatch() }
        // Detect a prepare/finalize that raced the network read; never pair another card draft with this graph.
        tx {
            owned(worldId,subject);val state=state(worldId);ready(state)
            if(state.graphVersion!=stored.version || draft(worldId).draftRevision!=loaded.draftRevision) throw WorldStudioFailure.mismatch()
        }
        return loaded.copy(relationships=stored.relationships)
    }

    /** 소유한 저장 초안을 읽어 입력 원문과 현재 관계 기준을 고정한다. */
    internal fun prepareInitialWorldInput(worldId:UUID,subject:UUID,analysisId:UUID):InitialWorldInput =
        InitialWorldInput.fromDraft(draft(worldId,subject),analysisId)

    /** 외부 호출 없이 잠금 안에서 검증하며, 콜백은 인자로 받은 새 스냅샷만 사용해야 한다. */
    internal fun <T:Any> withInitialWorldInput(subject:UUID,input:InitialWorldInput,action:(InitialWorldInput)->T):T=tx {
        val world=owned(input.worldId,subject)
        val current=state(input.worldId);ready(current)
        val latest=readDraft(world,current)
        try { input.validateAgainst(latest) }
        catch(_:IllegalArgumentException) { throw WorldConflict() }
        action(InitialWorldInput.fromDraft(latest,input.analysisId))
    }

    /** 기본은 upsert. replace=true는 전체 현재 상태를 교체하며 생략 관계는 제거한다. 같은 요청은 같은 key/입력으로 재시도한다. */
    fun edit(worldId:UUID,subject:UUID,request:EditWorldDraftRequest):WorldDraftResponse=edit(worldId,subject,request,null)

    internal fun editAddition(worldId:UUID,subject:UUID,request:EditWorldDraftRequest,applicationId:UUID):WorldDraftResponse {
        require(!request.replace)
        return edit(worldId,subject,request,applicationId)
    }

    internal fun validateEditRequest(request:EditWorldDraftRequest) {
        validateName(request.name,request.description);validateKey(request.key)
        require(request.expectedDraftRevision>=0 && request.cards.size<=1000)
        require(request.cards.map { it.id }.distinct().size==request.cards.size) { "중복된 카드입니다." }
        request.cards.forEach { validate(it,false) }
        require(mapper.writeValueAsBytes(request).size<=2_000_000) { "세계관 입력 크기를 확인하세요." }
    }

    private fun guardApplication(worldId:UUID,applicationId:UUID?) {
        val pending=applications.findFirstByWorldIdAndStatusIn(worldId,listOf("applying","unknown"))
        if(pending!=null && pending.id!=applicationId) throw WorldStudioFailure.incomplete()
    }

    private fun edit(worldId:UUID,subject:UUID,request:EditWorldDraftRequest,applicationId:UUID?):WorldDraftResponse {
        validateEditRequest(request)
        val hash=hash("edit",worldId,request)
        val loaded=tx {
            val world=owned(worldId,subject);guardApplication(worldId,applicationId)
            val state=state(worldId);val draft=draft(worldId)
            val same=state.requestKey==request.key && state.expectedDraftRevision==request.expectedDraftRevision
            if(same && state.requestHash!=hash) throw WorldConflict()
            if(state.completed && same) {
                if(draft.draftRevision!=Math.incrementExact(request.expectedDraftRevision)) throw WorldConflict()
            } else {
                if(!state.completed && !same) throw WorldStudioFailure.incomplete()
                expected(draft,request.expectedDraftRevision,unprepared=state.completed)
            }
            request.cards.forEach { card ->
                val existing=cards.findById(card.id).orElse(null)
                if(existing!=null && existing.worldId!=worldId) throw WorldNotFound()
                if(applicationId!=null && !(state.completed && same) && cardDrafts.existsById(card.id)) throw WorldConflict()
            }
            EditPlan(readDraft(world,state),state.completed && same,state.graphVersion)
        }
        if(loaded.duplicate) return draft(worldId,subject)
        val mergedCards=mergeCards(loaded.draft.cards,request)
        val known=mergedCards.filter { it.lifecycle=="active" }.map { it.id }.toSet()
        require(known.size<=1000) { "설정 카드는 1,000개까지 저장할 수 있습니다." }
        val current=graph.read(worldId)
        val alreadyApplied=current.version==Math.incrementExact(loaded.graphVersion) && current.key==request.key && current.hash==hash
        if(current.worldId!=worldId || (!alreadyApplied && current.version!=loaded.graphVersion)) throw WorldStudioFailure.mismatch()
        val relations=if(alreadyApplied) current.relationships else RelationshipInputHelper.merge(current.relationships,request.relationships,request.replace,known)
        // Even an acknowledged retry must still match the PostgreSQL card membership.
        RelationshipInputHelper.merge(emptyList(),relations,true,known)
        tx {
            owned(worldId,subject);guardApplication(worldId,applicationId);val state=state(worldId)
            val same=state.requestKey==request.key && state.expectedDraftRevision==request.expectedDraftRevision
            expected(draft(worldId),request.expectedDraftRevision,unprepared=state.completed && !same && !alreadyApplied)
            if(state.graphVersion!=loaded.graphVersion) throw WorldConflict()
            if(!state.completed && (state.requestKey!=request.key || state.requestHash!=hash)) throw WorldStudioFailure.incomplete()
            // Reserve logical IDs, not card text, before leaving PostgreSQL. A pending request must not lose an ID to another world.
            request.cards.forEach { card ->
                val identity=cards.findById(card.id).orElse(null)
                if(identity!=null && identity.worldId!=worldId) throw WorldNotFound()
                if(identity==null) cards.saveAndFlush(SettingCard(id=card.id,worldId=worldId))
            }
            state.requestKey=request.key;state.requestHash=hash;state.expectedDraftRevision=request.expectedDraftRevision
            state.completed=false;states.flush()
        }
        val stored=try { graph.replace(worldId,loaded.graphVersion,request.key,hash,relations) }
        catch(_:WorldNotFound) {
            // Only this callback rejection proves the graph transaction did not apply; transport/CAS failures stay pending.
            if(alreadyApplied) throw WorldStudioFailure.mismatch()
            // Application reservations keep their identity even on proven rejection; only same request resumes.
            if(applicationId!=null) throw WorldStudioFailure.incomplete()
            tx {
                owned(worldId,subject);val state=state(worldId)
                if(state.completed || state.graphVersion!=loaded.graphVersion || state.requestKey!=request.key || state.requestHash!=hash ||
                    state.expectedDraftRevision!=request.expectedDraftRevision || draft(worldId).draftRevision!=request.expectedDraftRevision) throw WorldStudioFailure.incomplete()
                state.requestKey="";state.requestHash="";state.expectedDraftRevision=-1;state.completed=true;states.flush()
            }
            throw WorldStudioFailure.rejected()
        }
        if(stored.worldId!=worldId || stored.version!=Math.incrementExact(loaded.graphVersion) || stored.key!=request.key || stored.hash!=hash) throw WorldStudioFailure.mismatch()
        tx {
            owned(worldId,subject);guardApplication(worldId,applicationId);val state=state(worldId);val draft=draft(worldId)
            if(state.requestKey!=request.key || state.requestHash!=hash) throw WorldConflict()
            if(!state.completed) {
                expected(draft,request.expectedDraftRevision)
                (if(applicationId==null) mergedCards else request.cards).forEach { card ->
                    val existing=cardDrafts.findById(card.id).orElse(null)
                    if(existing==null) cardDrafts.save(SettingCardDraft(cardId=card.id,worldId=worldId,fields=fields(card)))
                    else { existing.fields=fields(card);existing.updatedAt=Instant.now() }
                }
                cardDrafts.flush();draft.name=request.name;draft.description=request.description
                draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
                state.graphVersion=stored.version;state.completed=true
                if(applicationId!=null) {
                    val application=applications.findById(applicationId).orElseThrow { WorldConflict() }
                    if(application.worldId!=worldId || application.baseDraftRevision!=request.expectedDraftRevision ||
                        application.relationshipVersion!=loaded.graphVersion || application.status !in listOf("applying","unknown") ||
                        mapper.convertValue(application.additionPayload,EditWorldDraftRequest::class.java)!=request) throw WorldConflict()
                    application.status="applied";application.resultDraftRevision=draft.draftRevision
                    applications.flush()
                }
                states.flush()
            }
        }
        return draft(worldId,subject)
    }

    /** 인물/설정만 불변 버전으로 남긴다. 관계 과거 상태를 수집하거나 저장했다고 응답하지 않는다. */
    fun save(worldId:UUID,subject:UUID,request:SaveWorldRequest):WorldRevisionResponse=tx {
        val world=owned(worldId,subject);ready(state(worldId));validateKey(request.key)
        val hash=hash("save",worldId,request)
        val previous=requests.findById(WorldSaveKey(worldId,request.key)).orElse(null)
        if(previous!=null) {
            if(previous.requestHash!=hash) throw WorldConflict()
            return@tx readRevision(worldId,previous.revisionId)
        }
        guardApplication(worldId,null)
        val draft=draft(worldId);expected(draft,request.expectedDraftRevision)
        val cardData=cardDrafts.findAllByWorldId(worldId).map { payload(it.cardId,it.fields) }
            .filter { it.lifecycle=="active" || (it.title.isNotBlank() && it.body.isNotBlank()) }
        cardData.forEach { validate(it,true) }
        val number=Math.incrementExact(revisions.findFirstByWorldIdOrderByRevisionNoDesc(worldId)?.revisionNo ?: 0L)
        val revision=revisions.saveAndFlush(WorldRevision(worldId=worldId,revisionNo=number,name=draft.name,description=draft.description,parentRevisionId=world.currentRevisionId))
        val numbers=cardVersions.versionNumbers(worldId).associate { (it[0] as UUID) to (it[1] as Number).toLong() }
        val saved=cardVersions.saveAll(cardData.map { SettingCardVersion(cardId=it.id,worldId=worldId,versionNo=Math.incrementExact(numbers[it.id] ?: 0L),fields=fields(it)) })
        cardVersions.flush();revisionCards.saveAll(saved.map { WorldRevisionCard(RevisionCardKey(revision.id,it.cardId),worldId,it.id) });revisionCards.flush()
        revision.sealed=true;revisions.flush();world.currentRevisionId=revision.id;draft.baseWorldRevisionId=revision.id
        draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
        requests.saveAndFlush(WorldSaveRequest(WorldSaveKey(worldId,request.key),hash,revision.id))
        readRevision(worldId,revision.id)
    }
    fun revision(worldId:UUID,subject:UUID,revisionId:UUID):WorldRevisionResponse=tx { owned(worldId,subject);readRevision(worldId,revisionId) }
    fun restore(worldId:UUID,subject:UUID,request:RestoreWorldRequest):WorldRevisionResponse {
        tx { owned(worldId,subject) }
        throw WorldStudioFailure.history()
    }

    private data class EditPlan(val draft:WorldDraftResponse,val duplicate:Boolean,val graphVersion:Long)
    private fun readDraft(world:StudioWorld,state:WorldRelationshipState):WorldDraftResponse {
        val draft=draft(world.id)
        return WorldDraftResponse(world.id,draft.draftRevision,world.currentRevisionId,draft.baseWorldRevisionId,draft.name,draft.description,
            cardDrafts.findAllByWorldId(world.id).map { payload(it.cardId,it.fields) }.sortedBy { it.id.toString() },emptyList(),state.graphVersion)
    }
    private fun readRevision(worldId:UUID,id:UUID):WorldRevisionResponse {
        val revision=revisions.findByIdAndWorldId(id,worldId)?.takeIf { it.sealed } ?: throw WorldNotFound()
        val cs=revisionCards.findAllByIdRevisionId(id)
        val saved=cardVersions.findAllById(cs.map { it.versionId }).map { SavedCardResponse(it.id,it.versionNo,it.restoredFromVersionId,payload(it.cardId,it.fields)) }.sortedBy { it.card.id.toString() }
        return WorldRevisionResponse(worldId,id,revision.revisionNo,revision.name,revision.description,revision.parentRevisionId,revision.restoredFromRevisionId,saved,null)
    }
    private fun mergeCards(current:List<CardPayload>,request:EditWorldDraftRequest):List<CardPayload> {
        val updates=request.cards.associateBy { it.id }
        return (current.map { updates[it.id] ?: if(request.replace) it.copy(lifecycle="removed") else it }.associateBy { it.id }+updates).values.toList()
    }
    private fun validateName(name:String,description:String) {
        require(name.isNotBlank() && name.length<=100 && description.length<=20000) { "세계관 이름과 설명의 길이를 확인하세요." }
    }
    private fun validateKey(key:String) { require(key.isNotBlank() && key.toByteArray(Charsets.UTF_8).size<=200) { "저장 요청 키는 1~200 바이트여야 합니다." } }
    private fun validate(card:CardPayload,confirmed:Boolean) {
        require(card.cardType in setOf("character","location","organization","ability","object","rule","event","other")) { "지원하지 않는 카드 유형입니다." }
        require(card.areaCode in setOf("basic","space","history","society","culture","special","conflict")) { "지원하지 않는 영역입니다." }
        require(card.visibility in setOf("private","public") && card.lifecycle in setOf("active","removed"))
        require(card.title.length<=200 && card.body.length<=3000 && card.classification.length<=50 && card.aliases.size<=100 && card.tags.size<=100)
        require(card.aliases.all { it.length<=200 } && card.tags.all { it.length<=200 })
        if(confirmed) require(card.title.isNotBlank() && card.body.isNotBlank()) { "카드 이름과 내용을 입력하세요." }
    }
    private fun hash(operation:String,id:UUID,value:Any)=MessageDigest.getInstance("SHA-256")
        .digest(mapper.writeValueAsBytes(listOf(operation,id,value))).joinToString("") { "%02x".format(it) }
    private fun fields(c:CardPayload)=CardFields(c.title,c.body,c.cardType,c.areaCode,c.classification,c.aliases.toList(),c.tags.toList(),c.semanticMetadata.toMap(),c.visibility,c.lifecycle)
    private fun payload(id:UUID,c:CardFields)=CardPayload(id,c.title,c.body,c.cardType,c.areaCode,c.classification,c.aliases.toList(),c.tags.toList(),c.semanticMetadata.toMap(),c.visibility,c.lifecycle)
}
