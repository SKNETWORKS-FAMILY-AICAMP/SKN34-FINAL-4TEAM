package ai.storyfork.content.comment.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.comment.repository.CommentFeedbackStore
import ai.storyfork.content.comment.service.dto.CommentFeedbackResult
import ai.storyfork.content.work.service.WorkAccessService
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class CommentFeedbackQueryService(private val access: WorkAccessService, private val store: CommentFeedbackStore) {
    @Transactional(transactionManager = "contentTransactionManager")
    fun inbox(work: String, episode: Int?, offset: Int, size: Int, viewer: String): CommentFeedbackStore.Inbox {
        access.own(work, viewer)
        if (offset < 0 || size !in 0..100 || (episode != null && episode < 1))
            throw ContentFailure(400, "댓글 조회 범위를 확인해 주세요.")
        return store.inbox(work, episode, offset, size)
    }

    /** 작품 인가와 현재 댓글의 분석 결과 조회를 같은 Content 트랜잭션에서 수행한다. */
    @Transactional(transactionManager = "contentTransactionManager")
    fun read(work: String, episode: Int, comment: String, viewer: String): CommentFeedbackResult {
        access.own(work,viewer)
        return store.read(work,episode,comment) ?: throw ContentFailure(404,"댓글 분석 결과를 찾을 수 없어요.")
    }

    fun counts(work: String, episode: Int?, viewer: String): List<CommentFeedbackStore.AspectCount> {
        access.own(work, viewer)
        if (episode != null && episode < 1) throw ContentFailure(400, "회차를 확인해 주세요.")
        return store.counts(work,episode)
    }

    fun retry(work: String, episode: Int, id: String, viewer: String) {
        access.own(work,viewer)
        if (!store.retryFailed(work,episode,id)) throw ContentFailure(409,"재처리할 실패 결과가 없습니다.")
    }
}
