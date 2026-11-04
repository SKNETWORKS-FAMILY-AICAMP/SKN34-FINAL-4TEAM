package ai.storyfork.core.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Embeddable
class RelationshipFields(
    @Column(name="source_card_id") var sourceCardId: UUID? = null,
    @Column(name="target_card_id") var targetCardId: UUID? = null,
    @Column(columnDefinition="text") var category: String? = null,
    @Column(columnDefinition="text", nullable=false) var body: String = "",
    @Column(columnDefinition="text", nullable=false) var label: String = "",
    @Column(columnDefinition="text") var direction: String? = null,
    @Column(columnDefinition="text") var polarity: String? = null,
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="semantic_metadata", columnDefinition="jsonb", nullable=false) var semanticMetadata: Map<String,Any?> = emptyMap(),
    @Column(columnDefinition="text", nullable=false) var lifecycle: String = "active"
)
