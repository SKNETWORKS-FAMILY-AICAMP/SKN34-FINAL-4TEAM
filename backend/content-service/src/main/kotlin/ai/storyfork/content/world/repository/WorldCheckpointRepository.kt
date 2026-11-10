package ai.storyfork.content.world.repository

import ai.storyfork.content.world.entity.WorldCheckpointEntity
import java.time.Instant
import org.springframework.data.jpa.repository.JpaRepository

interface WorldCheckpointRepository : JpaRepository<WorldCheckpointEntity, String> {
    interface Summary {
        val id: String
        val createdAt: Instant
    }

    fun findAllByWorkIdOrderByCreatedAtDescIdDesc(workId: String): List<Summary>
    fun findByWorkIdAndId(workId: String, id: String): WorldCheckpointEntity?
}
