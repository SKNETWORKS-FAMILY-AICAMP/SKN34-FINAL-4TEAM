package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.TemplatePublicationOnce
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface TemplatePublicationOnceRepository : JpaRepository<TemplatePublicationOnce, UUID>
