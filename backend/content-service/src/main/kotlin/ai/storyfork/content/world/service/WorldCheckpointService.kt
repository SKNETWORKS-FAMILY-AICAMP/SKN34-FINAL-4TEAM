package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.entity.WorldCheckpointEntity
import ai.storyfork.content.world.repository.WorldCheckpointRepository
import ai.storyfork.content.world.service.dto.SettingPayload
import ai.storyfork.content.world.service.dto.WorldCheckpointResponse
import ai.storyfork.content.world.service.dto.WorldCheckpointSummary
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import tools.jackson.databind.ObjectMapper

@Service
@Transactional("contentTransactionManager")
class WorldCheckpointService(
    private val access: WorkAccessService,
    private val world: WorldService,
    private val checkpoints: WorldCheckpointRepository,
    private val mapper: ObjectMapper,
) {
    fun create(work: String, owner: String): WorldCheckpointResponse {
        // The work-scoped world read locks the work and authorizes the owner.
        val saved = world.read(work, owner).settings
        val row = checkpoints.save(WorldCheckpointEntity(
            id = contentId(), workId = work, createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS),
            snapshot = mapper.writeValueAsString(saved),
        ))
        return WorldCheckpointResponse(row.id, row.createdAt.toString(), saved)
    }

    fun list(work: String, owner: String): List<WorldCheckpointSummary> {
        access.own(work, owner)
        return checkpoints.findAllByWorkIdOrderByCreatedAtDescIdDesc(work).map { WorldCheckpointSummary(it.id, it.createdAt.toString()) }
    }

    fun read(work: String, owner: String, id: String): WorldCheckpointResponse {
        access.own(work, owner)
        val row = checkpoints.findByWorkIdAndId(work, id) ?: throw ContentFailure(404, "세계관 체크포인트를 찾을 수 없어요.")
        return WorldCheckpointResponse(row.id, row.createdAt.toString(), mapper.readValue(row.snapshot, Array<SettingPayload>::class.java).toList())
    }
}
