package ai.storyfork.content.work

import ai.storyfork.content.auth.client.CoreAuthClient
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.InternalWorkService
import ai.storyfork.content.work.service.dto.OperationsWorkListResponse
import ai.storyfork.content.work.service.dto.OperationsWorkResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*

/** 운영 작품 목록 매핑을 저장소·Core 닉네임 mock으로 검증한다. 실제 SQL·HTTP는 InternalWorkListPostgresTest가 CI에서 확인한다. */
class InternalWorkListTest {
    private val works = mock(WorkRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = InternalWorkService(works, nicknames)

    /** 저장된 author_name 칼럼과 다른 값이 보이면 Core 닉네임이 아닌 칼럼을 쓴 것이다. */
    private fun row(id: String, owner: String) =
        arrayOf<Any?>(WorkEntity(id = id, ownerId = owner, title = id, originKind = "original", creationType = "original", authorName = "저장된 이름-$id"), true, "public")

    @Test fun `list maps every row in repository order with one query and shows each owner's Core nickname instead of the stored author name`() {
        val original = WorkEntity(id = "w1", ownerId = "o1", title = "가", originKind = "original", creationType = "original", authorName = "저장된 이름1")
        val fork = WorkEntity(id = "w2", ownerId = "o2", title = "나", originKind = "fork", creationType = "external_derivative", restricted = true, authorName = "저장된 이름2")
        `when`(works.listForOperations()).thenReturn(listOf(arrayOf<Any?>(original, true, "public"), arrayOf<Any?>(fork, false, null)))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenReturn(mapOf("o1" to "코어1", "o2" to "코어2"))

        assertEquals(
            OperationsWorkListResponse(listOf(
                OperationsWorkResponse("w1", "o1", "가", "코어1", "original", "original", true, "public", false),
                OperationsWorkResponse("w2", "o2", "나", "코어2", "fork", "external_derivative", false, "private", true),
            )),
            service.list(),
        )
        verify(works).listForOperations()
        verifyNoMoreInteractions(works)
    }

    @Test fun `soft deleted works are left out of the operations list`() {
        val gone = WorkEntity(id = "gone", ownerId = "o1", title = "삭제", deletedAt = java.time.Instant.now())
        `when`(works.listForOperations()).thenReturn(listOf(row("w1", "o1"), arrayOf<Any?>(gone, true, "public")))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenReturn(mapOf("o1" to "코어1"))

        assertEquals(listOf("w1"), service.list().items.map { it.workId })
    }

    @Test fun `an owner Core does not know is shown as a withdrawn member`() {
        `when`(works.listForOperations()).thenReturn(listOf(row("w1", "o1"), row("w2", "gone")))
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenReturn(mapOf("o1" to "코어1"))

        assertEquals(listOf("코어1", WITHDRAWN_MEMBER_NAME), service.list().items.map { it.authorName })
    }

    @Test fun `all owners of the list are looked up from Core in a single call`() {
        `when`(works.listForOperations()).thenReturn(listOf(row("w1", "o1"), row("w2", "o2"), row("w3", "o1")))
        val asked = mutableListOf<Collection<*>>()
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            asked += call.arguments[0] as Collection<*>
            mapOf("o1" to "코어1", "o2" to "코어2")
        }

        assertEquals(listOf("코어1", "코어2", "코어1"), service.list().items.map { it.authorName })
        assertEquals(setOf("o1", "o2"), asked.single().toSet())
    }

    @Test fun `a Core failure fails the list and is never replaced by a name`() {
        `when`(works.listForOperations()).thenReturn(listOf(row("w1", "o1")))
        val failure = CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다.")
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenThrow(failure)

        assertSame(failure, assertThrows(CoreAuthException::class.java) { service.list() })
    }

    @Test fun `no works is an empty items list and Core is not called`() {
        val core = mock(CoreAuthClient::class.java)
        `when`(works.listForOperations()).thenReturn(emptyList())

        assertEquals(OperationsWorkListResponse(emptyList()), InternalWorkService(works, CoreNicknameService(core)).list())
        verifyNoInteractions(core)
    }
}
