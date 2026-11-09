package ai.storyfork.content.fixture

import ai.storyfork.content.auth.client.CoreMemberClient
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResult
import java.util.UUID
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary

/**
 * Core 없이 Spring 컨텍스트를 띄우는 DB 테스트용 닉네임 조회 대역이다. UUID 소유자의 작품 응답은 Core 닉네임을 조회하므로,
 * 요청한 모든 회원에게 [nickname]을 돌려준다. `@Import(CoreMemberFixture::class)`로 옵트인한다.
 */
@TestConfiguration(proxyBeanMethods=false)
class CoreMemberFixture {
    @Bean @Primary
    fun fixtureCoreMemberClient(): CoreMemberClient = object : CoreMemberClient {
        override fun nicknames(body: NicknamesPayload) = NicknamesResult(body.ids.associate { it.toString() to nickname(it) })
    }

    companion object {
        fun nickname(id: UUID) = "작가-${id.toString().take(8)}"
    }
}
