package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldApplicationItem
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldApplicationItemRepository : JpaRepository<InitialWorldApplicationItem, UUID>
