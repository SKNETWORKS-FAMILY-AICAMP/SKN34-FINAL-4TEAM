package ai.storyfork.operations.work

import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Content `work.owner_id` is a varchar, so one non-UUID owner must not make the whole list unreadable (which surfaces as 502). */
class OperationsWorkListJsonTest {
    @Test
    fun `list with a non-UUID ownerId still deserializes`() {
        val id = UUID.randomUUID()
        val json = """
            {"items":[{"workId":"$id","ownerId":"ops-list-owner","title":"작품","authorName":"작가","originKind":"original",
            "creationType":"original","rightsConfirmed":false,"visibility":"private","restricted":false}]}
        """.trimIndent()

        val work = jacksonMapperBuilder().build().readValue(json, OperationsWorkList::class.java).items.single()

        assertEquals(id, work.workId)
        assertEquals("ops-list-owner", work.ownerId)
    }
}
