package ai.storyfork.operations._common.client

import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.work.service.dto.ForkIntegrity
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

/** [ownerId] stays a String because Content `work.owner_id` is a varchar: a non-UUID owner must not turn get/restrict/unrestrict into 502. */
data class ContentWork(val workId: UUID, val ownerId: String, val title: String, val restricted: Boolean)

/** Content internal work and comment APIs; only the service token is sent, never a member Bearer. */
class ContentClient(private val http: RestClient) {
    fun work(workId: UUID): ContentWork = upstream {
        http.get().uri("/internal/v1/works/{id}", workId).retrieve().body<ContentWork>()
    }

    // ponytail: one unpaged call under the fixed 5s read timeout; add server-side q/kind/sort/page (work contract) when the list grows.
    fun works(): OperationsWorkList = upstream {
        http.get().uri("/internal/v1/works").retrieve().body<OperationsWorkList>()
    }

    // Content's own 404/409 text ("포크 작품을 찾을 수 없어요.", "원작의 고정 기준 기록을 확인할 수 없어요.") is what the admin needs to read, so it is kept.
    fun forkIntegrity(workId: UUID): ForkIntegrity = upstream(keepMessage = true) {
        http.get().uri("/internal/v1/works/{id}/fork-integrity", workId).retrieve().body<ForkIntegrity>()
    }

    fun restrict(workId: UUID): ContentWork = upstream {
        http.put().uri("/internal/v1/works/{id}/restriction", workId).retrieve().body<ContentWork>()
    }

    fun unrestrict(workId: UUID): ContentWork = upstream {
        http.delete().uri("/internal/v1/works/{id}/restriction", workId).retrieve().body<ContentWork>()
    }

    // ponytail: one unpaged call under the fixed 5s read timeout; add server-side workId/q/sort/page (comment contract) when the list grows.
    fun listComments(): OperationsCommentList = upstream {
        http.get().uri("/internal/v1/comments").retrieve().body<OperationsCommentList>()
    }

    /** [commentId] stays a String: Content comment ids are varchars, so a listed non-UUID id must still be hidden or restored. */
    fun hideComment(commentId: String): OperationsComment = upstream {
        http.put().uri("/internal/v1/comments/{id}/hidden", commentId).retrieve().body<OperationsComment>()
    }

    fun unhideComment(commentId: String): OperationsComment = upstream {
        http.delete().uri("/internal/v1/comments/{id}/hidden", commentId).retrieve().body<OperationsComment>()
    }
}
