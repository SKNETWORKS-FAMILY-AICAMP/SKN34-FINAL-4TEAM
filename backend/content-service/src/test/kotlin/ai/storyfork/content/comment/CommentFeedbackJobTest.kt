package ai.storyfork.content.comment

import ai.storyfork.content.comment.client.CommentFeedbackClient
import ai.storyfork.content.comment.repository.*
import ai.storyfork.content.comment.service.CommentFeedbackJob
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.web.client.*
import org.springframework.http.HttpStatus
import java.util.UUID

class CommentFeedbackJobTest {
    private val ai = mock(CommentFeedbackClient::class.java)
    private val store = mock(CommentFeedbackStore::class.java)
    private val claim = ClaimedFeedback("id","댓글",UUID.randomUUID())

    private fun failed(error: RuntimeException, reason: String, retry: Boolean) {
        `when`(store.claimBatch(0,8)).thenReturn(listOf(claim))
        `when`(ai.classifyBatch(mapOf(claim.id to claim.body))).thenThrow(error)
        CommentFeedbackJob(store,ai).processOne()
        verify(store).fail(claim,reason,retry)
        verifyNoMoreInteractionsAfterClaim()
    }

    private fun verifyNoMoreInteractionsAfterClaim() {
        verify(store).claimBatch(0,8)
        verifyNoMoreInteractions(store)
    }

    @Test fun timeout() = failed(ResourceAccessException("timeout"),"AI_CONNECTION_OR_TIMEOUT",true)
    @Test fun unauthorized() = failed(HttpClientErrorException(HttpStatus.FORBIDDEN),"AI_HTTP_403",false)
    @Test fun missingModel() = failed(HttpServerErrorException(HttpStatus.SERVICE_UNAVAILABLE),"AI_HTTP_503",true)
}
