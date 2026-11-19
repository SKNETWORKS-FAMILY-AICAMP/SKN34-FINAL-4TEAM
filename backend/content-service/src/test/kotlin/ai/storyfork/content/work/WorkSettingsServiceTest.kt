package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.entity.WorkAutomationVersion
import ai.storyfork.content.work.repository.WorkAutomationVersionRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkSettingsService
import ai.storyfork.content.work.service.dto.UpdateWorkSettingsRequest
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class WorkSettingsServiceTest {
    private val access = mock(WorkAccessService::class.java)
    private val versions = mock(WorkAutomationVersionRepository::class.java)
    private val service = WorkSettingsService(access, versions)

    @Test fun `work without a saved preference has review and manual defaults`() {
        val settings = service.read("work", "owner")

        assertNull(settings.current.writingMode)
        assertEquals(0, settings.current.revision)
        assertEquals("manual", settings.worldUpdateMode)
        assertEquals("review", settings.proofreadingMode)
        assertEquals("off", settings.autoserialState)
        assertTrue(settings.history.isEmpty())
        verify(access).own("work", "owner")
    }

    @Test fun `save appends a version and repeated values leave history untouched`() {
        val history = mutableListOf<WorkAutomationVersion>()
        `when`(versions.findAllByWorkIdOrderByRevisionNoDesc("work")).thenAnswer { history.toList() }
        `when`(versions.save(any(WorkAutomationVersion::class.java))).thenAnswer {
            it.getArgument<WorkAutomationVersion>(0).also { row -> history.addFirst(row) }
        }

        assertEquals("direct", service.update("work", "owner", UpdateWorkSettingsRequest(0, "direct")).current.writingMode)
        val changed = service.update("work", "owner", UpdateWorkSettingsRequest(1, "assisted"))
        assertEquals(2, changed.current.revision)
        assertEquals(listOf("assisted", "direct"), changed.history.map { it.writingMode })
        assertEquals(changed, service.update("work", "owner", UpdateWorkSettingsRequest(2, "assisted")))
        verify(versions, times(2)).save(any(WorkAutomationVersion::class.java))
    }

    @Test fun `stale revisions and unsupported modes cannot be saved`() {
        `when`(versions.findAllByWorkIdOrderByRevisionNoDesc("work"))
            .thenReturn(listOf(WorkAutomationVersion(workId = "work", revisionNo = 1, writingMode = "direct")))

        assertEquals(409, assertThrows(ContentFailure::class.java) {
            service.update("work", "owner", UpdateWorkSettingsRequest(0, "assisted"))
        }.status)
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            service.update("work", "owner", UpdateWorkSettingsRequest(1, "autoserial"))
        }.status)
        verify(versions, never()).save(any(WorkAutomationVersion::class.java))
    }

    @Test fun `access denial precedes repository access`() {
        `when`(access.own("work", "other")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))

        assertThrows(ContentFailure::class.java) { service.read("work", "other") }
        assertThrows(ContentFailure::class.java) { service.update("work", "other", UpdateWorkSettingsRequest(0, "direct")) }
        verifyNoInteractions(versions)
    }
}
