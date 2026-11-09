package ai.storyfork.content.like

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.like.entity.WorkLikeEntity
import ai.storyfork.content.like.repository.WorkLikeRepository
import ai.storyfork.content.like.service.WorkLikeService
import ai.storyfork.content.like.service.dto.WorkLikeResponse
import ai.storyfork.content.work.service.WorkAccessService
import java.math.BigInteger
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.jupiter.MockitoExtension
import org.springframework.dao.DataIntegrityViolationException

@ExtendWith(MockitoExtension::class)
class WorkLikeServiceTest {
    @Mock lateinit var access: WorkAccessService
    @Mock lateinit var likes: WorkLikeRepository
    @InjectMocks lateinit var service: WorkLikeService

    private val key = WorkLikeEntity.Key("work", "reader")
    private fun anyEntity() = ArgumentMatchers.any(WorkLikeEntity::class.java) ?: WorkLikeEntity()
    private fun storing() { `when`(likes.saveAndFlush(anyEntity())).thenAnswer { it.arguments[0] } }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `first like is stored for the member and returns the new count`() {
        storing()
        `when`(likes.countByWorkId("work")).thenReturn(3)

        assertEquals(WorkLikeResponse(3, true), service.like("work", "reader"))

        val saved = ArgumentCaptor.forClass(WorkLikeEntity::class.java)
        verify(likes).saveAndFlush(saved.capture() ?: WorkLikeEntity())
        assertEquals(listOf("work", "reader"), listOf(saved.value.workId, saved.value.memberId))
        verify(access).published("work")
    }

    @Test fun `repeat like stores nothing and stays liked`() {
        `when`(likes.existsById(key)).thenReturn(true)
        `when`(likes.countByWorkId("work")).thenReturn(1)

        assertEquals(WorkLikeResponse(1, true), service.like("work", "reader"))

        verify(likes, never()).saveAndFlush(anyEntity())
    }

    @Test fun `a work owner may like their own public work`() {
        storing()
        `when`(likes.countByWorkId("work")).thenReturn(1)

        assertEquals(WorkLikeResponse(1, true), service.like("work", "owner"))

        verify(likes).saveAndFlush(anyEntity())
        verify(access, never()).own("work", "owner")
    }

    @Test fun `private or missing work is 404 before any like lookup`() {
        `when`(access.published("work")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.like("work", "reader") }.status)
        assertEquals(404, failure { service.unlike("work", "reader") }.status)

        verifyNoInteractions(likes)
    }

    @Test fun `blank member is rejected as unauthenticated before any lookup`() {
        assertEquals(401, failure { service.like("work", " ") }.status)
        assertEquals(401, failure { service.unlike("work", " ") }.status)

        verifyNoInteractions(access, likes)
    }

    @Test fun `a concurrent duplicate insert is ignored once the row exists`() {
        `when`(likes.existsById(key)).thenReturn(false, true)
        `when`(likes.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("duplicate key"))
        `when`(likes.countByWorkId("work")).thenReturn(2)

        assertEquals(WorkLikeResponse(2, true), service.like("work", "reader"))

        verify(likes, times(2)).existsById(key)
    }

    @Test fun `other integrity failures are not swallowed`() {
        `when`(likes.saveAndFlush(anyEntity())).thenThrow(DataIntegrityViolationException("foreign key"))

        assertThrows(DataIntegrityViolationException::class.java) { service.like("work", "reader") }
    }

    @Test fun `unlike removes the member's like and returns the new count`() {
        `when`(likes.countByWorkId("work")).thenReturn(2)

        assertEquals(WorkLikeResponse(2, false), service.unlike("work", "reader"))

        verify(likes).deleteLike("work", "reader")
        verify(access).published("work")
    }

    @Test fun `counts map the aggregate rows of the requested works only`() {
        `when`(likes.countByWork(listOf("a", "b", "c"))).thenReturn(listOf(arrayOf<Any>("a", 3L), arrayOf<Any>("c", BigInteger.TWO)))

        assertEquals(mapOf("a" to 3L, "c" to 2L), service.counts(listOf("a", "b", "c")))
    }

    @Test fun `counts for no works skip the query`() {
        assertEquals(emptyMap<String, Long>(), service.counts(emptyList()))

        verifyNoInteractions(likes)
    }

    @Test fun `liked tells whether this member pressed like`() {
        `when`(likes.existsById(key)).thenReturn(true)

        assertTrue(service.liked("work", "reader"))
        assertFalse(service.liked("work", "other"))
    }
}
