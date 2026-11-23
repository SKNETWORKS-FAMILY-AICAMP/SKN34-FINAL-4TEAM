package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.serial.service.SerialService
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
    private val serial = mock(SerialService::class.java)
    private val service = WorkSettingsService(access, versions, serial)
    private val history = mutableListOf<WorkAutomationVersion>()

    private fun wire() {
        `when`(versions.findAllByWorkIdOrderByRevisionNoDesc("work")).thenAnswer { history.toList() }
        `when`(versions.save(any(WorkAutomationVersion::class.java))).thenAnswer {
            it.getArgument<WorkAutomationVersion>(0).also { row -> history.addFirst(row) }
        }
    }

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

    @Test fun `autonomous is accepted and turns AI writing on in the same save`() {
        wire()

        val saved = service.update("work", "owner", UpdateWorkSettingsRequest(0, "autonomous"))

        assertEquals(listOf("autonomous", 1), listOf(saved.current.writingMode, saved.current.revision))
        // 같은 트랜잭션: 소유 확인(작품 잠금) → ai_serial 켜기 → 버전 행. 켜기가 거절되면 버전 행은 남지 않는다.
        val order = inOrder(access, serial, versions)
        order.verify(access).own("work", "owner")
        order.verify(serial).setEnabled("work", true)
        order.verify(versions).save(any(WorkAutomationVersion::class.java))
    }

    @Test fun `any other mode turns AI writing off`() {
        wire()

        service.update("work", "owner", UpdateWorkSettingsRequest(0, "autonomous"))
        service.update("work", "owner", UpdateWorkSettingsRequest(1, "assisted"))
        service.update("work", "owner", UpdateWorkSettingsRequest(2, "direct"))

        verify(serial, times(1)).setEnabled("work", true)
        // 켜짐에서 벗어날 때만이 아니라 방식이 바뀔 때마다 부른다(서비스가 이미 꺼진 상태는 그냥 넘긴다).
        verify(serial, times(2)).setEnabled("work", false)
        assertEquals(listOf("direct", "assisted", "autonomous"), history.map { it.writingMode })
    }

    @Test fun `leaving autonomous while a run is queued or running is refused and saves nothing`() {
        history.add(WorkAutomationVersion(workId = "work", revisionNo = 1, writingMode = "autonomous"))
        wire()
        doThrow(ContentFailure(409, "AI 자율 집필을 실행하는 중이라 집필 방식을 바꿀 수 없어요. 끝난 뒤에 다시 시도해 주세요.", "SERIAL_RUNNING")).`when`(serial).setEnabled("work", false)

        val failure = assertThrows(ContentFailure::class.java) { service.update("work", "owner", UpdateWorkSettingsRequest(1, "assisted")) }

        assertEquals(listOf<Any?>(409, "SERIAL_RUNNING"), listOf(failure.status, failure.code))
        verify(versions, never()).save(any(WorkAutomationVersion::class.java))
        assertEquals(listOf("autonomous"), history.map { it.writingMode })
    }

    @Test fun `a repeated autonomous save and a stale revision leave AI writing alone`() {
        history.add(WorkAutomationVersion(workId = "work", revisionNo = 1, writingMode = "autonomous"))
        wire()

        assertEquals("autonomous", service.update("work", "owner", UpdateWorkSettingsRequest(1, "autonomous")).current.writingMode)
        assertEquals(409, assertThrows(ContentFailure::class.java) { service.update("work", "owner", UpdateWorkSettingsRequest(0, "direct")) }.status)
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.update("work", "owner", UpdateWorkSettingsRequest(1, "autoserial")) }.status)

        verifyNoInteractions(serial)
        verify(versions, never()).save(any(WorkAutomationVersion::class.java))
    }

    @Test fun `access denial precedes repository access`() {
        `when`(access.own("work", "other")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))

        assertThrows(ContentFailure::class.java) { service.read("work", "other") }
        assertThrows(ContentFailure::class.java) { service.update("work", "other", UpdateWorkSettingsRequest(0, "direct")) }
        verifyNoInteractions(versions, serial)
    }
}
