package ai.storyfork.core.contentimage.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

/** 표지는 회차 0, 본문 이미지는 실제 회차에 귀속한다. 본문 이미지는 저장 버전 보존을 위해 불변이다. */
@Entity
@Table(name = "content_image")
open class ContentImage(
    @Id @Column(length = 36) open var id: String = UUID.randomUUID().toString(),
    @Column(name = "work_id", length = 36, nullable = false) open var workId: String = "",
    @Column(name = "episode_no", nullable = false) open var episodeNo: Int = 0,
    @Column(name = "object_key", nullable = false) open var objectKey: String = "",
    @Column(nullable = false, length = 120) open var filename: String = "",
    @Column(name = "media_type", nullable = false, length = 20) open var mediaType: String = "",
    @Column(name = "byte_size", nullable = false) open var byteSize: Long = 0,
    @Column(name = "created_at", nullable = false) open var createdAt: Instant = Instant.now(),
)
