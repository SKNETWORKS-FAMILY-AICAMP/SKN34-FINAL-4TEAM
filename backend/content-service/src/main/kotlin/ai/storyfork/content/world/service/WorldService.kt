package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import java.time.Instant
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*
import ai.storyfork.content.work.service.dto.*
import ai.storyfork.content.episode.entity.*
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.dto.*
import ai.storyfork.content.world.entity.*
import ai.storyfork.content.world.repository.*
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.fork.entity.*
import ai.storyfork.content.fork.repository.*
import ai.storyfork.content.fork.service.dto.*
import ai.storyfork.content.world.domain.*

@Service
@Transactional(transactionManager="contentTransactionManager")
class WorldService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val worlds: WorldRepository,
    private val workWorlds: WorkWorldHistoryRepository,
    private val documents: SettingDocumentRepository,
    private val versions: SettingVersionRepository,
    private val readingDetails: SettingReadingDetailRepository,
    private val currentEpisodes: EpisodeCurrentRepository,
    private val drafts: SettingDraftRepository,
    private val visibility: SettingVisibilityHistoryRepository,
    private val ranges: SettingVisibilityRangeRepository,
    private val tags: SettingTagRepository,
    private val versionTags: SettingVersionTagRepository,
    private val documentTags: SettingDocumentTagRepository,
    private val knowledge: SettingKnowledgeScopeRepository,
    private val origins: SettingOriginRepository,
    private val episodes: EpisodeRepository,
    private val forks: ForkRepository,
    private val references: ForkWorldReferenceRepository,
    private val sourceSettings: ForkSourceSettingRepository,
    private val checkpointSettings: CheckpointSettingRepository,
    private val changes: ForkSourceChangeRepository,
    private val decisions: ForkChangeDecisionRepository,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {

    private data class Loaded(val work: WorkAccessResult, val state: WorldState, val basis: BasisResponse?, val sourceWorld: String?, val sourceHistory: List<Setting>)
    fun read(id: String, owner: String): WorldResponse = view(load(access.own(id,owner)))
    fun publicRead(id: String, episode: Int): ReadingWorldResponse {
        val l=load(access.published(id))
        checkContent(episode>0 && currentEpisodes.findByWorkIdAndSequence(id,episode)?.publishedVersionId!=null,404,"공개된 회차를 찾을 수 없어요.")
        // 원작이 삭제되면 원작 세계관을 그대로 따라가는 Fork의 독자에게 원작 설정을 보이지 않는다(고정본은 소유자 참고용, UC 원작 삭제).
        if(l.state.mode=="following" && l.work.source?.deleted==true) return ReadingWorldResponse(id,episode,emptyList())
        val selected=selectSettings(effective(l),episode,true)
        val world=if(l.state.mode=="following") l.sourceWorld!! else ownedWorld(l)
        val details=readingDetails.findAllById(selected.map {settingVersionId(world,it.id,it.versionId)}).associateBy {it.settingVersionId}
        val visible=selected.filter {s -> details[settingVersionId(world,s.id,s.versionId)]?.eventEpisode?.let {it<=episode} ?: true}
        val ids=visible.map {it.id}.toSet()
        return ReadingWorldResponse(id,episode,visible.map {toReadingResponse(it,details[settingVersionId(world,it.id,it.versionId)],episode,ids,if(l.state.mode=="following") l.work.source?.episode else null)})
    }
    fun isFollowingForContext(id: String): Boolean = load(access.get(id)).state.mode=="following"
    fun historyForContext(id: String): SettingListResponse {
        val loaded=load(access.get(id))
        return SettingListResponse(effective(loaded).map {it.toPayload()})
    }
    fun saveDraft(id: String, sid: String, owner: String, data: SettingRequest): WorldResponse {
        val l=load(access.own(id,owner));val s=l.state
        revision(l,data.revision);requireEditable(l,sid);validateSetting(data.setting.toDomain())
        val before=view(l)
        checkContent(data.sourceToken==before.sourceToken,409,"참조 원본 설정이 변경됐어요. 다시 불러와 주세요.")
        checkContent(sid=="new" || effective(l).any {it.id==sid} || sid in s.drafts,404,"설정을 찾을 수 없어요.")
        detach(l)
        val setting=data.setting.toDomain().copy(id=if(sid=="new") contentId() else sid,versionId="")
        s.drafts[setting.id]=setting;s.revision++
        persist(l);return view(load(access.get(id)))
    }
    fun commit(id: String,sid: String,owner: String,expected: Int): WorldResponse {
        val l=load(access.own(id,owner));revision(l,expected)
        val setting=l.state.drafts[sid] ?: throw ContentFailure(409,"설정 초안을 먼저 저장해 주세요.")
        requireEditable(l,sid);append(l.state,setting);persist(l);return view(load(access.get(id)))
    }
    fun revert(id: String,sid: String,owner: String,data: RevertRequest): WorldResponse {
        val l=load(access.own(id,owner));revision(l,data.revision)
        checkContent(l.state.drafts.isEmpty(),409,"작성 중인 설정 초안을 먼저 확정해 주세요.")
        val setting=effective(l).find {it.id==sid && it.versionId==data.versionId && it.content.isNotEmpty()}
            ?: throw ContentFailure(404,"설정 버전을 찾을 수 없어요.")
        requireEditable(l,sid);detach(l);append(l.state,setting);persist(l);return view(load(access.get(id)))
    }
    fun applySourceChange(id: String,owner: String,data: ChangeRequest) {
        val l=load(access.own(id,owner));revision(l,data.revision)
        val change=view(l).changes.find {it.id==data.changeId} ?: throw ContentFailure(409,"원본 변경이 달라졌어요. 알림을 다시 확인해 주세요.")
        checkContent(change.decision!="apply",409,"이미 반영한 변경이에요. 버전 복원을 이용해 주세요.")
        if(data.decision=="apply") {
            requireEditable(l,change.settingId,copySource=true)
            checkContent(l.state.drafts.isEmpty(),409,"설정 초안을 먼저 확정해 주세요.")
            append(l.state,(change.after ?: change.before!!.copy(visibility="private",content="원본 공개 범위에서 제외됨")).toDomain())
        } else l.state.revision++
        persist(l)
    }
    fun snapshot(id: String,owner: String,number: Int): WorldSnapshotResult {
        val l=load(access.own(id,owner))
        val history=workWorlds.findFirstByWorkIdOrderByRevisionNoDesc(id) ?: throw ContentFailure(409,"세계관 기준을 찾을 수 없어요.")
        return WorldSnapshotResult(if(l.state.mode=="following") l.sourceWorld!! else ownedWorld(l),history.id,
            selectSettings(effective(l),number).map {it.toPayload()})
    }
    fun readCheckpoint(checkpoint: String, scopeWork: String): SettingListResponse = SettingListResponse(readRows(
        versions.findAllById(checkpointSettings.findAllByCheckpointId(checkpoint).map {it.settingVersionId}).sortedBy {it.revisionNo},scopeWork).map {it.toPayload()})
    fun sourceSnapshots(id: String,owner: String): SourceSnapshotsResult {
        val l=load(access.own(id,owner))
        val basis=l.work.source?.episode ?: throw ContentFailure(409,"원작이 없는 작품이에요.")
        return SourceSnapshotsResult(l.sourceWorld!!,l.state.sourceSnapshot.map {it.toPayload()},selectSettings(l.sourceHistory,basis,true).map {it.toPayload()})
    }
    private fun load(w: WorkAccessResult): Loaded {
        em.flush()
        val f=forks.findById(w.id).orElse(null)
        val reference=f?.let {references.findById(w.id).orElseThrow()}
        val mode=reference?.referenceStatus ?: "own"
        val worldId=if(w.source==null) w.worldId else w.id
        val world=worlds.findById(worldId).orElse(null)
        val state=WorldState(revision=if(mode=="following") f!!.worldRevision else world?.revision ?: 0,mode=mode)
        if(mode!="following") {
            state.history=readHistory(worldId,w.id).toMutableList()
            val docs=documents.findAllByWorldId(worldId).associateBy {it.id}
            drafts.findAllBySettingDocumentIdInOrderByEditOrder(docs.keys).forEach {d ->
                state.drafts[docs.getValue(d.settingDocumentId).logicalId]=Setting(id=docs.getValue(d.settingDocumentId).logicalId,name=d.name,content=d.content,category=d.categoryId,tags=d.tags,visibility=d.visibilityStatus,fromEpisode=d.fromEpisode,toEpisode=d.toEpisode,knownBy=d.knownBy,evidence=d.evidence)
            }
        }
        val source=w.source?.let {access.get(it.workId)}
        val sourceHistory=if(source==null) emptyList() else readHistory(source.worldId,source.id)
        val basis=f?.let { BasisResponse(w.source!!.episode,w.source.version,readCheckpoint(it.sourceCheckpointId,it.sourceWorkId).items) }
        if(f!=null) {
            state.sourceSnapshot=readRows(versions.findAllById(sourceSettings.findAllByForkWorkId(w.id).map {it.settingVersionId}).sortedBy {it.revisionNo},f.sourceWorkId)
            val byId=changes.findAllByForkWorkId(w.id).associateBy {it.id}
            decisions.findAllBySourceChangeIdInOrderByDecidedAtAscIdAsc(byId.keys).forEach {state.decisions[byId.getValue(it.sourceChangeId).sourceChangeRef]=it.decision}
        }
        return Loaded(w,state,basis,source?.worldId,sourceHistory)
    }
    private fun readHistory(world: String, scopeWork: String): List<Setting> = readRows(versions.findAllBySettingDocumentIdInOrderByRevisionNo(documents.findAllByWorldId(world).map {it.id}),scopeWork)
    private fun readRows(rows: List<SettingVersionEntity>, scopeWork: String): List<Setting> {
        if(rows.isEmpty()) return emptyList()
        val docs=documents.findAllById(rows.map {it.settingDocumentId}).associateBy {it.id}
        val policies=visibility.findAllById(rows.mapNotNull {it.visibilityHistoryId}).associateBy {it.id}
        val policyRanges=ranges.findAllByVisibilityHistoryIdIn(policies.keys)
        val bounds=episodes.findAllById(policyRanges.flatMap {listOfNotNull(it.startEpisodeId,it.endEpisodeId)}).associateBy {it.id}
        val localRanges=policyRanges.filter {bounds[it.startEpisodeId]?.workId==scopeWork}.groupBy {it.visibilityHistoryId}
        val tagLinks=versionTags.findAllBySettingVersionIdInOrderByPosition(rows.map {it.id}).groupBy {it.settingVersionId}
        val tagById=tags.findAllById(tagLinks.values.flatten().map {it.settingTagId}).associateBy {it.id}
        val known=knowledge.findAllBySettingVersionIdInOrderByPositionAscCharacterNameAsc(rows.map {it.id}).groupBy {it.settingVersionId}
        return rows.flatMap {v ->
            val doc=docs.getValue(v.settingDocumentId)
            val policy=policies[v.visibilityHistoryId] ?: throw ContentFailure(409,"설정 공개 정책이 누락됐어요.")
            val scoped=localRanges[policy.id].orEmpty().sortedBy {it.id}
            (if(scoped.isEmpty()) listOf<SettingVisibilityRangeEntity?>(null) else scoped).map {r ->
                Setting(doc.logicalId,v.contentVersionId,v.name,v.content,v.categoryId,
                    tagLinks[v.id].orEmpty().sortedWith(compareBy<SettingVersionTagEntity> {it.position}.thenBy {tagById.getValue(it.settingTagId).name}).map {tagById.getValue(it.settingTagId).name},
                    r?.visibility ?: policy.defaultVisibility,r?.let {bounds.getValue(it.startEpisodeId).sequence} ?: 1,
                    r?.endEpisodeId?.let {bounds.getValue(it).sequence},known[v.id].orEmpty().map {it.characterName},v.evidence)
            }
        }
    }
    private fun effective(l: Loaded): List<Setting> = if(l.state.mode=="following") followingHistory(l.sourceHistory,l.work.source!!.episode) else l.state.history.toList()
    private fun detach(l: Loaded) {
        if(l.state.mode!="following") return
        l.state.history=effective(l).toMutableList()
        l.state.sourceSnapshot=selectSettings(l.sourceHistory,l.work.source!!.episode,true)
        l.state.mode="independent"
    }
    private fun append(state: WorldState, setting: Setting) {
        state.history.add(setting.copy(versionId=contentId()));state.drafts.remove(setting.id);state.revision++
    }
    private fun revision(l: Loaded, expected: Int) = checkContent(l.state.revision==expected,409,"설정집이 변경됐어요. 최신 데이터를 불러와 주세요.")
    /** 구형 쓰기 DTO에 없는 wiki 필드를 새 버전에서 소실시키지 않는다. 전용 편집 계약 전까지 명시적 읽기 전용이다. */
    private fun requireEditable(l: Loaded, sid: String, copySource: Boolean = false) {
        val world=if(l.state.mode=="following") l.sourceWorld!! else ownedWorld(l)
        // Following detach copies its effective history; ordinary writes only replace the target.
        val affected=effective(l).filter {l.state.mode=="following" || it.id==sid}
        val ids=affected.map {settingVersionId(world,it.id,it.versionId)} +
            (if(copySource) l.sourceHistory.filter {it.id==sid}.map {settingVersionId(l.sourceWorld!!,it.id,it.versionId)} else emptyList())
        if(ids.isNotEmpty()) checkContent(readingDetails.findAllById(ids.distinct()).isEmpty(),409,"구조화된 wiki 설정은 현재 읽기 전용이에요. 기존 내용은 변경하지 않았어요.")
    }
    private fun ownedWorld(l: Loaded) = if(l.work.source==null) l.work.worldId else l.work.id
    private fun view(l: Loaded): WorldResponse {
        val h=effective(l);val before=l.state.sourceSnapshot.associateBy {it.id}
        val after=l.work.source?.let {selectSettings(l.sourceHistory,it.episode,true)}.orEmpty().associateBy {it.id}
        val changes=if(l.state.mode!="independent") emptyList() else (before.keys+after.keys).sorted().mapNotNull {id ->
            val a=before[id];val b=after[id]
            if(a==b) null else { val token=settingsToken(listOfNotNull(a,b));WorldChangeResponse(token,id,a?.toPayload(),b?.toPayload(),l.state.decisions[token] ?: "pending") }
        }
        return WorldResponse(l.work.id,l.work.title+" 설정집",l.state.revision,l.state.mode,l.basis,l.state.drafts.values.lastOrNull()?.toPayload(),l.state.drafts.values.map {it.toPayload()},
            h.associateBy {it.id}.values.filter {it.content.isNotEmpty()}.map {it.toPayload()},h.map {it.toPayload()},settingsToken(h),changes)
    }
    private fun persist(l: Loaded) {
        val worldId=ownedWorld(l);val state=l.state
        val world=worlds.findById(worldId).orElse(null) ?: WorldEntity(id=worldId,ownerId=l.work.ownerId,name=l.work.title+" 설정집")
        world.revision=state.revision;worlds.saveAndFlush(world)
        val current=workWorlds.findFirstByWorkIdOrderByRevisionNoDesc(l.work.id)
        if(current?.worldId!=worldId) {
            val revision=(current?.revisionNo ?: -1)+1
            workWorlds.saveAndFlush(WorkWorldHistoryEntity(id=contentKey("work-world",l.work.id,revision.toString()),workId=l.work.id,worldId=worldId,revisionNo=revision))
        }
        val all=(state.history+state.drafts.values).associateBy {it.id}
        all.values.forEach {s -> val id=settingDocumentId(worldId,s.id)
            if(!documents.existsById(id)) documents.saveAndFlush(SettingDocumentEntity(id=id,worldId=worldId,logicalId=s.id))
        }
        state.history.forEachIndexed {index,s ->
            val doc=settingDocumentId(worldId,s.id);val id=settingVersionId(worldId,s.id,s.versionId)
            if(!versions.existsById(id)) {
                val visibilityId=contentKey("visibility",id)
                visibility.saveAndFlush(SettingVisibilityHistoryEntity(id=visibilityId,settingDocumentId=doc,revisionNo=index,defaultVisibility="private"))
                fun ensure(number: Int): EpisodeEntity = episodes.findByWorkIdAndSequence(l.work.id,number) ?: episodes.saveAndFlush(EpisodeEntity(id=contentId(),workId=l.work.id,sequence=number))
                val first=ensure(s.fromEpisode);val last=s.toEpisode?.let(::ensure)
                ranges.saveAndFlush(SettingVisibilityRangeEntity(id=contentKey("range",id),visibilityHistoryId=visibilityId,startEpisodeId=first.id,endEpisodeId=last?.id,visibility=s.visibility))
                versions.saveAndFlush(SettingVersionEntity(id=id,settingDocumentId=doc,contentVersionId=s.versionId,revisionNo=index,name=s.name,categoryId=s.category,content=s.content,evidence=s.evidence,visibilityHistoryId=visibilityId))
                s.knownBy.forEachIndexed {position,name -> knowledge.save(SettingKnowledgeScopeEntity(settingVersionId=id,characterName=name,position=position))}
                s.tags.forEachIndexed {position,tag ->
                    val tagId=contentKey("tag",l.work.ownerId,tag)
                    if(!tags.existsById(tagId)) tags.saveAndFlush(SettingTagEntity(id=tagId,ownerId=l.work.ownerId,name=tag))
                    versionTags.save(SettingVersionTagEntity(settingVersionId=id,settingTagId=tagId,position=position))
                }
            }
        }
        em.flush()
        state.history.associateBy {it.id}.values.forEach {s ->
            val doc=settingDocumentId(worldId,s.id);val wanted=s.tags.map {contentKey("tag",l.work.ownerId,it)}.toSet()
            val old=documentTags.findAllBySettingDocumentId(doc)
            documentTags.deleteAll(old.filter {it.settingTagId !in wanted})
            val existing=old.map {it.settingTagId}.toSet()
            wanted.filter {it !in existing}.forEach {documentTags.save(SettingDocumentTagEntity(settingDocumentId=doc,settingTagId=it))}
            if(l.sourceWorld!=null && !origins.existsById(doc)) {
                val origin=settingVersionId(l.sourceWorld,s.id,s.versionId)
                if(versions.existsById(origin)) origins.save(SettingOriginEntity(settingDocumentId=doc,sourceSettingVersionId=origin))
            }
        }
        val docs=documents.findAllByWorldId(worldId).associateBy {it.id}
        val oldDrafts=drafts.findAllBySettingDocumentIdInOrderByEditOrder(docs.keys).associateBy {it.settingDocumentId}
        drafts.deleteAll(oldDrafts.values.filter {docs.getValue(it.settingDocumentId).logicalId !in state.drafts})
        state.drafts.values.forEachIndexed {index,s ->
            val doc=settingDocumentId(worldId,s.id);val d=oldDrafts[doc] ?: SettingDraftEntity(settingDocumentId=doc)
            d.name=s.name;d.categoryId=s.category;d.content=s.content;d.fromEpisode=s.fromEpisode;d.toEpisode=s.toEpisode;d.visibilityStatus=s.visibility
            d.knownBy=s.knownBy;d.tags=s.tags;d.evidence=s.evidence;d.editOrder=index;d.editRevision=state.revision;d.updatedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
            drafts.save(d)
        }
        val f=forks.findById(l.work.id).orElse(null)
        if(f!=null) {
            f.worldRevision=state.revision
            val ref=references.findById(l.work.id).orElseThrow()
            ref.referenceStatus=state.mode
            if(state.mode=="independent" && ref.detachedAt==null) ref.detachedAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
            state.sourceSnapshot.forEach {s ->
                val doc=settingDocumentId(l.sourceWorld!!,s.id)
                val key=ForkSourceSettingEntity.Key(l.work.id,doc)
                if(!sourceSettings.existsById(key)) sourceSettings.save(ForkSourceSettingEntity(forkWorkId=l.work.id,settingDocumentId=doc,settingVersionId=settingVersionId(l.sourceWorld,s.id,s.versionId)))
            }
        }
        em.flush()
    }

}
