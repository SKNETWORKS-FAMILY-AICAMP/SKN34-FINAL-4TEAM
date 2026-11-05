package ai.storyfork.content.attachment.entity

import jakarta.persistence.*
import org.hibernate.annotations.Immutable

@Entity
@Immutable
@Table(name = "world")
open class AttachmentWorld(
    @Id @Column(length = 36) open var id: String = "",
    @Column(name = "owner_id", length = 200) open var ownerId: String = "",
)
