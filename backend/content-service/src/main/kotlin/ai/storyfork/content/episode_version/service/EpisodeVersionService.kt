package ai.storyfork.content.episode_version.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.beans.factory.annotation.Qualifier
import jakarta.persistence.EntityManager
import ai.storyfork.content.episode.repository.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.entity.*
import ai.storyfork.content.episode_version.repository.*
import ai.storyfork.content.episode_version.service.dto.*

@Service
@Transactional(transactionManager="contentTransactionManager")
class EpisodeVersionService(
    private val access: ai.storyfork.content.work.service.WorkAccessService,
    private val episodeService: ai.storyfork.content.episode.service.EpisodeService,
    private val publication: ai.storyfork.content.publication.service.PublicationService,
    private val world: ai.storyfork.content.world.service.WorldService,
    private val episodes: EpisodeRepository,
    private val drafts: EpisodeDraftRepository,
    private val versions: EpisodeVersionRepository,
    private val checkpoints: CheckpointRepository,
    private val checkpointEpisodes: CheckpointEpisodeRepository,
    private val checkpointSettings: CheckpointSettingRepository,
    @Qualifier("contentEntityManager") private val em: EntityManager,
) {

    fun history(id: String): VersionListResponse {
        val numbers=episodes.findAllByWorkIdOrderBySequence(id).associateBy {it.id}
        return VersionListResponse(versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(numbers.keys).filter {it.isSaved}
            .sortedWith(compareBy<EpisodeVersionEntity> {it.createdAt}.thenBy {it.revisionNo})
            .map {VersionResponse(it.contentVersionId,it.title,it.content,it.revisionNo,numbers.getValue(it.episodeId).sequence,it.createdAt.toString())})
    }
    fun save(id: String,owner: String,number: Int,data: DraftRequest): EpisodeResponse {
        access.own(id,owner)
        val changed=episodeService.update(id,owner,number,data)
        saveVersion(id,owner,number,changed.draft)
        return episodeService.read(id,owner,number)
    }
    fun restore(id: String,owner: String,number: Int,data: RevertRequest): EpisodeResponse {
        access.own(id,owner)
        val e=episodeService.read(id,owner,number)
        checkContent(!e.inherited,403,"원작 기준 회차는 수정할 수 없어요.")
        checkContent(e.draft.revision==data.revision,409,"다른 편집이 저장됐어요. 최신 원고를 불러와 주세요.")
        val v=e.versions.find {it.id==data.versionId} ?: throw ContentFailure(404,"이 회차의 저장 버전을 찾을 수 없어요.")
        val changed=episodeService.update(id,owner,number,DraftRequest(v.title,v.body,data.revision))
        saveVersion(id,owner,number,changed.draft,episodeVersionId(id,number,v.id))
        return episodeService.read(id,owner,number)
    }
    /** 기존 작품 단위 작성 API: revision은 작품 기준이며 회차 API와 혼동하지 않는다. */
    fun saveCurrent(id: String,owner: String,data: DraftRequest): SavedEpisodeVersionResult {
        val w=access.own(id,owner);access.requireRevision(w,data.revision)
        val number=publication.nextEpisodeNumber(id)
        val e=episodeService.read(id,owner,number)
        episodeService.update(id,owner,number,DraftRequest(data.title,data.body,e.draft.revision))
        val row=episodes.findByWorkIdAndSequence(id,number)!!
        drafts.findById(row.id).orElseThrow().editRevision=data.revision+1
        val changed=episodeService.read(id,owner,number).draft
        val version=saveVersion(id,owner,number,changed)
        return SavedEpisodeVersionResult(changed,version)
    }
    private fun saveVersion(id: String,owner: String,number: Int,draft: DraftResponse,restoredFrom: String? = null): VersionResponse {
        val e=episodes.findByWorkIdAndSequence(id,number) ?: throw ContentFailure(404,"회차를 찾을 수 없어요.")
        val snapshot=world.snapshot(id,owner,number)
        val contentVersion=contentId()
        val v=EpisodeVersionEntity(id=episodeVersionId(id,number,contentVersion),episodeId=e.id,contentVersionId=contentVersion,revisionNo=draft.revision,title=draft.title,content=draft.body,isSaved=true,workWorldHistoryId=snapshot.workWorldHistoryId,restoredFromId=restoredFrom)
        versions.saveAndFlush(v)
        return VersionResponse(v.contentVersionId,v.title,v.content,v.revisionNo,number,v.createdAt.toString())
    }
    /** 권한·기준 검증을 마친 서비스가 사용하는 부분 체크포인트 저장 계약. */
    fun capture(request: CheckpointRequest) {
        val basis=request.episodes.firstOrNull {it.number==request.basisEpisode} ?: throw ContentFailure(409,"기준 회차를 확인할 수 없어요.")
        val basisRow=episodes.findByWorkIdAndSequence(request.sourceWorkId,request.basisEpisode) ?: throw ContentFailure(409,"기준 회차를 확인할 수 없어요.")
        val basisVersion=versions.findByEpisodeIdAndContentVersionId(basisRow.id,basis.versionId) ?: throw ContentFailure(409,"기준 원고를 확인할 수 없어요.")
        if(!checkpoints.existsById(request.id)) checkpoints.saveAndFlush(CheckpointEntity(id=request.id,workId=request.ownerWorkId,episodeId=basisRow.id,basisEpisodeVersionId=basisVersion.id,status="content_only"))
        request.episodes.filter {it.number<=request.basisEpisode}.forEach {episode ->
            val row=episodes.findByWorkIdAndSequence(request.sourceWorkId,episode.number) ?: throw ContentFailure(409,"기준 회차를 확인할 수 없어요.")
            val v=versions.findByEpisodeIdAndContentVersionId(row.id,episode.versionId) ?: throw ContentFailure(409,"기준 원고를 확인할 수 없어요.")
            val key=CheckpointEpisodeEntity.Key(request.id,row.id)
            if(!checkpointEpisodes.existsById(key)) checkpointEpisodes.save(CheckpointEpisodeEntity(checkpointId=request.id,sourceWorkId=request.sourceWorkId,episodeId=row.id,episodeVersionId=v.id))
        }
        request.settings.forEach {setting ->
            val doc=settingDocumentId(request.settingsWorldId,setting.id);val key=CheckpointSettingEntity.Key(request.id,doc)
            if(!checkpointSettings.existsById(key)) checkpointSettings.save(CheckpointSettingEntity(checkpointId=request.id,settingDocumentId=doc,settingVersionId=settingVersionId(request.settingsWorldId,setting.id,setting.versionId)))
        }
        em.flush()
    }

}
