package ai.storyfork.content.editsuggestion.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content._common.helper.episodeVersionId
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.editsuggestion.domain.DraftReplacement
import ai.storyfork.content.editsuggestion.domain.EditScopePolicy
import ai.storyfork.content.editsuggestion.domain.EditSuggestionRules
import ai.storyfork.content.editsuggestion.entity.EditSuggestionEntity
import ai.storyfork.content.editsuggestion.repository.EditSuggestionRepository
import ai.storyfork.content.editsuggestion.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate

private const val MAX_LENGTH = 500
private const val INVALID_INPUT = "고칠 문장과 고친 문장은 1~500자, 사유는 500자 이내로 입력해 주세요."
private const val INVALID_EDITED = "편집한 문장은 1~500자로 입력해 주세요."
private const val INVALID_REASON = "사유는 500자 이내로 입력해 주세요."
private const val SAME_TEXT = "고친 문장이 원래 문장과 같아요."
private const val NOT_IN_PUBLISHED = "원문에서 고칠 문장을 찾을 수 없어요."
private const val BASE_CHANGED = "원문이 다시 발행돼 그대로 반영할 수 없어요. 집필실에서 직접 고치거나 거절해 주세요."
private const val NOT_FOUND = "수정 제안을 찾을 수 없어요."
private const val WORK_NOT_FOUND = "작품을 찾을 수 없어요."
private const val OWNER_ONLY = "작품 소유자만 처리할 수 있어요."
private const val STATE_CONFLICT = "이미 처리했거나 지금은 할 수 없는 상태예요. 목록을 새로 불러와 주세요."
private const val SAVE_FAILED = "초안을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."

/** 초안 반영이 실패했다는 신호다. 반영 트랜잭션(초안 저장·상태 기록)을 통째로 되돌린 뒤 새 트랜잭션에서 `approved`+`failed`만 기록하게 한다. */
private class ApplyAborted(val reason: String) : RuntimeException(reason)

/**
 * 공개 작품 발행 회차의 문장 수정 제안 등록·조회와 작가의 편집·승인·거절·보류를 맡는다(기능 24).
 * 승인은 새 초안 버전으로만 반영하고 발행은 하지 않는다. 열람은 제안자·작품 소유자뿐이며 그 외는 404다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class EditSuggestionService(
    private val access: WorkAccessService,
    private val works: WorkRepository,
    private val current: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val suggestions: EditSuggestionRepository,
    private val episodes: EpisodeService,
    private val episodeVersions: EpisodeVersionService,
    private val nicknames: CoreNicknameService,
    @Qualifier("contentTransactions") private val transactions: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 제안을 올린다. 등록 시점의 발행 버전 ID를 고정 저장하고, 고칠 문장이 그 발행본에 있어야 한다.
     * 입력 오류(422)는 접근 판정(404)보다 먼저다. 응답을 만들지 못하면(Core 조회 실패) 예외가 트랜잭션을 되돌려 저장되지 않는다.
     */
    fun create(id: String, number: Int, member: String, data: CreateSuggestionRequest): SuggestionResponse {
        val before=clean(data.beforeText,INVALID_INPUT)
        val after=clean(data.afterText,INVALID_INPUT)
        val reason=cleanOptional(data.reason,INVALID_INPUT)
        checkContent(before!=after,message=SAME_TEXT)
        val version=publishedVersion(id,number)
        checkContent(versions.findById(version).orElse(null)?.content?.contains(before)==true,message=NOT_IN_PUBLISHED)
        val row=EditSuggestionEntity(id=contentId(),workId=id,episodeNumber=number,publishedVersionId=version,proposerId=member,beforeText=before,afterText=after,reason=reason)
        suggestions.save(row)
        return one(row,member)
    }

    /** 제안 하나다. 제안자와 작품 소유자만 볼 수 있고 그 외나 다른 작품의 제안이거나 작품이 삭제됐으면 404다. */
    fun read(id: String, suggestionId: String, viewer: String): SuggestionResponse {
        val work=liveWork(id)
        val row=find(id,suggestionId)
        checkContent(row.proposerId==viewer || work.ownerId==viewer,404,NOT_FOUND)
        return one(row,viewer)
    }

    /** 내가 올린 제안을 최신순으로 최대 200개 돌려준다. 삭제된 작품의 제안은 피드백함처럼 빼므로 200개보다 적을 수 있다. */
    fun mine(member: String): SuggestionListResponse {
        val rows=suggestions.findTop200ByProposerIdOrderByCreatedAtDesc(member)
        val byWork=worksOf(rows)
        return SuggestionListResponse(respond(rows.filter {byWork.getValue(it.workId).deletedAt==null},member,byWork))
    }

    /**
     * 내가 소유한(삭제하지 않은) 작품들의 제안을 최신순으로 최대 200개 돌려준다. [workId]가 오면 그 작품의 제안만이며(200개 상한도 그 작품 안에서),
     * 내 작품이 아니거나 삭제됐거나 없으면 존재 여부를 드러내지 않도록 빈 목록이다. 빈 값(`workId=`)은 생략과 같다.
     */
    fun inbox(owner: String, workId: String? = null): SuggestionListResponse {
        val ids=works.findAllByOwnerIdOrderByCreatedAtDesc(owner).filter {it.deletedAt==null && (workId.isNullOrBlank() || it.id==workId)}.map {it.id}
        if(ids.isEmpty()) return SuggestionListResponse(emptyList())
        return SuggestionListResponse(respond(suggestions.findTop200ByWorkIdInOrderByCreatedAtDesc(ids),owner))
    }

    /** 소유자가 편집안을 저장한다. 원래 afterText는 그대로 두며 `pending`/`held`에서만 가능하다(그 밖은 409). */
    fun editedText(id: String, suggestionId: String, owner: String, data: EditedTextRequest): SuggestionResponse {
        val text=clean(data.editedText,INVALID_EDITED)
        val row=owned(id,suggestionId,owner)
        checkContent(EditSuggestionRules.canEdit(row.status),409,STATE_CONFLICT)
        // 변경 전과 비교하려면 제안을 읽어야 해서 접근 판정 뒤에 한다. 등록의 같은 문장 검사와 같은 규칙·문구다.
        checkContent(text!=row.beforeText,message=SAME_TEXT)
        row.editedText=text
        row.updatedAt=now()
        return one(row,owner)
    }

    /** 소유자가 `pending`을 `held`로 보류한다. 반복하거나 이미 판단한 제안이면 409다. */
    fun hold(id: String, suggestionId: String, owner: String): SuggestionResponse {
        val row=owned(id,suggestionId,owner)
        checkContent(EditSuggestionRules.canHold(row.status),409,STATE_CONFLICT)
        row.status=EditSuggestionRules.HELD
        row.updatedAt=now()
        return one(row,owner)
    }

    /** 소유자가 `pending`/`held` 제안을 선택 사유와 함께 거절한다(종결). 그 밖의 상태는 409이고 잘못된 사유는 상태를 바꾸지 않는 422다. */
    fun reject(id: String, suggestionId: String, owner: String, data: RejectionRequest?): SuggestionResponse {
        val reason=cleanOptional(data?.reason,INVALID_REASON)
        val row=owned(id,suggestionId,owner)
        checkContent(EditSuggestionRules.canReject(row.status),409,STATE_CONFLICT)
        val at=now()
        row.status=EditSuggestionRules.REJECTED
        row.decisionReason=reason
        row.decidedAt=at
        row.updatedAt=at
        return one(row,owner)
    }

    /**
     * 소유자가 승인하고 승인 내용(`editedText ?: afterText`)을 현재 초안에 반영한다. 발행은 하지 않는다.
     * `pending`/`held`이거나 반영이 실패한 `approved`(재시도)만 가능하고, 기준 발행본이 바뀌었으면 상태를 바꾸지 않는 409다(CE-07).
     * 초안에서 문장을 한 곳에서만 찾으면 기존 [EpisodeVersionService.save]로 새 초안 버전을 만들어 `approved`+`applied`로 기록한다.
     * 문장이 없거나 여러 곳이거나 원작 기준 회차이거나 저장이 실패하면 `approved`+`failed`+사유를 기록하고 반영 완료로 표시하지 않는다(UC-16 E2).
     *
     * 트랜잭션: 초안 저장과 상태 기록은 한 트랜잭션이라 함께 성공하거나 함께 취소된다. 저장이 예외로 끝나면 그 트랜잭션은 이미 되돌릴 수밖에 없는 상태
     * (참여한 서비스 트랜잭션이 rollback-only로 표시됨)라 같은 트랜잭션에는 실패를 적을 수 없으므로, 취소된 뒤 새 트랜잭션에서 실패만 기록한다.
     * 그래서 이 메서드 자체는 트랜잭션 없이 실행한다.
     */
    @Transactional(transactionManager="contentTransactionManager",propagation=Propagation.NOT_SUPPORTED)
    fun approve(id: String, suggestionId: String, owner: String): SuggestionResponse =
        try {
            requireNotNull(transactions.execute {approveAndApply(id,suggestionId,owner)})
        } catch(aborted: ApplyAborted) {
            requireNotNull(transactions.execute {recordFailure(id,suggestionId,owner,aborted.reason)})
        }

    private fun approveAndApply(id: String, suggestionId: String, owner: String): SuggestionResponse {
        val row=owned(id,suggestionId,owner)
        checkContent(EditSuggestionRules.canApprove(row.status,row.applyResult),409,STATE_CONFLICT)
        checkContent(current.findByWorkIdAndSequence(id,row.episodeNumber)?.publishedVersionId==row.publishedVersionId,409,BASE_CHANGED)
        val episode=episodes.read(id,owner,row.episodeNumber)
        val plan=if(episode.inherited) DraftReplacement.Failed(EditSuggestionRules.INHERITED_EPISODE)
            else EditSuggestionRules.replaceOnce(episode.draft.body,row.beforeText,row.editedText ?: row.afterText)
        when(plan) {
            is DraftReplacement.Failed -> settle(row,EditSuggestionRules.FAILED,plan.reason,null)
            is DraftReplacement.Replaced -> {
                val known=episode.versions.map {it.id}.toSet()
                val saved=try {
                    episodeVersions.save(id,owner,row.episodeNumber,DraftRequest(episode.draft.title,plan.body,episode.draft.revision,episode.draft.authorNote))
                } catch(error: ContentFailure) {
                    throw ApplyAborted(error.message)
                } catch(error: RuntimeException) {
                    log.warn("수정 제안 초안 반영 실패: work={} suggestion={}",id,suggestionId,error)
                    throw ApplyAborted(SAVE_FAILED)
                }
                settle(row,EditSuggestionRules.APPLIED,null,episodeVersionId(id,row.episodeNumber,saved.versions.first {it.id !in known}.id))
            }
        }
        return one(row,owner)
    }

    /** 되돌려진 반영 시도의 실패를 새 트랜잭션에서 기록한다. 그 사이 다른 요청이 제안을 이미 판단했다면 덮어쓰지 않고 409다. */
    private fun recordFailure(id: String, suggestionId: String, owner: String, reason: String): SuggestionResponse {
        val row=owned(id,suggestionId,owner)
        checkContent(EditSuggestionRules.canApprove(row.status,row.applyResult),409,STATE_CONFLICT)
        settle(row,EditSuggestionRules.FAILED,reason,null)
        return one(row,owner)
    }

    /** 승인 결과를 기록한다. 승인한 시각은 처음 승인한 때를 유지해 재시도가 바꾸지 않는다. */
    private fun settle(row: EditSuggestionEntity, result: String, failure: String?, appliedVersion: String?) {
        val at=now()
        row.status=EditSuggestionRules.APPROVED
        row.applyResult=result
        row.applyFailure=failure
        row.appliedVersionId=appliedVersion
        row.decidedAt=row.decidedAt ?: at
        row.updatedAt=at
    }

    /**
     * 공개 작품의 발행 회차만 대상이다. 현재 발행 버전 ID를 돌려주며 비공개·제한 작품이나 미발행 회차는 404다.
     * 원작이 삭제된 Fork의 상속 회차는 독자에게 본문이 가려지므로([WorkAccessResult.readerEpisodes]) 공개 회차가 없는 것과 같게 404다.
     * 본문 검사보다 먼저 판정해, 숨긴 본문에 그 문장이 있는지가 201/422로 드러나지 않게 한다.
     */
    private fun publishedVersion(id: String, number: Int): String {
        val work=access.published(id)
        val episode=current.findByWorkIdAndSequence(id,number)?.takeUnless {it.inherited && work.source?.deleted==true}
        return episode?.publishedVersionId ?: throw ContentFailure(404,"공개 회차를 찾을 수 없어요.")
    }

    /** 삭제하지 않은 작품이다. 없거나 삭제됐으면 404이며 삭제된 작품의 제안은 모든 경로에서 없는 것으로 본다. */
    private fun liveWork(id: String) = access.get(id).also {checkContent(!it.deleted,404,WORK_NOT_FOUND)}

    private fun find(id: String, suggestionId: String) =
        suggestions.findByIdAndWorkId(suggestionId,id) ?: throw ContentFailure(404,NOT_FOUND)

    /**
     * 소유자만 처리할 수 있다. 소유자면 작품 행을 잠가 같은 작품의 쓰기를 직렬화한 뒤 제안을 읽는다.
     * 제안자인데 소유자가 아니면 403이고, 볼 수 없는 사람이나 없는 작품·제안·삭제된 작품이면 404다(삭제된 작품은 제안자도 404).
     */
    private fun owned(id: String, suggestionId: String, member: String): EditSuggestionEntity {
        if(liveWork(id).ownerId!=member) {
            throw if(suggestions.findByIdAndWorkId(suggestionId,id)?.proposerId==member) ContentFailure(403,OWNER_ONLY) else ContentFailure(404,NOT_FOUND)
        }
        access.own(id,member)
        return find(id,suggestionId)
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    // Kotlin trim·isNotBlank는 NBSP도 공백으로 본다(Bean Validation @NotBlank와 다르다). U+0000은 PostgreSQL text에 저장할 수 없다.
    private fun clean(text: String, message: String): String = text.trim().also {
        checkContent(it.isNotBlank() && it.length<=MAX_LENGTH && '\u0000' !in it,message=message)
    }

    /** 앞뒤 공백을 자르고 비면 없음(null)이다. */
    private fun cleanOptional(text: String?, message: String): String? = text?.trim()?.takeIf {it.isNotEmpty()}?.also {
        checkContent(it.length<=MAX_LENGTH && '\u0000' !in it,message=message)
    }

    private fun worksOf(rows: List<EditSuggestionEntity>) = works.findAllById(rows.map {it.workId}.toSet()).associateBy {it.id}

    /** 제안 한 건의 응답이다. */
    private fun one(row: EditSuggestionEntity, viewer: String): SuggestionResponse = respond(listOf(row),viewer).single()

    private fun respond(rows: List<EditSuggestionEntity>, viewer: String, byWork: Map<String, WorkEntity> = worksOf(rows)): List<SuggestionResponse> {
        if(rows.isEmpty()) return emptyList()
        // 제안자 표시명은 Core 닉네임이다. 제안자 ID를 모아 한 번만 조회하고 Core에 없는 회원은 탈퇴한 회원으로 보인다.
        val names=nicknames.nicknames(rows.map {it.proposerId})
        return rows.map {row ->
            val work=byWork.getValue(row.workId)
            val scope=EditScopePolicy.check(row.beforeText,row.editedText ?: row.afterText)
            SuggestionResponse(row.id,row.workId,work.title,row.episodeNumber,row.publishedVersionId,row.source,names[row.proposerId] ?: WITHDRAWN_MEMBER_NAME,
                row.beforeText,row.afterText,row.editedText,row.reason,row.status,row.decisionReason,row.applyResult,row.applyFailure,row.appliedVersionId,
                scope.scope,scope.reasons,row.proposerId==viewer,work.ownerId==viewer,row.createdAt,row.updatedAt)
        }
    }
}
