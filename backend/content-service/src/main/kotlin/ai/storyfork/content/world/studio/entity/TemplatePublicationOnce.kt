package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID

@Entity
@Table(name="template_publication_once", schema="worldstudio")
class TemplatePublicationOnce(@Id @Column(name="world_id") val worldId: UUID)
