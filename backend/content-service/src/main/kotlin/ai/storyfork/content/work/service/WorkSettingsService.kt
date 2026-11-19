package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.work.entity.WorkAutomationVersion
import ai.storyfork.content.work.repository.WorkAutomationVersionRepository
import ai.storyfork.content.work.service.dto.UpdateWorkSettingsRequest
import ai.storyfork.content.work.service.dto.WorkSettingsResponse
import ai.storyfork.content.work.service.dto.WorkSettingsVersionResponse
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.temporal.ChronoUnit

@Service
@Transactional(transactionManager = "contentTransactionManager")
class WorkSettingsService(
    private val access: WorkAccessService,
    private val versions: WorkAutomationVersionRepository,
) {
    fun read(id: String, owner: String): WorkSettingsResponse {
        access.own(id, owner)
        return response(versions.findAllByWorkIdOrderByRevisionNoDesc(id))
    }

    fun update(id: String, owner: String, request: UpdateWorkSettingsRequest): WorkSettingsResponse {
        access.own(id, owner)
        val revision = request.revision?.takeIf { it >= 0 }
            ?: throw ContentFailure(422, "설정 버전을 확인해 주세요.")
        val mode = request.writingMode?.takeIf { it == "direct" || it == "assisted" }
            ?: throw ContentFailure(422, "집필 방식을 확인해 주세요.")
        val rows = versions.findAllByWorkIdOrderByRevisionNoDesc(id)
        val latest = rows.firstOrNull()
        checkContent(revision == (latest?.revisionNo ?: 0), 409, "다른 곳에서 운영 설정을 변경했어요. 최신 설정을 다시 불러와 주세요.")
        if (latest?.writingMode == mode) return response(rows)

        val saved = versions.save(WorkAutomationVersion(contentId(), id, revision + 1, mode, Instant.now().truncatedTo(ChronoUnit.MICROS)))
        return response(listOf(saved) + rows)
    }

    private fun response(rows: List<WorkAutomationVersion>): WorkSettingsResponse {
        val history = rows.map { WorkSettingsVersionResponse(it.revisionNo, it.writingMode, it.changedAt.toString()) }
        return WorkSettingsResponse(history.firstOrNull() ?: WorkSettingsVersionResponse(0, null, null), history)
    }
}
