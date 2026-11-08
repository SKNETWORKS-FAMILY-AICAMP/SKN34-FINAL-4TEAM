package ai.storyfork.content.work

import ai.storyfork.content.work.service.dto.WorkResponse
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class WorkReadingContractTest {
    @Test fun `canonical reading response exposes identity metadata revision and episode scoped policy`() {
        val fields=WorkResponse::class.java.declaredFields.map {it.name}.toSet()
        assertTrue(fields.containsAll(setOf("slug","authorName","ownerId","revision","theme","forkableEpisodes")),
            "The reading adapter must not invent author identity or fork permissions")
    }
}
