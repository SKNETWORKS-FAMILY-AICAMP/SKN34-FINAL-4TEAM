package ai.storyfork.operations._common

import ai.storyfork.operations._common.client.ContentOperationsStats
import ai.storyfork.operations._common.client.LeakReferences
import ai.storyfork.operations._common.client.MemberStats
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** 다른 서비스가 같은 모양으로 구현하는 내부 응답을 그대로 읽는지 고정한다(계약의 필드 이름). */
class LlmopsClientDtoTest {
    private val mapper = jacksonMapperBuilder().build()

    @Test
    fun `Core member stats read total joined and withdrawal pending`() {
        val stats = mapper.readValue("""{"total":120,"joinedLast7Days":9,"withdrawalPending":2}""", MemberStats::class.java)

        assertEquals(MemberStats(120, 9, 2), stats)
    }

    @Test
    fun `Content operations stats read pending counts and the two decision ratios`() {
        val stats = mapper.readValue(
            """{"pendingFeedbackReports":4,"pendingEditSuggestions":6,"proposalDecisions":{"adopted":30,"total":50},"editSuggestions":{"approved":8,"decided":10}}""",
            ContentOperationsStats::class.java,
        )

        assertEquals(4L, stats.pendingFeedbackReports)
        assertEquals(6L, stats.pendingEditSuggestions)
        assertEquals(30L to 50L, stats.proposalDecisions.adopted to stats.proposalDecisions.total)
        assertEquals(8L to 10L, stats.editSuggestions.approved to stats.editSuggestions.decided)
    }

    @Test
    fun `Content leak references read the origin and both title lists`() {
        val refs = mapper.readValue(
            """{"originWorkId":"w-origin","privateCardTitles":["한서진","별빛 열쇠"],"unpublishedEpisodeTitles":["12화 진실"]}""", LeakReferences::class.java,
        )

        assertEquals("w-origin", refs.originWorkId)
        assertEquals(listOf("한서진", "별빛 열쇠"), refs.privateCardTitles)
        assertEquals(listOf("12화 진실"), refs.unpublishedEpisodeTitles)
    }
}
