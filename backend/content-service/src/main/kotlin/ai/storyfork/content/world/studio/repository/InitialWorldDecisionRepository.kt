package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldDecision
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldDecisionRepository : JpaRepository<InitialWorldDecision, UUID>
