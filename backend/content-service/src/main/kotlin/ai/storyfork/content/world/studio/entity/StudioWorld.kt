package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*
import java.util.UUID
import java.time.Instant

@Entity
@Table(name="world", schema="worldstudio")
class StudioWorld(
    @Id var id: UUID = UUID.randomUUID(),
    @Column(name="owner_subject", nullable=false) val ownerSubject: UUID,
    @Column(name="current_revision_id") var currentRevisionId: UUID? = null,
    @Column(name="created_at", nullable=false) val createdAt: Instant = Instant.now(),
    /** 세계관 단위 공개 범위(private|public). 기본은 비공개다(DEC-45). */
    @Column(columnDefinition="text", nullable=false) var visibility: String = "private",
    /** 공개 목록 필터용 장르 코드. 미지정은 null이다. */
    @Column(columnDefinition="text") var genre: String? = null,
    /** 마지막으로 공개된 시각. 비공개이면 null이다. */
    @Column(name="published_at") var publishedAt: Instant? = null,
    /** 소유자가 올린 표지 이미지의 객체 저장소 키(V7). 표지가 없으면 null이며 [coverContentType]과 함께 있거나 함께 없다. */
    @Column(name="cover_object_key", columnDefinition="text") var coverObjectKey: String? = null,
    /** 표지 이미지 형식(image/png·image/jpeg·image/webp). 업로드 바이트의 시그니처가 정한다. */
    @Column(name="cover_content_type", columnDefinition="text") var coverContentType: String? = null,
)
