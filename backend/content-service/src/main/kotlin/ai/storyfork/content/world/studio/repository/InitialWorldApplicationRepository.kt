package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldApplication
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldApplicationRepository : JpaRepository<InitialWorldApplication, UUID>
