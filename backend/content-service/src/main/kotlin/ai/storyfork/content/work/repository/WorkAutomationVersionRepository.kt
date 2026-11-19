package ai.storyfork.content.work.repository

import ai.storyfork.content.work.entity.WorkAutomationVersion
import org.springframework.data.jpa.repository.JpaRepository

interface WorkAutomationVersionRepository : JpaRepository<WorkAutomationVersion, String> {
    fun findAllByWorkIdOrderByRevisionNoDesc(workId: String): List<WorkAutomationVersion>
}
