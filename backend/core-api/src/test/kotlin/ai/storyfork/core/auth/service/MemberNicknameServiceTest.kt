package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyIterable
import org.mockito.Mockito.mock
import org.mockito.Mockito.verifyNoInteractions
import org.mockito.Mockito.`when`

/** 내부 닉네임 조회 규칙을 저장소 대역으로 검증한다. 서비스 자격·HTTP 경로는 CI의 InternalAuthVerificationIntegrationTest가 확인한다. */
class MemberNicknameServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val service = MemberNicknameService(members)
    private val reader = AuthMember(UUID.randomUUID(), "reader@example.test", "hash", "Reader")
    // 이용 제한 회원도 작성한 글의 표시명은 남으므로 닉네임을 돌려준다.
    private val restricted = AuthMember(UUID.randomUUID(), "r@example.test", "hash", "제한 회원", restricted = true)
    private val queries = mutableListOf<Set<UUID>>()
    private val canonical = "5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01"

    init {
        // 저장소 대역: 요청한 id 중 존재하는 회원만 돌려주고, 어떤 id로 몇 번 물었는지 기록한다.
        `when`(members.findAllById(anyIterable<UUID>())).thenAnswer { call ->
            val wanted = call.getArgument<Iterable<UUID>>(0).toSet()
            queries += wanted
            listOf(reader, restricted).filter { it.id in wanted }
        }
    }

    private fun reason(ids: List<String?>) = assertThrows(AuthException::class.java) { service.nicknames(ids) }.reason

    @Test
    fun `returns the latest nickname of existing members only and includes restricted members`() {
        val unknown = UUID.randomUUID()

        val found = service.nicknames(listOf(reader.id, restricted.id, unknown).map { it.toString() }).nicknames

        assertEquals(mapOf(reader.id.toString() to "Reader", restricted.id.toString() to "제한 회원"), found)
        // 닉네임을 바꾸면 다음 조회에 바로 반영된다(캐시 없음).
        reader.nickname = "새 닉네임"
        assertEquals("새 닉네임", service.nicknames(listOf(reader.id.toString())).nicknames.getValue(reader.id.toString()))
    }

    @Test
    fun `duplicate ids are allowed and queried once`() {
        val id = reader.id.toString()

        assertEquals(mapOf(id to "Reader"), service.nicknames(listOf(id, id, id)).nicknames)

        assertEquals(listOf(setOf(reader.id)), queries)
    }

    @Test
    fun `an empty list is an empty map`() {
        assertEquals(emptyMap<String, String>(), service.nicknames(emptyList()).nicknames)
    }

    @Test
    fun `more than 200 ids are 400 without querying while exactly 200 are allowed`() {
        assertEquals(AuthException.Reason.INVALID, reason(List(201) { UUID.randomUUID().toString() }))
        verifyNoInteractions(members)

        assertEquals(emptyMap<String, String>(), service.nicknames(List(200) { UUID.randomUUID().toString() }).nicknames)
    }

    @Test
    fun `null, blank, malformed and non canonical UUIDs are 400 and nothing is queried`() {
        for (bad in listOf(null, "", " ", "not-a-uuid", "1-1-1-1-1", canonical.uppercase(), " $canonical")) {
            assertEquals(AuthException.Reason.INVALID, reason(listOf(canonical, bad)), "$bad")
        }
        verifyNoInteractions(members)
    }
}
