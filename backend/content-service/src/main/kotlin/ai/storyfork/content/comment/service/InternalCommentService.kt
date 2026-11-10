package ai.storyfork.content.comment.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.comment.entity.EpisodeCommentEntity
import ai.storyfork.content.comment.repository.EpisodeCommentLikeRepository
import ai.storyfork.content.comment.repository.EpisodeCommentRepository
import ai.storyfork.content.comment.service.dto.OperationsCommentListResponse
import ai.storyfork.content.comment.service.dto.OperationsCommentResponse
import ai.storyfork.content.work.repository.WorkRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 운영 서비스 전용 댓글 조회와 숨김·게시 복구. 작성자 검사 없이 서비스 토큰으로만 보호된다. 삭제된 댓글과 삭제된 작품의 댓글은 대상이 아니다(DEC-42). */
@Service
@Transactional(transactionManager="contentTransactionManager")
class InternalCommentService(
    private val comments: EpisodeCommentRepository,
    private val likes: EpisodeCommentLikeRepository,
    private val works: WorkRepository,
    private val nicknames: CoreNicknameService,
) {
    /**
     * 숨김을 포함한 전체 댓글(작성 최신순)이다. 댓글·작품 제목은 쿼리 한 번, 공감 수는 댓글별 group by 쿼리 한 번으로 읽고 행마다 추가 조회하지 않는다.
     * 작성자명은 Core 최신 닉네임이며 작성자 ID를 모아 한 번만 조회한다. Core에 없는 작성자는 탈퇴한 회원이고 Core 실패는 그대로 전파한다.
     * ponytail: 페이지네이션 없이 전체를 한 번에 준다. 댓글이 많아지면 서버 필터·페이지로 옮긴다(operations-comment-contract.md).
     */
    fun list(): OperationsCommentListResponse {
        val rows = comments.listForOperations()
        val likeCounts = likes.countAllByComment().associate { it[0] as String to (it[1] as Number).toInt() }
        val names = nicknames.nicknames(rows.map { (it[0] as EpisodeCommentEntity).authorId })
        return OperationsCommentListResponse(rows.map { row ->
            val c = row[0] as EpisodeCommentEntity
            view(c, row[1] as String, likeCounts[c.id] ?: 0, names[c.authorId] ?: WITHDRAWN_MEMBER_NAME)
        })
    }

    /** 댓글을 숨긴다. 이미 숨겼으면 그대로다(멱등). */
    fun hide(id: String) = set(id, true)

    /** 숨긴 댓글을 다시 게시한다. 이미 게시 중이면 그대로다(멱등). */
    fun restore(id: String) = set(id, false)

    /** 없는·삭제된 댓글이나 삭제된 작품의 댓글은 바꾸기 전에 404로 막는다. 수정이 아니므로 updatedAt은 건드리지 않는다. */
    private fun set(id: String, hidden: Boolean): OperationsCommentResponse {
        val row = comments.findById(id).orElse(null)?.takeIf { it.deletedAt == null } ?: missing()
        val work = works.findById(row.workId).orElse(null)?.takeIf { it.deletedAt == null } ?: missing()
        row.hidden = hidden
        val name = nicknames.nicknames(listOf(row.authorId))[row.authorId] ?: WITHDRAWN_MEMBER_NAME
        return view(row, work.title, likes.findAllByCommentIdIn(listOf(id)).size, name)
    }

    private fun view(c: EpisodeCommentEntity, title: String, likeCount: Int, authorName: String) =
        OperationsCommentResponse(c.id, c.workId, title, c.episodeNumber, c.authorId, authorName, c.body, likeCount, c.hidden, c.createdAt)

    private fun missing(): Nothing = throw ContentFailure(404, "댓글을 찾을 수 없어요.")
}
