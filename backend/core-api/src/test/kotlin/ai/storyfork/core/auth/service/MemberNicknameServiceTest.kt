package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.NicknamesRequest
import jakarta.validation.Validation
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`

class MemberNicknameServiceTest {
    private val members = mock(MemberRepository::class.java)
    private val service = MemberNicknameService(members)
    private val reader = AuthMember(UUID.randomUUID(), "reader@example.test", "hash", "독자")
    private val blocked = AuthMember(UUID.randomUUID(), "blocked@example.test", "hash", "제한 회원", restricted = true)

    @Test fun `returns each existing member nickname by id and leaves unknown ids out`() {
        val unknown = UUID.randomUUID()
        `when`(members.findAllById(setOf(reader.id, blocked.id, unknown))).thenReturn(listOf(reader, blocked))

        val result = service.nicknames(listOf(reader.id, blocked.id, unknown))

        // 제한 회원도 작가 표시명은 그대로 돌려준다. 공개 여부는 Content가 판단한다.
        assertEquals(mapOf(reader.id to "독자", blocked.id to "제한 회원"), result.nicknames)
        assertTrue(unknown !in result.nicknames)
    }

    @Test fun `duplicate ids are looked up once`() {
        `when`(members.findAllById(setOf(reader.id))).thenReturn(listOf(reader))

        assertEquals(mapOf(reader.id to "독자"), service.nicknames(listOf(reader.id, reader.id)).nicknames)
        verify(members).findAllById(setOf(reader.id))
    }

    @Test fun `request accepts one to two hundred ids and nothing else`() {
        Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            fun ids(count: Int) = NicknamesRequest(List(count) { UUID.randomUUID() })
            assertTrue(validator.validate(ids(1)).isEmpty())
            assertTrue(validator.validate(ids(200)).isEmpty())
            for (count in listOf(0, 201)) {
                assertEquals(setOf("ids"), validator.validate(ids(count)).map { it.propertyPath.toString() }.toSet(), "count=$count")
            }
        }
    }
}
