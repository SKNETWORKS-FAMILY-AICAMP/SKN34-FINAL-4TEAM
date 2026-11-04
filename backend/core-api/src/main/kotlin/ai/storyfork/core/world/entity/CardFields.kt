package ai.storyfork.core.world.entity

import jakarta.persistence.*
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes

@Embeddable
class CardFields(
    @Column(columnDefinition="text", nullable=false) var title: String = "",
    @Column(columnDefinition="text", nullable=false) var body: String = "",
    @Column(name="card_type", columnDefinition="text", nullable=false) var cardType: String = "other",
    @Column(name="area_code", columnDefinition="text", nullable=false) var areaCode: String = "basic",
    @Column(columnDefinition="text", nullable=false) var classification: String = "",
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(columnDefinition="text[]", nullable=false) var aliases: List<String> = emptyList(),
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(columnDefinition="text[]", nullable=false) var tags: List<String> = emptyList(),
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="semantic_metadata", columnDefinition="jsonb", nullable=false) var semanticMetadata: Map<String,Any?> = emptyMap(),
    @Column(columnDefinition="text", nullable=false) var visibility: String = "private",
    @Column(columnDefinition="text", nullable=false) var lifecycle: String = "active"
)
