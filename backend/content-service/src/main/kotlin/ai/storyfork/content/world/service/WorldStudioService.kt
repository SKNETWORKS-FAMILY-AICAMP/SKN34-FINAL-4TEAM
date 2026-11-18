package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldRestoreBlocked
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.cardImageId
import ai.storyfork.content.world.domain.isListed
import ai.storyfork.content.world.domain.validEpisode
import ai.storyfork.content.world.domain.worldGenre
import ai.storyfork.content.world.domain.worldVisibility
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

/** PostgreSQL은 권한·카드·버전을, Neo4j는 관계(회차별 연결, DEC-51)만 소유한다. 네트워크 호출은 PG transaction 밖이다. */
@Service
class WorldStudioService(
    private val worlds:StudioWorldRepository,private val drafts:WorldDraftRepository,
    private val cards:SettingCardRepository,private val cardDrafts:SettingCardDraftRepository,
    private val cardVersions:SettingCardVersionRepository,private val revisions:WorldRevisionRepository,
    private val revisionCards:WorldRevisionCardRepository,private val requests:WorldSaveRequestRepository,
    private val states:WorldRelationshipStateRepository,private val templatePublications:TemplatePublicationOnceRepository,private val expandedSeeds:ExpandedSeedProgressRepository,private val applications:InitialWorldApplicationRepository,private val images:SettingCardImageRepository,private val graph:Neo4jRelationshipRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,private val mapper:JsonMapper,
) {
    private val log=org.slf4j.LoggerFactory.getLogger(javaClass)
    private val transaction=TransactionTemplate(manager)
    private fun <T:Any> tx(action:()->T):T=transaction.execute { action() }
    private fun owned(id:UUID,subject:UUID)=worlds.lockOwned(id,subject) ?: throw WorldNotFound()
    private fun draft(id:UUID)=drafts.findById(id).orElseThrow { WorldNotFound() }
    private fun state(id:UUID)=states.findById(id).orElseThrow { WorldStudioFailure.migration() }
    private fun expected(draft:WorldDraft,revision:Long,unprepared:Boolean=false) { if(draft.draftRevision!=revision) throw if(unprepared) WorldStudioFailure.rejected() else WorldConflict() }
    private fun ready(state:WorldRelationshipState) { if(!state.completed) throw WorldStudioFailure.incomplete() }

    fun list(subject:UUID):List<WorldStudioSummaryResponse> = tx {
        worlds.findAllByOwnerSubjectAndDeletedAtIsNullOrderByCreatedAtDesc(subject).map { world ->
            val draft=draft(world.id);val state=states.findById(world.id).orElse(null)
            WorldStudioSummaryResponse(world.id,draft.name,draft.description,draft.draftRevision,
                if(state==null) "migration_required" else if(!state.completed) "incomplete" else "current",world.visibility,world.genre,world.coverObjectKey!=null,
                // ponytail: 세계관마다 count 1회(N+1). 내 세계관 수가 수백 개가 되면 world_id별 group by 한 번으로 바꾼다.
                cardCount=cardDrafts.countByWorldIdAndFieldsLifecycle(world.id,"active"))
        }
    }

    /**
     * 소유자가 세계관의 공개 범위·장르를 바꾼다(DEC-45). 공개로 바뀐 순간에만 publishedAt을 새로 찍고 장르만 바꾸면 유지하며 비공개로 바꾸면 지운다.
     * 저장 버전이 없으면 설정은 되지만 목록에 나오지 않는다(listed=false). 카드·관계·revision은 건드리지 않는다.
     */
    fun publication(worldId:UUID,subject:UUID,request:PublicationRequest):PublicationResponse {
        val visibility=worldVisibility(request.visibility);val genre=worldGenre(request.genre)
        return tx {
            val world=owned(worldId,subject)
            guardNoExpanded(worldId)
            world.ownerMetadataVersion=Math.incrementExact(world.ownerMetadataVersion)
            world.publishedAt=if(visibility=="public") world.publishedAt ?: Instant.now() else null
            world.visibility=visibility;world.genre=genre
            PublicationResponse(world.id,visibility,genre,world.publishedAt?.toString(),isListed(visibility,world.currentRevisionId))
        }
    }

    fun create(subject:UUID,request:CreateWorldRequest):WorldDraftResponse = create(subject,request,false)

    internal fun createTemplate(request:CreateWorldRequest):WorldDraftResponse =
        create(GenreTemplateSeeder.TEMPLATE_OWNER,request,true)

    internal fun incompleteExpandedWorldIds():Set<UUID> = tx { expandedSeeds.findAllByCompletedFalse().map { it.worldId }.toSet() }

    internal fun startHistoricalExpanded(request:CreateWorldRequest,inputHash:String,original:HistoricalFingerprint):Int? {
        require(original.worldId==request.id)
        val mode=tx {
            val world=worlds.findById(request.id).orElse(null) ?: return@tx 0
            owned(request.id,GenreTemplateSeeder.TEMPLATE_OWNER)
            val progress=expandedSeeds.findById(request.id).orElse(null)
            if(progress==null) 2 else if(progress.baseRevisionId==null && world.currentRevisionId==null) 0 else 1
        }
        if(mode==0) return startExpanded(request,inputHash)
        if(mode==1) return startPristineExpanded(inputHash,null,null,GenreTemplate(original.genre,original.worldId,"","",emptyList()),true)
        val snapshot=draft(original.worldId,GenreTemplateSeeder.TEMPLATE_OWNER)
        val byId=snapshot.cards.associateBy { it.id }
        if(byId.size!=snapshot.cards.size || byId.size!=original.cards.size || original.cards.map { it.id }.distinct().size!=original.cards.size) return null
        val cards=original.cards.mapIndexed { index,expected ->
            val card=byId[expected.id] ?: return null
            if(historicalPayloadHash(card,mapper)!=expected.payloadHash ||
                (card.semanticMetadata["studio"] as? Map<*,*>)?.get("templateOrder")!=index) return null
            val soul=(card.semanticMetadata["characterDocs"] as? Map<*,*>)?.get("soul") as? String
            GenreTemplateCard(card.id,card.title,card.body,card.cardType,soul)
        }
        val template=GenreTemplate(original.genre,original.worldId,snapshot.name,snapshot.description,cards)
        val key="genre-template-${original.genre}"
        if(hash("create",original.worldId,CreateWorldRequest(template.name,template.description,original.worldId))!=original.createHash ||
            hash("edit",original.worldId,EditWorldDraftRequest(0,template.name,template.description,GenreTemplateRepair.soulPayloads(template),key=key))!=original.editHash ||
            hash("save",original.worldId,SaveWorldRequest(1,key))!=original.saveHash) return null
        return startPristineExpanded(inputHash,null,null,template,true)
    }

    internal fun startExpanded(request:CreateWorldRequest,inputHash:String):Int? {
        validateName(request.name,request.description)
        val owner=GenreTemplateSeeder.TEMPLATE_OWNER
        val creationHash=hash("create",request.id,request)
        val next=tx {
            val existing=worlds.findById(request.id).orElse(null)
            if(existing==null) {
                worlds.saveAndFlush(StudioWorld(id=request.id,ownerSubject=owner))
                templatePublications.saveAndFlush(TemplatePublicationOnce(request.id))
                expandedSeeds.saveAndFlush(ExpandedSeedProgress(request.id,inputHash))
                drafts.saveAndFlush(WorldDraft(worldId=request.id,name=request.name,description=request.description))
                states.saveAndFlush(WorldRelationshipState(request.id,creationHash=creationHash,requestKey=request.id.toString(),requestHash=creationHash))
                0
            } else {
                val progress=expandedSeeds.findById(request.id).orElse(null) ?: return@tx -2
                val world=owned(request.id,owner)
                if(progress.inputHash!=inputHash || state(request.id).creationHash!=creationHash) throw WorldConflict()
                if(progress.completed) return@tx -1
                if(world.ownerMetadataVersion!=0L || world.visibility!="private" || world.currentRevisionId!=null || draft(request.id).draftRevision!=progress.nextChunk.toLong()) throw WorldConflict()
                progress.nextChunk
            }
        }
        if(next == -2) return null
        if(next<0) return next
        val creationPending=tx {
            owned(request.id,owner)
            val state=state(request.id)
            state.graphVersion==-1L && !state.completed && state.requestKey==request.id.toString() && state.requestHash==creationHash
        }
        if(creationPending) {
            val stored=graph.replace(request.id,-1,request.id.toString(),creationHash,emptyList())
            tx {
                owned(request.id,owner);val state=state(request.id)
                if(stored.worldId!=request.id || stored.version!=0L || stored.key!=request.id.toString() || stored.hash!=creationHash ||
                    state.requestKey!=stored.key || state.requestHash!=stored.hash) throw WorldConflict()
                state.graphVersion=0;state.completed=true;states.flush()
            }
        }
        return next
    }

    internal fun startPristineExpanded(inputHash:String,legacy:GenreTemplate?,baseline:GenreTemplate?,current:GenreTemplate?,allowUnmarked:Boolean=false):Int? {
        val first=legacy ?: baseline ?: current ?: return null
        val id=first.worldId;val owner=GenreTemplateSeeder.TEMPLATE_OWNER
        require(listOfNotNull(legacy,baseline,current).all { it.worldId==id && it.genre==first.genre })
        val prior=tx {
            if(worlds.findById(id).isEmpty) return@tx -2
            val world=owned(id,owner)
            val progress=expandedSeeds.findById(id).orElse(null) ?: return@tx -2
            if(progress.inputHash!=inputHash) throw WorldConflict()
            if(progress.completed) return@tx -1
            guardExpanded(world,ExpandedWrite(inputHash,progress.nextChunk))
            progress.nextChunk
        }
        if(prior!=-2) return prior
        if(!allowUnmarked && !templatePublications.existsById(id)) return null
        val snapshot=draft(id,owner)
        val (stored,hasHistory)=graph.readWithHistory(id)
        if(stored.worldId!=id || stored.version!=snapshot.relationshipVersion) throw WorldStudioFailure.mismatch()
        return tx {
            val world=owned(id,owner);val state=state(id)
            val existing=expandedSeeds.findById(id).orElse(null)
            if(existing!=null) {
                if(existing.inputHash!=inputHash) throw WorldConflict()
                if(existing.completed) return@tx -1
                guardExpanded(world,ExpandedWrite(inputHash,existing.nextChunk))
                return@tx existing.nextChunk
            }
            if((!allowUnmarked && !templatePublications.existsById(id)) || !state.completed ||
                applications.findFirstByWorldIdAndStatusIn(id,listOf("applying","unknown"))!=null ||
                stored.version!=state.graphVersion || stored.key!=state.requestKey || stored.hash!=state.requestHash ||
                snapshot.relationships.isNotEmpty() || stored.relationships.isNotEmpty() || hasHistory ||
                readDraft(world,state)!=snapshot.copy(relationships=emptyList()) ||
                !pristineTemplate(world,state,snapshot,legacy,baseline,current,true)) return@tx -2
            if(current!=null && snapshot.cards.filter { it.lifecycle=="active" }.toSet()!=GenreTemplateRepair.soulPayloads(current).toSet()) return@tx -2
            expandedSeeds.saveAndFlush(ExpandedSeedProgress(id,inputHash,baseDraftRevision=snapshot.draftRevision,
                baseGraphVersion=state.graphVersion,baseRevisionId=world.currentRevisionId,baseVisibility=world.visibility))
            0
        }.let { if(it == -2) null else it }
    }

    private data class ExpandedWrite(val inputHash:String,val index:Int)

    private fun guardExpanded(world:StudioWorld,write:ExpandedWrite):ExpandedSeedProgress {
        val progress=expandedSeeds.findById(world.id).orElse(null) ?: throw WorldConflict()
        if(progress.inputHash!=write.inputHash || progress.completed || progress.nextChunk!=write.index ||
            world.ownerMetadataVersion!=0L || world.visibility!=progress.baseVisibility || world.currentRevisionId!=progress.baseRevisionId ||
            draft(world.id).draftRevision!=Math.addExact(progress.baseDraftRevision,write.index.toLong()) ||
            state(world.id).graphVersion!=Math.addExact(progress.baseGraphVersion,write.index.toLong())) throw WorldConflict()
        return progress
    }

    internal fun expandedBase(worldId:UUID,inputHash:String,index:Int):Long = tx {
        guardExpanded(owned(worldId,GenreTemplateSeeder.TEMPLATE_OWNER),ExpandedWrite(inputHash,index)).baseDraftRevision
    }

    internal fun editExpanded(worldId:UUID,inputHash:String,index:Int,request:EditWorldDraftRequest):WorldDraftResponse {
        require(index>=0 && !request.replace)
        return edit(worldId,GenreTemplateSeeder.TEMPLATE_OWNER,request,null,ExpandedWrite(inputHash,index))
    }

    private fun create(subject:UUID,request:CreateWorldRequest,template:Boolean):WorldDraftResponse {
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
                worlds.saveAndFlush(if(template) StudioWorld(id=request.id,ownerSubject=subject,visibility="public",publishedAt=Instant.now())
                    else StudioWorld(id=request.id,ownerSubject=subject))
                if(template) templatePublications.saveAndFlush(TemplatePublicationOnce(request.id))
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

    /** 동결된 시더 요청과 전체 저장 이력이 일치하는 기존 샘플만 최초 한 번 공개한다. */
    internal fun publishPristineTemplate(legacy:GenreTemplate?, baseline:GenreTemplate?, current:GenreTemplate?) {
        val first=legacy ?: baseline ?: current ?: return
        val id=first.worldId; val owner=GenreTemplateSeeder.TEMPLATE_OWNER
        require(listOfNotNull(legacy,baseline,current).all { it.worldId==id && it.genre==first.genre })
        // 미생성 세계관은 신규 create가 marker를 같은 트랜잭션에서 만든다.
        val metadataVersion=tx {
            if(worlds.findById(id).isEmpty) return@tx -1L
            val world=owned(id,owner)
            if(templatePublications.existsById(id)) return@tx -1L
            if(world.visibility=="public" || world.ownerMetadataVersion!=0L) {
                templatePublications.saveAndFlush(TemplatePublicationOnce(id)); return@tx -1L
            }
            if(!state(id).completed) {
                log.warn("템플릿 공개 보류 world={}: 관계 요청 미완료",id);return@tx -1L
            }
            world.ownerMetadataVersion
        }
        if(metadataVersion<0) return
        val snapshot=draft(id,owner)
        val (stored,hasHistory)=graph.readWithHistory(id)
        if(stored.worldId!=id || stored.version!=snapshot.relationshipVersion) throw WorldStudioFailure.mismatch()
        val tokenMismatch=tx {
            val world=owned(id,owner)
            if(templatePublications.existsById(id)) return@tx false
            val state=state(id)
            if(world.ownerMetadataVersion!=metadataVersion || world.visibility!="private") {
                templatePublications.saveAndFlush(TemplatePublicationOnce(id));return@tx false
            }
            if(!state.completed || applications.findFirstByWorldIdAndStatusIn(id,listOf("applying","unknown"))!=null) {
                log.warn("템플릿 공개 보류 world={}: 요청 미완료",id);return@tx false
            }
            if(state.graphVersion==stored.version && (state.requestKey!=stored.key || state.requestHash!=stored.hash)) {
                templatePublications.saveAndFlush(TemplatePublicationOnce(id)); return@tx true
            }
            val now=readDraft(world,state)
            val same=now==snapshot.copy(relationships=emptyList()) &&
                state.graphVersion==stored.version && state.requestKey==stored.key && state.requestHash==stored.hash &&
                snapshot.relationships.isEmpty() && stored.relationships.isEmpty() && !hasHistory
            if(same && pristineTemplate(world,state,snapshot,legacy,baseline,current)) {
                world.visibility="public";world.publishedAt=Instant.now()
            } else log.warn("템플릿 공개 건너뜀 world={}: 초기 샘플과 다르거나 판정 중 변경됨",id)
            // 불확실하거나 사용자가 바꾼 세계관도 영구 처리하여 이후 비공개 선택을 건드리지 않는다.
            templatePublications.saveAndFlush(TemplatePublicationOnce(id))
            false
        }
        if(tokenMismatch) throw WorldStudioFailure.mismatch()
    }

    private fun pristineTemplate(world:StudioWorld,state:WorldRelationshipState,snapshot:WorldDraftResponse,
        legacy:GenreTemplate?,baseline:GenreTemplate?,current:GenreTemplate?,allowPublic:Boolean=false):Boolean {
        val first=legacy ?: baseline ?: current ?: return false
        if((world.visibility!="private" || world.publishedAt!=null) && !(allowPublic && world.visibility=="public" && world.publishedAt!=null)) return false
        if(world.genre!=null || world.coverObjectKey!=null || world.coverContentType!=null || world.ownerMetadataVersion!=0L) return false
        if(state.creationHash!=hash("create",world.id,CreateWorldRequest(first.name,first.description,world.id))) return false
        val initial=if(legacy!=null) legacy.cards.map { CardPayload(it.id,it.title,it.body,it.cardType,"basic",visibility="public") }
            else if(baseline!=null) GenreTemplateRepair.payloads(baseline) else GenreTemplateRepair.soulPayloads(first)
        val steps=mutableListOf(EditWorldDraftRequest(0,first.name,first.description,initial,key="genre-template-${first.genre}"))
        if(legacy!=null && baseline!=null) steps+=EditWorldDraftRequest(2,baseline.name,baseline.description,
            GenreTemplateRepair.payloads(baseline),key="genre-template-${first.genre}-repair-v2",replace=true)
        if(baseline!=null && current!=null && current.copy(cards=current.cards.map { it.copy(soul=null) })==baseline) {
            val number=steps.size*2L
            steps+=EditWorldDraftRequest(number,current.name,current.description,GenreTemplateRepair.soulPayloads(current),
                key="genre-template-${first.genre}-soul-v1",replace=true)
        }
        if(snapshot.draftRevision<2 || snapshot.draftRevision%2!=0L) return false
        val count=(snapshot.draftRevision/2).toInt()
        if(count !in 1..steps.size || state.graphVersion!=count.toLong()) return false
        val last=steps[count-1]
        if(state.requestKey!=last.key || state.requestHash!=hash("edit",world.id,last) || state.expectedDraftRevision!=last.expectedDraftRevision) return false
        if(snapshot.currentRevisionId==null || snapshot.baseWorldRevisionId!=snapshot.currentRevisionId) return false
        val histories=revisions.findAllByWorldId(world.id)
        val saves=requests.findAllByIdWorldId(world.id)
        if(histories.size!=count || saves.size!=count) return false
        val byNumber=histories.associateBy { it.revisionNo }
        val versions=mutableMapOf<UUID,Long>(); val versionIds=mutableSetOf<UUID>()
        var prior:UUID?=null; var expectedCards=emptyList<CardPayload>()
        for(index in 0 until count) {
            val step=steps[index]
            expectedCards=mergeCards(expectedCards,step).sortedBy { it.id.toString() }
            val revision=byNumber[index+1L] ?: return false
            if(!revision.sealed || revision.parentRevisionId!=prior || revision.restoredFromRevisionId!=null ||
                revision.name!=step.name || revision.description!=step.description) return false
            val saved=readRevision(world.id,revision.id)
            if(saved.cards.size!=expectedCards.size || saved.cards.map { it.card }.toSet()!=expectedCards.toSet()) return false
            for(card in saved.cards) {
                val version=(versions[card.card.id] ?: 0L)+1
                if(card.versionNo!=version || card.restoredFromVersionId!=null || !versionIds.add(card.versionId)) return false
                versions[card.card.id]=version
            }
            val request=SaveWorldRequest(step.expectedDraftRevision+1,step.key)
            if(saves.none { it.id.requestKey==step.key && it.requestHash==hash("save",world.id,request) && it.revisionId==revision.id }) return false
            prior=revision.id
        }
        if(prior!=world.currentRevisionId || snapshot.name!=last.name || snapshot.description!=last.description ||
            snapshot.cards.size!=expectedCards.size || snapshot.cards.toSet()!=expectedCards.toSet()) return false
        if(cards.findAllByWorldId(world.id).map { it.id }.toSet()!=expectedCards.map { it.id }.toSet()) return false
        val allVersions=cardVersions.findAllByWorldId(world.id)
        return allVersions.size==versionIds.size && allVersions.map { it.id }.toSet()==versionIds
    }

    /** 소유한 저장 초안이다. 관계는 [episode]화 시점의 것이며 생략하면 최신 회차다. */
    fun draft(worldId:UUID,subject:UUID,episode:Int?=null):WorldDraftResponse = draft(worldId,subject,episode,false)

    private fun draft(worldId:UUID,subject:UUID,episode:Int?,review:Boolean):WorldDraftResponse {
        val loaded=tx { val world=owned(worldId,subject);if(review) guardNoExpanded(worldId);val state=state(worldId);ready(state);readDraft(world,state) }
        val stored=graph.read(worldId,episode)
        if(stored.worldId!=worldId || stored.version!=loaded.relationshipVersion) throw WorldStudioFailure.mismatch()
        // 지난 회차의 관계는 그 뒤에 삭제된 카드를 끝점으로 가질 수 있어, 삭제된 카드도 이 세계관의 카드로 본다. 다른 세계관의 카드를 가리키면 어긋남이다.
        try { RelationshipInputHelper.validateSnapshot(stored.relationships,loaded.cards.map { it.id }.toSet()) }
        catch(_:IllegalArgumentException) { throw WorldStudioFailure.mismatch() }
        // Detect a prepare/finalize that raced the network read; never pair another card draft with this graph.
        tx {
            owned(worldId,subject);if(review) guardNoExpanded(worldId);val state=state(worldId);ready(state)
            if(state.graphVersion!=stored.version || draft(worldId).draftRevision!=loaded.draftRevision) throw WorldStudioFailure.mismatch()
        }
        return loaded.copy(relationships=stored.relationships)
    }

    internal fun draftForReview(worldId:UUID,subject:UUID):WorldDraftResponse = draft(worldId,subject,null,true)

    /** 소유한 저장 초안을 읽어 입력 원문과 현재 관계 기준을 고정한다. */
    internal fun prepareInitialWorldInput(worldId:UUID,subject:UUID,analysisId:UUID):InitialWorldInput =
        InitialWorldInput.fromDraft(draft(worldId,subject),analysisId)

    /** 외부 호출 없이 잠금 안에서 검증하며, 콜백은 인자로 받은 새 스냅샷만 사용해야 한다. */
    internal fun <T:Any> withInitialWorldInput(subject:UUID,input:InitialWorldInput,action:(InitialWorldInput)->T):T=tx {
        val world=owned(input.worldId,subject)
        guardNoExpanded(input.worldId)
        val current=state(input.worldId);ready(current)
        val latest=readDraft(world,current)
        try { input.validateAgainst(latest) }
        catch(_:IllegalArgumentException) { throw WorldConflict() }
        action(InitialWorldInput.fromDraft(latest,input.analysisId))
    }

    /** 기본은 upsert. replace=true는 그 회차 시점의 전체 상태를 교체하며 생략 관계는 제거(종료)한다. 같은 요청은 같은 key/입력으로 재시도한다. */
    fun edit(worldId:UUID,subject:UUID,request:EditWorldDraftRequest):WorldDraftResponse=edit(worldId,subject,request,null)

    internal fun editAddition(worldId:UUID,subject:UUID,request:EditWorldDraftRequest,applicationId:UUID):WorldDraftResponse {
        require(!request.replace)
        return edit(worldId,subject,request,applicationId)
    }

    internal fun validateEditRequest(request:EditWorldDraftRequest) {
        validateName(request.name,request.description);validateKey(request.key);validEpisode(request.episode)
        require(request.expectedDraftRevision>=0 && request.cards.size<=1000)
        require(request.cards.map { it.id }.distinct().size==request.cards.size) { "중복된 카드입니다." }
        request.cards.forEach { validate(it,false);require(it.semanticMetadata["imageId"]==null || cardImageId(it.semanticMetadata)!=null) { "카드 이미지 ID를 확인하세요." } }
        require(mapper.writeValueAsBytes(request).size<=2_000_000) { "세계관 입력 크기를 확인하세요." }
    }

    private fun guardApplication(worldId:UUID,applicationId:UUID?) {
        val pending=applications.findFirstByWorldIdAndStatusIn(worldId,listOf("applying","unknown"))
        if(pending!=null && pending.id!=applicationId) throw WorldStudioFailure.incomplete()
    }

    private fun guardNoExpanded(worldId:UUID) {
        if(expandedSeeds.findById(worldId).orElse(null)?.completed==false) throw WorldConflict()
    }

    private fun edit(worldId:UUID,subject:UUID,request:EditWorldDraftRequest,applicationId:UUID?,expanded:ExpandedWrite?=null):WorldDraftResponse {
        validateEditRequest(request)
        val hash=hash("edit",worldId,request)
        val loaded=tx {
            val world=owned(worldId,subject);if(expanded!=null) guardExpanded(world,expanded) else guardNoExpanded(worldId)
            guardApplication(worldId,applicationId);requireCardImages(worldId,request.cards)
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
        if(loaded.duplicate) return draft(worldId,subject,request.episode)
        val mergedCards=mergeCards(loaded.draft.cards,request)
        val known=mergedCards.filter { it.lifecycle=="active" }.map { it.id }.toSet()
        require(known.size<=10000) { "설정 카드는 10,000개까지 저장할 수 있습니다." }
        val current=graph.read(worldId,request.episode)
        val alreadyApplied=current.version==Math.incrementExact(loaded.graphVersion) && current.key==request.key && current.hash==hash
        if(current.worldId!=worldId || (!alreadyApplied && current.version!=loaded.graphVersion)) throw WorldStudioFailure.mismatch()
        // 끝점은 이 세계관의 카드(삭제한 카드 포함)면 되고, 그 회차 시점 관계와 다른(새로 만들거나 바뀐) 관계만 양 끝이 활성 카드여야 한다.
        val worldCards=mergedCards.map { it.id }.toSet()
        val relations=if(alreadyApplied) current.relationships else RelationshipInputHelper.merge(current.relationships,request.relationships,request.replace,worldCards)
        // Even an acknowledged retry must still match the PostgreSQL card membership.
        RelationshipInputHelper.validateSnapshot(relations,worldCards)
        // 이미 반영된 재시도는 relations가 current와 같아 새로 만들거나 바뀐 관계가 없다.
        RelationshipInputHelper.validateSnapshot(relations-current.relationships.toSet(),known)
        // 이번 요청이 삭제하는 카드(원래 초안에서 활성이던 카드)는 회차를 생략한(최신) 편집에서만 지우고, 거기 이어진 관계는 함께 빼야 한다. 지난 회차에 이미 삭제된 카드의 관계는 그대로 둘 수 있고, 재시도는 새로 쓸 것이 없어 건너뛴다.
        val deleting=loaded.draft.cards.filter { it.lifecycle=="active" }.map { it.id }.toSet()-known
        if(!alreadyApplied && deleting.isNotEmpty()) {
            // 지난 회차 시점의 관계만으로는 최신 관계에 삭제 카드가 남는지 알 수 없다(끝낸 관계를 뒤 회차에서 다시 이었을 수 있다).
            require(request.episode==null) { "설정 삭제는 최신 회차에서 하세요." }
            require(relations.none { it.sourceCardId in deleting || it.targetCardId in deleting }) { "삭제하는 설정에 이어진 관계도 함께 빼세요." }
        }
        tx {
            val world=owned(worldId,subject);if(expanded!=null) guardExpanded(world,expanded) else guardNoExpanded(worldId)
            guardApplication(worldId,applicationId);val state=state(worldId)
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
        val stored=try { graph.replace(worldId,loaded.graphVersion,request.key,hash,relations,request.episode) }
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
            val world=owned(worldId,subject);val progress=expanded?.let { guardExpanded(world,it) }
            if(expanded==null) guardNoExpanded(worldId)
            guardApplication(worldId,applicationId);val state=state(worldId);val draft=draft(worldId)
            if(state.requestKey!=request.key || state.requestHash!=hash) throw WorldConflict()
            if(!state.completed) {
                expected(draft,request.expectedDraftRevision)
                (if(applicationId==null && request.replace) mergedCards else request.cards).forEach { card ->
                    val existing=cardDrafts.findById(card.id).orElse(null)
                    if(existing==null) cardDrafts.save(SettingCardDraft(cardId=card.id,worldId=worldId,fields=fields(card)))
                    else { existing.fields=fields(card);existing.updatedAt=Instant.now() }
                }
                cardDrafts.flush();draft.name=request.name;draft.description=request.description
                draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
                state.graphVersion=stored.version;state.completed=true
                if(progress!=null) { progress.nextChunk=Math.incrementExact(progress.nextChunk);expandedSeeds.flush() }
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
        return draft(worldId,subject,request.episode)
    }

    /** 인물/설정만 불변 버전으로 남긴다. 관계 과거 상태를 수집하거나 저장했다고 응답하지 않는다. */
    fun save(worldId:UUID,subject:UUID,request:SaveWorldRequest):WorldRevisionResponse=save(worldId,subject,request,null)

    internal fun saveExpanded(worldId:UUID,inputHash:String,index:Int,request:SaveWorldRequest):WorldRevisionResponse {
        require(index>=0)
        return save(worldId,GenreTemplateSeeder.TEMPLATE_OWNER,request,ExpandedWrite(inputHash,index))
    }

    private fun save(worldId:UUID,subject:UUID,request:SaveWorldRequest,expanded:ExpandedWrite?):WorldRevisionResponse=tx {
        val world=owned(worldId,subject);if(expanded==null) guardNoExpanded(worldId)
        ready(state(worldId));validateKey(request.key)
        val hash=hash("save",worldId,request)
        val previous=requests.findById(WorldSaveKey(worldId,request.key)).orElse(null)
        if(previous!=null) {
            if(previous.requestHash!=hash) throw WorldConflict()
            if(expanded!=null) {
                val progress=expandedSeeds.findById(worldId).orElse(null) ?: throw WorldConflict()
                if(progress.inputHash!=expanded.inputHash || !progress.completed) throw WorldConflict()
            }
            return@tx readRevision(worldId,previous.revisionId)
        }
        val progress=expanded?.let { guardExpanded(world,it) }
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
        if(progress!=null) {
            progress.completed=true;expandedSeeds.flush()
            if(progress.baseRevisionId==null) { world.visibility="public";world.publishedAt=Instant.now() }
        }
        readRevision(worldId,revision.id)
    }
    fun revision(worldId:UUID,subject:UUID,revisionId:UUID):WorldRevisionResponse=tx { owned(worldId,subject);readRevision(worldId,revisionId) }
    /** 검증된 Principal의 회원 UUID만 전달한다. 새 HTTP/AI 진입점은 제공하지 않는다. */
    fun confirmedContext(worldId:UUID,subject:UUID,revisionId:UUID):WorldConfirmedContextResult {
        val saved=revision(worldId,subject,revisionId)
        val active=saved.cards.filter { it.card.lifecycle=="active" }
        return WorldConfirmedContextResult(saved.worldId,saved.revisionId,saved.revisionNo,subject,
            saved.name,saved.description,active,saved.cards.size-active.size)
    }

    fun revisionSummaries(worldId: UUID, subject: UUID): List<WorldRevisionSummaryResponse> = tx {
        owned(worldId, subject)
        revisions.findAllByWorldIdAndSealedTrueOrderByRevisionNoDesc(worldId).map { it.summary() }
    }
    fun revisionSummary(worldId: UUID, subject: UUID, revisionId: UUID): WorldRevisionSummaryResponse = tx {
        owned(worldId, subject)
        sealedRevision(worldId, revisionId).summary()
    }
    /**
     * 확정 버전 [revisionId]의 카드로 초안의 카드만 되돌린다(2026-11-17 사용자 결정). 카드 집합이 그 버전의 카드(내용·공개 범위·semanticMetadata 그대로)가 되고,
     * 그 버전에 없던 현재 활성 카드는 `removed`가 된다. 세계관 이름·설명·공개 설정·관계(Neo4j)는 그대로이고 새 확정 버전도 만들지 않는다(작가가 [save]로 남긴다).
     * 사라질 카드가 현재 관계의 끝점이면 아무것도 바꾸지 않고 [WorldRestoreBlocked]로 거절한다. 관계는 Neo4j라 PG transaction 밖에서 읽고,
     * 쓰기 직전에 초안 revision과 관계 token이 그대로인지 다시 본다.
     */
    fun restore(worldId:UUID,subject:UUID,revisionId:UUID,request:RestoreWorldRequest):WorldDraftResponse {
        val plan=tx {
            owned(worldId,subject);val state=state(worldId);ready(state);guardApplication(worldId,null)
            sealedRevision(worldId,revisionId);expected(draft(worldId),request.expectedDraftRevision)
            val target=cardVersions.findAllById(revisionCards.findAllByIdRevisionId(revisionId).map { it.versionId }).associateBy { it.cardId }
            val current=cardDrafts.findAllByWorldId(worldId)
            val changes=target.mapValues { fields(payload(it.key,it.value.fields)) }.toMutableMap()
            // 그 버전에 없는 활성 카드는 내용을 두고 삭제 상태로만 바꾼다. 이미 삭제된 카드는 그대로 둔다.
            current.filter { it.cardId !in target && it.fields.lifecycle=="active" }.forEach { changes[it.cardId]=fields(payload(it.cardId,it.fields).copy(lifecycle="removed")) }
            RestorePlan(state.graphVersion,changes,current.filter { it.fields.lifecycle=="active" && changes.getValue(it.cardId).lifecycle!="active" }.associate { it.cardId to it.fields.title })
        }
        val stored=graph.read(worldId)
        if(stored.worldId!=worldId || stored.version!=plan.graphVersion) throw WorldStudioFailure.mismatch()
        val blocked=plan.vanishing.filterKeys { id -> stored.relationships.any { it.sourceCardId==id || it.targetCardId==id } }
        if(blocked.isNotEmpty()) throw WorldRestoreBlocked(blocked.values.toList())
        tx {
            owned(worldId,subject);val state=state(worldId);ready(state);val draft=draft(worldId)
            expected(draft,request.expectedDraftRevision)
            if(state.graphVersion!=plan.graphVersion) throw WorldConflict()
            val rows=cardDrafts.findAllByWorldId(worldId).associateBy { it.cardId }
            plan.changes.forEach { (id,changed) -> rows.getValue(id).let { it.fields=changed;it.updatedAt=Instant.now() } }
            draft.baseWorldRevisionId=revisionId;draft.draftRevision=Math.incrementExact(draft.draftRevision);draft.updatedAt=Instant.now()
        }
        return draft(worldId,subject)
    }

    /**
     * 소유자가 세계관을 지운다(소프트 삭제, 2026-11-17 사용자 결정). 행·초안·확정 버전·이미지·관계는 그대로 두고 [StudioWorld.deletedAt]만 찍어 소유자·공개 조회에서 모두 없는 것으로 만든다.
     * 연결된 소설이 있으면([linked], 정본은 Content의 work.world_studio_id라 호출자가 먼저 읽어 넘긴다) 거절한다. 남의 세계관은 404다.
     */
    fun delete(worldId:UUID,subject:UUID,linked:Boolean) { tx {
        val world=owned(worldId,subject)
        if(linked) throw WorldStudioFailure.linked()
        world.deletedAt=Instant.now()
    } }

    private class RestorePlan(val graphVersion:Long,val changes:Map<UUID,CardFields>,val vanishing:Map<UUID,String>)

    private data class EditPlan(val draft:WorldDraftResponse,val duplicate:Boolean,val graphVersion:Long)
    private fun readDraft(world:StudioWorld,state:WorldRelationshipState):WorldDraftResponse {
        val draft=draft(world.id)
        return WorldDraftResponse(world.id,draft.draftRevision,world.currentRevisionId,draft.baseWorldRevisionId,draft.name,draft.description,
            cardDrafts.findAllByWorldId(world.id).map { payload(it.cardId,it.fields) }.sortedBy { it.id.toString() },emptyList(),state.graphVersion,
            visibility=world.visibility,genre=world.genre,hasCover=world.coverObjectKey!=null)
    }
    private fun sealedRevision(worldId: UUID, id: UUID) =
        revisions.findByIdAndWorldId(id, worldId)?.takeIf { it.sealed } ?: throw WorldNotFound()

    private fun WorldRevision.summary() = WorldRevisionSummaryResponse(worldId, id, revisionNo, name, createdAt.toString())

    private fun readRevision(worldId:UUID,id:UUID):WorldRevisionResponse {
        val revision=sealedRevision(worldId,id)
        val cs=revisionCards.findAllByIdRevisionId(id)
        val saved=cardVersions.findAllById(cs.map { it.versionId }).map { SavedCardResponse(it.id,it.versionNo,it.restoredFromVersionId,payload(it.cardId,it.fields)) }.sortedBy { it.card.id.toString() }
        return WorldRevisionResponse(worldId,id,revision.revisionNo,revision.name,revision.description,revision.parentRevisionId,revision.restoredFromRevisionId,saved,null)
    }
    private fun mergeCards(current:List<CardPayload>,request:EditWorldDraftRequest):List<CardPayload> {
        val updates=request.cards.associateBy { it.id }
        return (current.map { updates[it.id] ?: if(request.replace) it.copy(lifecycle="removed") else it }.associateBy { it.id }+updates).values.toList()
    }
    /** 카드가 가리키는 대표 이미지(#401)는 모두 이 세계관이 올린 것이어야 한다. 다른 세계관의 이미지·없는 ID는 입력 오류이며 아무것도 저장하기 전에 던져 이전 초안이 그대로 남는다. */
    private fun requireCardImages(worldId:UUID,cards:List<CardPayload>) {
        val wanted=cards.mapNotNull { cardImageId(it.semanticMetadata) }.toSet()
        if(wanted.isEmpty()) return
        require(images.findAllById(wanted).filter { it.worldId==worldId }.map { it.id }.toSet()==wanted) { "카드 이미지를 확인하세요." }
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
