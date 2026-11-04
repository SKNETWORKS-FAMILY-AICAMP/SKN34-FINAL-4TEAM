package ai.storyfork.core.world.service

import ai.storyfork.core.world.domain.WorldConflict
import ai.storyfork.core.world.domain.WorldNotFound
import ai.storyfork.core.world.entity.*
import ai.storyfork.core.world.repository.*
import ai.storyfork.core.world.service.dto.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.transaction.support.TransactionTemplate

/** 독립 세계관의 초안·확정본을 저장한다. subject는 호출 계층에서 검증한 JWT의 UUID여야 한다. */
class WorldStudioService(
    private val worlds:WorldRepository, private val drafts:WorldDraftRepository,
    private val cards:SettingCardRepository, private val cardDrafts:SettingCardDraftRepository,
    private val cardVersions:SettingCardVersionRepository, private val relationships:RelationshipRepository,
    private val relationDrafts:RelationshipDraftRepository, private val relationVersions:RelationshipVersionRepository,
    private val revisions:WorldRevisionRepository, private val revisionCards:WorldRevisionCardRepository,
    private val revisionRelations:WorldRevisionRelationshipRepository, private val requests:WorldSaveRequestRepository,
    private val transactions:TransactionTemplate,
) {
    private fun <T:Any> transaction(action:()->T):T = requireNotNull(transactions.execute { action() })
    private fun owned(id:UUID,subject:UUID)=worlds.lockOwned(id,subject) ?: throw WorldNotFound()
    private fun draft(id:UUID)=drafts.findById(id).orElseThrow { WorldNotFound() }
    private fun expected(draft:WorldDraft,revision:Long) { if(draft.draftRevision!=revision) throw WorldConflict() }

    fun create(subject:UUID,request:CreateWorldRequest):WorldDraftResponse=transaction {
        require(request.name.isNotBlank()) { "세계관 이름을 입력하세요." }
        val world=worlds.saveAndFlush(StudioWorld(ownerSubject=subject))
        drafts.saveAndFlush(WorldDraft(worldId=world.id,name=request.name,description=request.description))
        readDraft(world)
    }
    fun draft(worldId:UUID,subject:UUID):WorldDraftResponse=transaction { readDraft(owned(worldId,subject)) }
    fun revision(worldId:UUID,subject:UUID,revisionId:UUID):WorldRevisionResponse=transaction {
        owned(worldId,subject);readRevision(worldId,revisionId)
    }

    /** 생략된 항목은 유지한다. 빈 원문·미완성 관계는 초안으로 보존하며 확정 단계에서 검사한다. */
    fun edit(worldId:UUID,subject:UUID,request:EditWorldDraftRequest):WorldDraftResponse=transaction {
        val world=owned(worldId,subject);val draft=draft(worldId);expected(draft,request.expectedDraftRevision)
        require(request.cards.map { it.id }.distinct().size==request.cards.size) { "중복된 카드입니다." }
        require(request.relationships.map { it.id }.distinct().size==request.relationships.size) { "중복된 관계입니다." }
        request.cards.forEach { card ->
            validate(card,false)
            val identity=cards.findById(card.id).orElse(null)
            if(identity!=null && identity.worldId!=worldId) throw WorldNotFound()
            if(identity==null) cards.saveAndFlush(SettingCard(id=card.id,worldId=worldId))
            val current=cardDrafts.findById(card.id).orElse(null)
            if(current==null) cardDrafts.save(SettingCardDraft(cardId=card.id,worldId=worldId,fields=fields(card)))
            else { current.fields=fields(card);current.updatedAt=Instant.now() }
        }
        cardDrafts.flush()
        val known=cardDrafts.findAllByWorldId(worldId).map { it.cardId }.toSet()
        request.relationships.forEach { relation ->
            validate(relation,false)
            require(relation.sourceCardId==null || relation.sourceCardId in known) { "관계의 시작 카드가 이 세계관에 없습니다." }
            require(relation.targetCardId==null || relation.targetCardId in known) { "관계의 대상 카드가 이 세계관에 없습니다." }
            val identity=relationships.findById(relation.id).orElse(null)
            if(identity!=null && identity.worldId!=worldId) throw WorldNotFound()
            if(identity==null) relationships.saveAndFlush(Relationship(id=relation.id,worldId=worldId))
            val current=relationDrafts.findById(relation.id).orElse(null)
            if(current==null) relationDrafts.save(RelationshipDraft(relationId=relation.id,worldId=worldId,fields=fields(relation)))
            else { current.fields=fields(relation);current.updatedAt=Instant.now() }
        }
        draft.name=request.name;draft.description=request.description
        draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
        relationDrafts.flush()
        readDraft(world)
    }

    fun save(worldId:UUID,subject:UUID,request:SaveWorldRequest):WorldRevisionResponse=transaction {
        val world=owned(worldId,subject)
        val hash=hash("save",worldId,request.expectedDraftRevision,null)
        retry(worldId,request.key,hash)?.let { return@transaction it }
        val draft=draft(worldId);expected(draft,request.expectedDraftRevision)
        val source=readDraft(world)
        persist(world,draft,source.name,source.description,source.cards,source.relationships,request.key,hash)
    }

    /** 과거 확정본을 새 버전으로 복원한다. 과거 이력과 논리 ID는 유지하며 현재 초안은 명시적으로 교체한다. */
    fun restore(worldId:UUID,subject:UUID,request:RestoreWorldRequest):WorldRevisionResponse=transaction {
        val world=owned(worldId,subject)
        val hash=hash("restore",worldId,request.expectedDraftRevision,request.revisionId)
        retry(worldId,request.key,hash)?.let { return@transaction it }
        val draft=draft(worldId);expected(draft,request.expectedDraftRevision)
        val source=readRevision(worldId,request.revisionId)
        val result=persist(world,draft,source.name,source.description,source.cards.map { it.card },
            source.relationships.map { it.relationship },request.key,hash,source)
        // Bulk JPQL removes only mutable drafts; flush/clear prevents stale entities being reused.
        relationDrafts.deleteWorldDrafts(worldId);cardDrafts.deleteWorldDrafts(worldId)
        cardDrafts.saveAll(source.cards.map { SettingCardDraft(cardId=it.card.id,worldId=worldId,fields=fields(it.card)) })
        relationDrafts.saveAll(source.relationships.map { RelationshipDraft(relationId=it.relationship.id,worldId=worldId,fields=fields(it.relationship)) })
        val restoredDraft=draft(worldId);restoredDraft.name=source.name;restoredDraft.description=source.description
        result
    }

    private fun persist(world:StudioWorld,draft:WorldDraft,name:String,description:String,cardData:List<CardPayload>,relationData:List<RelationshipPayload>,
        key:String,hash:String,restored:WorldRevisionResponse?=null):WorldRevisionResponse {
        require(name.isNotBlank()) { "세계관 이름을 입력하세요." }
        cardData.forEach { validate(it,true) };relationData.forEach { validate(it,true) }
        val active=cardData.filter { it.lifecycle=="active" }.map { it.id }.toSet()
        require(relationData.filter { it.lifecycle=="active" }.all { it.sourceCardId in active && it.targetCardId in active }) { "활성 관계는 현재 세계관의 활성 카드 사이에만 저장할 수 있습니다." }
        val number=(revisions.findFirstByWorldIdOrderByRevisionNoDesc(world.id)?.revisionNo ?: 0L)+1
        val revision=revisions.saveAndFlush(WorldRevision(worldId=world.id,revisionNo=number,name=name,description=description,
            parentRevisionId=world.currentRevisionId,restoredFromRevisionId=restored?.revisionId))
        val cardNumbers=cardVersions.versionNumbers(world.id).associate { (it[0] as UUID) to (it[1] as Number).toLong() }
        val relationNumbers=relationVersions.versionNumbers(world.id).associate { (it[0] as UUID) to (it[1] as Number).toLong() }
        val restoredCards=restored?.cards?.associateBy { it.card.id }.orEmpty()
        val restoredRelations=restored?.relationships?.associateBy { it.relationship.id }.orEmpty()
        val savedCards=cardVersions.saveAll(cardData.map { SettingCardVersion(cardId=it.id,worldId=world.id,versionNo=(cardNumbers[it.id] ?: 0L)+1,
            fields=fields(it),restoredFromVersionId=restoredCards[it.id]?.versionId) })
        val savedRelations=relationVersions.saveAll(relationData.map { RelationshipVersion(relationId=it.id,worldId=world.id,versionNo=(relationNumbers[it.id] ?: 0L)+1,
            fields=fields(it),restoredFromVersionId=restoredRelations[it.id]?.versionId) })
        cardVersions.flush()
        revisionCards.saveAll(savedCards.map { WorldRevisionCard(RevisionCardKey(revision.id,it.cardId),world.id,it.id) })
        revisionRelations.saveAll(savedRelations.map { WorldRevisionRelationship(RevisionRelationshipKey(revision.id,it.relationId),world.id,it.id) })
        revisionCards.flush()
        revision.sealed=true;revisions.flush()
        world.currentRevisionId=revision.id;draft.baseWorldRevisionId=revision.id
        draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
        requests.save(WorldSaveRequest(WorldSaveKey(world.id,key),hash,revision.id));requests.flush()
        return readRevision(world.id,revision.id)
    }

    private fun retry(worldId:UUID,key:String,hash:String):WorldRevisionResponse? {
        require(key.isNotBlank() && key.toByteArray(Charsets.UTF_8).size<=200) { "저장 요청 키는 1~200 바이트여야 합니다." }
        val previous=requests.findById(WorldSaveKey(worldId,key)).orElse(null) ?: return null
        if(previous.requestHash!=hash) throw WorldConflict()
        return readRevision(worldId,previous.revisionId)
    }
    // The locked draft revision identifies the entire draft; changing any draft increments it.
    private fun hash(operation:String,worldId:UUID,revision:Long,restored:UUID?)=MessageDigest.getInstance("SHA-256")
        .digest("$operation:$worldId:$revision:${restored ?: ""}".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun readDraft(world:StudioWorld):WorldDraftResponse {
        val draft=draft(world.id)
        return WorldDraftResponse(world.id,draft.draftRevision,world.currentRevisionId,draft.baseWorldRevisionId,draft.name,draft.description,
            cardDrafts.findAllByWorldId(world.id).map { payload(it.cardId,it.fields) }.sortedBy { it.id.toString() },
            relationDrafts.findAllByWorldId(world.id).map { payload(it.relationId,it.fields) }.sortedBy { it.id.toString() })
    }
    private fun readRevision(worldId:UUID,id:UUID):WorldRevisionResponse {
        val revision=revisions.findByIdAndWorldId(id,worldId)?.takeIf { it.sealed } ?: throw WorldNotFound()
        val cs=revisionCards.findAllByIdRevisionId(id);val rs=revisionRelations.findAllByIdRevisionId(id)
        val savedCards=cardVersions.findAllById(cs.map { it.versionId }).map { SavedCardResponse(it.id,it.versionNo,it.restoredFromVersionId,payload(it.cardId,it.fields)) }.sortedBy { it.card.id.toString() }
        val savedRelations=relationVersions.findAllById(rs.map { it.versionId }).map { SavedRelationshipResponse(it.id,it.versionNo,it.restoredFromVersionId,payload(it.relationId,it.fields)) }.sortedBy { it.relationship.id.toString() }
        return WorldRevisionResponse(worldId,id,revision.revisionNo,revision.name,revision.description,revision.parentRevisionId,revision.restoredFromRevisionId,savedCards,savedRelations)
    }
    private fun validate(card:CardPayload,confirmed:Boolean) {
        require(card.cardType in setOf("character","location","organization","ability","object","rule","event","other")) { "지원하지 않는 카드 유형입니다." }
        require(card.areaCode in setOf("basic","space","history","society","culture","special","conflict")) { "지원하지 않는 영역입니다." }
        require(card.visibility in setOf("private","public") && card.lifecycle in setOf("active","removed"))
        if(confirmed) require(card.title.isNotBlank() && card.body.isNotBlank()) { "카드 이름과 내용을 입력하세요." }
    }
    private fun validate(relation:RelationshipPayload,confirmed:Boolean) {
        require(relation.category==null || relation.category in setOf("structural","emotional"))
        require(relation.direction==null || relation.direction in setOf("directed","symmetric"))
        require(relation.lifecycle in setOf("active","removed"))
        if(confirmed) require(relation.sourceCardId!=null && relation.targetCardId!=null && relation.category!=null && relation.direction!=null && relation.body.isNotBlank()) { "관계의 양쪽 카드와 유형·내용을 확인하세요." }
    }
    private fun fields(c:CardPayload)=CardFields(c.title,c.body,c.cardType,c.areaCode,c.classification,c.aliases.toList(),c.tags.toList(),c.semanticMetadata.toMap(),c.visibility,c.lifecycle)
    private fun fields(r:RelationshipPayload)=RelationshipFields(r.sourceCardId,r.targetCardId,r.category,r.body,r.label,r.direction,r.polarity,r.semanticMetadata.toMap(),r.lifecycle)
    private fun payload(id:UUID,c:CardFields)=CardPayload(id,c.title,c.body,c.cardType,c.areaCode,c.classification,c.aliases.toList(),c.tags.toList(),c.semanticMetadata.toMap(),c.visibility,c.lifecycle)
    private fun payload(id:UUID,r:RelationshipFields)=RelationshipPayload(id,r.sourceCardId,r.targetCardId,r.category,r.body,r.label,r.direction,r.polarity,r.semanticMetadata.toMap(),r.lifecycle)
}
