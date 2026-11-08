package ai.storyfork.content.plan.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.plan.entity.StoryPlanEntity
import ai.storyfork.content.plan.repository.StoryPlanRepository
import ai.storyfork.content.plan.service.dto.*
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldService
import java.time.Instant
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(transactionManager="contentTransactionManager")
class StoryPlanService(
    private val access: WorkAccessService,
    private val plans: StoryPlanRepository,
    private val world: WorldService,
    private val episodes: EpisodeRepository,
    private val episodeService: EpisodeService,
) {
    fun list(workId: String, owner: String): StoryPlanListResponse {
        access.own(workId, owner)
        return StoryPlanListResponse(plans.findAllByWorkIdAndDeletedAtIsNullOrderByCreatedAtAscIdAsc(workId).map(::response))
    }
    fun read(workId: String, owner: String, id: String): StoryPlanResponse {
        access.own(workId, owner)
        return response(active(workId, id))
    }
    fun create(workId: String, owner: String, data: StoryPlanRequest): StoryPlanResponse {
        access.own(workId, owner)
        checkContent(data.revision==0,409,"새 계획의 편집 번호를 확인해 주세요.")
        val episodeId=validate(workId, owner, data)
        val row=StoryPlanEntity(id=contentId(), workId=workId)
        apply(row, data, episodeId)
        plans.save(row)
        return response(row)
    }
    fun update(workId: String, owner: String, id: String, data: StoryPlanRequest): StoryPlanResponse {
        access.own(workId, owner)
        val row=active(workId, id)
        revision(row, data.revision)
        checkContent(row.kind==data.kind && row.parentId==data.parentId,message="계획 종류와 소속 플롯은 바꿀 수 없어요.")
        val episodeId=validate(workId, owner, data)
        // A deleted episode number must not silently bind to a newly created episode.
        checkContent(row.episodeNumber!=data.episodeNumber || row.episodeNumber==null || row.episodeId==episodeId,409,"연결한 회차가 삭제되거나 바뀌었어요. 회차 연결을 해제하고 저장해 주세요.")
        apply(row, data, episodeId)
        return response(row)
    }
    fun delete(workId: String, owner: String, id: String, expected: Int) {
        access.own(workId, owner)
        val row=active(workId, id)
        revision(row, expected)
        checkContent(!plans.existsByWorkIdAndParentIdAndDeletedAtIsNull(workId,id),409,"하위 장면 계획을 먼저 삭제해 주세요.")
        row.deletedAt=Instant.now(); row.revision++
    }
    private fun active(workId: String, id: String): StoryPlanEntity {
        val row=plans.findById(id).orElse(null)
        return row?.takeIf {it.workId==workId && it.deletedAt==null} ?: throw ContentFailure(404,"계획을 찾을 수 없어요.")
    }
    private fun revision(row: StoryPlanEntity, expected: Int) {
        checkContent(row.revision==expected && expected<Int.MAX_VALUE,409,"다른 변경이 저장됐어요. 입력을 보관하고 다시 불러와 주세요.")
    }
    private fun validate(workId: String, owner: String, data: StoryPlanRequest): String? {
        checkContent(data.kind in setOf("plot","scene") && (data.kind=="scene")==!data.parentId.isNullOrBlank(),message="장면 계획은 소속 플롯을 선택해야 해요.")
        checkContent(data.title.isNotBlank() && data.title.length<=120 && data.content.length<=8000,message="제목은 1~120자, 계획 내용은 8,000자 이내로 입력해 주세요.")
        checkContent(data.kind!="plot" || (data.episodeNumber==null && data.characterIds.isEmpty() && data.placeIds.isEmpty()),message="회차·인물·장소는 장면 계획에서 연결해 주세요.")
        for(ids in listOf(data.characterIds,data.placeIds)) checkContent(ids.size<=30 && ids.distinct().size==ids.size && ids.all {it.isNotBlank() && it.length<=200},message="인물·장소는 중복 없이 각각 30개까지 선택해 주세요.")
        data.parentId?.let {checkContent(active(workId,it).kind=="plot",message="소속 플롯을 확인해 주세요.")}
        if(data.characterIds.isNotEmpty() || data.placeIds.isNotEmpty()) {
            val allowed=world.read(workId, owner).settings.associateBy {it.id}
            checkContent(data.characterIds.all {allowed[it]?.category=="인물"} && data.placeIds.all {allowed[it]?.category=="장소"},message="연결할 인물·장소를 찾을 수 없어요. 다시 선택해 주세요.")
        }
        return data.episodeNumber?.let {number ->
            checkContent(number>0,message="올바른 회차를 선택해 주세요.")
            // Reuse the writing-read contract; visibility placeholders are not selectable episodes.
            try { episodeService.read(workId,owner,number) }
            catch (error: ContentFailure) {
                if(error.status!=404) throw error
                throw ContentFailure(422,"연결할 회차를 찾을 수 없어요.")
            }
            episodes.findByWorkIdAndSequence(workId,number)?.id ?: throw ContentFailure(422,"연결할 회차를 찾을 수 없어요.")
        }
    }
    private fun apply(row: StoryPlanEntity, data: StoryPlanRequest, episodeId: String?) {
        row.kind=data.kind; row.parentId=data.parentId; row.title=data.title.trim(); row.content=data.content
        row.episodeId=episodeId; row.episodeNumber=data.episodeNumber
        row.characterIds.clear(); row.characterIds.addAll(data.characterIds)
        row.placeIds.clear(); row.placeIds.addAll(data.placeIds)
        row.revision++
    }
    private fun response(row: StoryPlanEntity): StoryPlanResponse {
        val missing=row.episodeNumber!=null && (row.episodeId==null || episodes.findById(row.episodeId!!).isEmpty)
        return StoryPlanResponse(row.id,row.workId,row.kind,row.parentId,row.title,row.content,row.episodeNumber,missing,row.characterIds.toList(),row.placeIds.toList(),row.revision)
    }
}
