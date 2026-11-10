package ai.storyfork.content.comment.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import ai.storyfork.content.comment.entity.EpisodeCommentLikeEntity
import ai.storyfork.content.comment.repository.EpisodeCommentLikeRepository
import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.comment.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.work.domain.queryOption
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

private const val MAX_LENGTH = 500
private const val INVALID_INPUT = "댓글은 1~500자, 인용 문장은 500자 이내로 입력해 주세요."
private const val HIDDEN_CODE = "COMMENT_HIDDEN"

private enum class CommentSort { LATEST, LIKES }

/**
 * 공개 작품의 발행 회차 댓글 작성·조회·수정·삭제와 좋아요를 맡는다. 비공개·제한 작품과 미발행 회차는 모두 404다.
 * 운영이 숨긴 댓글은 목록·상세에 자리표시(`hidden`, 빈 본문·인용)로 남고 수정·좋아요·취소는 409 `COMMENT_HIDDEN`이며 작성자 삭제만 된다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class EpisodeCommentService(
    private val access: WorkAccessService,
    private val current: EpisodeCurrentRepository,
    private val comments: EpisodeCommentRepository,
    private val likes: EpisodeCommentLikeRepository,
    private val nicknames: CoreNicknameService,
) {

    /** 댓글 목록이다. sort는 latest(기본)·likes이며 잘못된 값은 422다. [viewer]가 없으면 익명이라 liked·mine이 false다. */
    fun list(id: String, number: Int, sort: String?, viewer: String?): CommentListResponse {
        val order=queryOption(sort,CommentSort.LATEST,"sort")
        publishedVersion(id,number)
        val items=respond(comments.findTop200ByWorkIdAndEpisodeNumberAndDeletedAtIsNullOrderByCreatedAtDesc(id,number),viewer)
        // ponytail: 좋아요순은 최근 200개 안에서 메모리 정렬이다. 댓글이 많아지면 페이지네이션·DB 정렬로 바꾼다.
        return CommentListResponse(if(order==CommentSort.LIKES) items.sortedWith(compareByDescending<CommentResponse> {it.likeCount}.thenByDescending {it.createdAt}) else items)
    }

    /** 댓글 상세다. 다른 작품·회차의 댓글이거나 삭제됐으면 404다. */
    fun read(id: String, number: Int, commentId: String, viewer: String?): CommentResponse =
        respond(listOf(find(id,number,commentId)),viewer).single()

    /**
     * 댓글을 쓴다. 작성 시점의 발행 버전 ID를 고정 저장하며 입력 오류는 저장 전에 422다.
     * 응답의 작성자 이름은 Core 닉네임이고, 조회에 실패하면 예외가 트랜잭션을 되돌려 댓글이 저장되지 않는다.
     */
    fun create(id: String, number: Int, member: String, data: CreateCommentRequest): CommentResponse {
        val body=cleanBody(data.body)
        val quote=cleanQuote(data.quote)
        val version=publishedVersion(id,number)
        val row=EpisodeCommentEntity(contentId(),id,number,version,member,body,quote,data.spoiler)
        comments.save(row)
        return respond(listOf(row),member).single()
    }

    /** 작성자만 본문·스포일러 여부를 고친다. 타인은 403이고 잘못된 입력은 기존 값을 바꾸지 않는 422이며, 운영이 숨긴 댓글은 409다. */
    fun update(id: String, number: Int, commentId: String, member: String, data: UpdateCommentRequest): CommentResponse {
        val body=cleanBody(data.body)
        val row=notHidden(own(id,number,commentId,member))
        row.body=body
        row.spoiler=data.spoiler
        row.updatedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
        return respond(listOf(row),member).single()
    }

    /** 작성자만 소프트 삭제한다. deleted_at만 기록하며 작품 소유자도 남의 댓글은 지울 수 없다(403). */
    fun delete(id: String, number: Int, commentId: String, member: String) {
        own(id,number,commentId,member).deletedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
    }

    /**
     * 좋아요를 누른다. 이미 눌렀으면 그대로 성공(멱등)이고, 운영이 숨긴 댓글은 409다. 동시 중복 INSERT의 unique 위반을 삼켜도 다른 호출이 오염되지 않도록
     * [ai.storyfork.content.work.service.WorkViewService.record]처럼 서비스 트랜잭션 없이 저장소 호출마다 독립 트랜잭션으로 실행한다.
     */
    @Transactional(transactionManager="contentTransactionManager",propagation=Propagation.NOT_SUPPORTED)
    fun like(id: String, number: Int, commentId: String, member: String) {
        notHidden(find(id,number,commentId))
        val key=EpisodeCommentLikeEntity.Key(commentId,member)
        if(likes.existsById(key)) return
        try {
            likes.saveAndFlush(EpisodeCommentLikeEntity(commentId,member))
        } catch(error: DataIntegrityViolationException) {
            // 같은 회원의 동시 요청이 방금 좋아요를 저장했다면 중복이므로 무시한다.
            if(!likes.existsById(key)) throw error
        }
    }

    /** 좋아요를 취소한다. 누른 적이 없어도 성공(멱등)이며, 운영이 숨긴 댓글은 409다. */
    fun unlike(id: String, number: Int, commentId: String, member: String) {
        notHidden(find(id,number,commentId))
        likes.deleteById(EpisodeCommentLikeEntity.Key(commentId,member))
    }

    /** 공개 작품의 발행 회차만 대상이다. 현재 발행 버전 ID를 돌려주며 비공개·제한 작품이나 미발행 회차는 404다. */
    private fun publishedVersion(id: String, number: Int): String {
        access.published(id)
        return current.findByWorkIdAndSequence(id,number)?.publishedVersionId ?: throw ContentFailure(404,"공개 회차를 찾을 수 없어요.")
    }

    /** 공개 작품의 발행 회차에서 삭제되지 않은 댓글 하나다. 비공개·미발행이거나 다른 작품·회차의 댓글이면 404다. */
    private fun find(id: String, number: Int, commentId: String): EpisodeCommentEntity {
        publishedVersion(id,number)
        return comments.findByIdAndWorkIdAndEpisodeNumberAndDeletedAtIsNull(commentId,id,number) ?: throw ContentFailure(404,"댓글을 찾을 수 없어요.")
    }

    private fun own(id: String, number: Int, commentId: String, member: String) =
        find(id,number,commentId).also {checkContent(it.authorId==member,403,"작성자만 수정·삭제할 수 있어요.")}

    /** 운영이 숨긴 댓글은 수정·좋아요·취소를 받지 않는다(409). 작성자 삭제는 이 검사를 거치지 않아 그대로 된다. */
    private fun notHidden(row: EpisodeCommentEntity) =
        row.also {if(it.hidden) throw ContentFailure(409,"운영 정책으로 숨겨진 댓글이에요.",HIDDEN_CODE)}

    // Kotlin trim·isNotBlank는 NBSP도 공백으로 본다(Bean Validation @NotBlank와 다르다). U+0000은 PostgreSQL text에 저장할 수 없다.
    private fun cleanBody(text: String): String = text.trim().also {
        checkContent(it.isNotBlank() && it.length<=MAX_LENGTH && '\u0000' !in it,message=INVALID_INPUT)
    }

    /** 앞뒤 공백을 자르고 비면 인용 없음(null)이다. */
    private fun cleanQuote(text: String?): String? = text?.trim()?.takeIf {it.isNotEmpty()}?.also {
        checkContent(it.length<=MAX_LENGTH && '\u0000' !in it,message=INVALID_INPUT)
    }

    private fun respond(rows: List<EpisodeCommentEntity>, viewer: String?): List<CommentResponse> {
        if(rows.isEmpty()) return emptyList()
        val liked=likes.findAllByCommentIdIn(rows.map {it.id}).groupBy {it.commentId}
        // 작성자 표시명은 Core 닉네임이다. 작성자 ID를 모아 한 번만 조회하고 Core에 없는 회원은 탈퇴한 회원으로 보인다.
        val names=nicknames.nicknames(rows.map {it.authorId})
        return rows.map {row ->
            val by=liked[row.id].orEmpty()
            // 운영이 숨긴 댓글은 원문·인용을 내보내지 않고 자리표시로 답한다. 저장된 행은 바꾸지 않는다.
            CommentResponse(row.id,row.workId,row.episodeNumber,row.publishedVersionId,names[row.authorId] ?: WITHDRAWN_MEMBER_NAME,
                if(row.hidden) "" else row.body,if(row.hidden) null else row.quote,row.spoiler,
                by.size,by.any {it.memberId==viewer},row.authorId==viewer,
                row.updatedAt>row.createdAt,row.hidden,row.createdAt,row.updatedAt)
        }
    }
}
