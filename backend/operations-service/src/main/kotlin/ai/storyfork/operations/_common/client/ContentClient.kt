package ai.storyfork.operations._common.client

import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJob
import ai.storyfork.operations.jobs.service.dto.ContentPreprocessingJobList
import ai.storyfork.operations.work.service.dto.ForkIntegrity
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.time.Instant
import java.util.UUID
import org.springframework.web.client.RestClient
import org.springframework.web.client.body
import tools.jackson.databind.JsonNode

/** [ownerId] stays a String because Content `work.owner_id` is a varchar: a non-UUID owner must not turn get/restrict/unrestrict into 502. */
data class ContentWork(val workId: UUID, val ownerId: String, val title: String, val restricted: Boolean)

data class ProposalDecisionStats(val adopted: Long, val total: Long)

data class EditSuggestionStats(val approved: Long, val decided: Long)

/** Content GET /internal/v1/operations/stats: what authors still have to review and the decision counts in the window. */
data class ContentOperationsStats(
    val pendingFeedbackReports: Long, val pendingEditSuggestions: Long,
    val proposalDecisions: ProposalDecisionStats, val editSuggestions: EditSuggestionStats,
)

/** What a Fork work's answers must not give away: the origin's private card titles and unpublished episode titles. */
data class LeakReferences(
    val originWorkId: String?, val privateCardTitles: List<String> = emptyList(), val unpublishedEpisodeTitles: List<String> = emptyList(),
)

/**
 * Management calls (genres, episodes, world studios, card categories) also keep Content's 422 (an order that is not every code once) and show its own
 * message and code (GENRE_NAME_TAKEN, GENRE_FEATURED_LIMIT, EPISODE_INHERITED, CARD_CATEGORY_NAME_TAKEN).
 */
private fun <T : Any> managed(call: () -> T?): T = upstream(setOf(400, 404, 409, 422), keepMessage = true, call = call)

/** Content internal work, comment, genre, episode, world studio and card category APIs; only the service token is sent, never a member Bearer. */
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

    /** Whole-period user-journey counts (DEC-57). Content owns the shape, so the dashboard carries its JSON as it is, like the genre rows. */
    fun funnel(): JsonNode = upstream {
        http.get().uri("/internal/v1/operations/funnel").retrieve().body<JsonNode>()
    }

    fun operationsStats(from: Instant, to: Instant): ContentOperationsStats = upstream {
        http.get().uri {
            it.path("/internal/v1/operations/stats").queryParam("from", "{from}").queryParam("to", "{to}")
                .build(mapOf("from" to from.toString(), "to" to to.toString()))
        }.retrieve().body<ContentOperationsStats>()
    }

    /** [workId] stays a String: it comes from a trace's metadata, and Content answers 404 for a work it does not know. */
    fun leakReferences(workId: String): LeakReferences = upstream {
        http.get().uri("/internal/v1/works/{id}/leak-references", workId).retrieve().body<LeakReferences>()
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

    // ponytail: the newest [size] preprocessing jobs in one call under the fixed 5s read timeout; pass status and page through when jobs outgrow one window.
    fun preprocessingJobs(size: Int): ContentPreprocessingJobList = upstream {
        http.get().uri("/internal/v1/preprocessing-jobs?page=0&size={size}", size).retrieve().body<ContentPreprocessingJobList>()
    }

    // Genre rows are passed through as JSON: Content computes every field (workCount, position, ...), so the operations API follows it without a copy of the shape.
    fun genres(): JsonNode = managed { http.get().uri("/internal/v1/genres").retrieve().body<JsonNode>() }

    fun createGenre(request: GenreCreateRequest): JsonNode = managed {
        http.post().uri("/internal/v1/genres").body(request).retrieve().body<JsonNode>()
    }

    fun updateGenre(code: String, request: GenreUpdateRequest): JsonNode = managed {
        http.patch().uri("/internal/v1/genres/{code}", code).body(request).retrieve().body<JsonNode>()
    }

    fun reorderGenres(codes: List<String>): JsonNode = managed {
        http.put().uri("/internal/v1/genres/order").body(GenreOrderRequest(codes)).retrieve().body<JsonNode>()
    }

    // Episodes, world studios and card categories are passed through as JSON too: Content computes every field (restricted, inherited, linkedWorkId, cardCount, ...).
    fun episodes(workId: UUID): JsonNode = managed {
        http.get().uri("/internal/v1/works/{id}/episodes", workId).retrieve().body<JsonNode>()
    }

    fun restrictEpisode(workId: UUID, number: Int): JsonNode = managed {
        http.put().uri("/internal/v1/works/{id}/episodes/{number}/restriction", workId, number).retrieve().body<JsonNode>()
    }

    fun unrestrictEpisode(workId: UUID, number: Int): JsonNode = managed {
        http.delete().uri("/internal/v1/works/{id}/episodes/{number}/restriction", workId, number).retrieve().body<JsonNode>()
    }

    fun worldStudios(): JsonNode = managed { http.get().uri("/internal/v1/world-studios").retrieve().body<JsonNode>() }

    fun restrictWorld(worldId: UUID): JsonNode = managed {
        http.put().uri("/internal/v1/world-studios/{id}/restriction", worldId).retrieve().body<JsonNode>()
    }

    fun unrestrictWorld(worldId: UUID): JsonNode = managed {
        http.delete().uri("/internal/v1/world-studios/{id}/restriction", worldId).retrieve().body<JsonNode>()
    }

    fun cardCategories(): JsonNode = managed { http.get().uri("/internal/v1/card-categories").retrieve().body<JsonNode>() }

    fun createCardCategory(request: CardCategoryCreateRequest): JsonNode = managed {
        http.post().uri("/internal/v1/card-categories").body(request).retrieve().body<JsonNode>()
    }

    fun updateCardCategory(code: String, request: CardCategoryUpdateRequest): JsonNode = managed {
        http.patch().uri("/internal/v1/card-categories/{code}", code).body(request).retrieve().body<JsonNode>()
    }

    fun reorderCardCategories(codes: List<String>): JsonNode = managed {
        http.put().uri("/internal/v1/card-categories/order").body(CardCategoryOrderRequest(codes)).retrieve().body<JsonNode>()
    }

    /** Content re-submits only the failed episodes of the job (DEC-50) and answers with the updated job. */
    fun retryPreprocessingJob(id: String): ContentPreprocessingJob = upstream {
        http.post().uri("/internal/v1/preprocessing-jobs/{id}/retry", id).retrieve().body<ContentPreprocessingJob>()
    }
}
