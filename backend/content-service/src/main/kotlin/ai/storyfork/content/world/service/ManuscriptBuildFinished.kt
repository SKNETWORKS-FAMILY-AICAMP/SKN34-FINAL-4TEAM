package ai.storyfork.content.world.service

import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import java.util.UUID
import org.springframework.context.ApplicationEventPublisher

internal fun ApplicationEventPublisher.updateFinished(job: ManuscriptBuildJob) {
    if (job.kind == "update") publishEvent(ManuscriptBuildFinished(job.id, job.lockVersion, job.workId, job.worldId, job.ownerSubject))
}

data class ManuscriptBuildFinished(val jobId: UUID, val jobVersion: Long, val workId: String, val worldId: UUID, val owner: UUID)
