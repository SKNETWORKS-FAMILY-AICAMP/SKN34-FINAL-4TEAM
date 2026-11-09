package ai.storyfork.content.proposal.repository

import ai.storyfork.content.proposal.entity.AiThreadEntity
import org.springframework.data.jpa.repository.JpaRepository

interface AiThreadRepository : JpaRepository<AiThreadEntity,String>
