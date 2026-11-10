package ai.storyfork.content.work.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "work")
class WorkEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "owner_id")
    var ownerId: String = "",
    @field:Column(name = "title")
    var title: String = "",
    @field:Column(name = "description")
    var description: String = "",
    @field:Column(name = "origin_kind")
    var originKind: String = "",
    @field:Column(name = "revision")
    var revision: Int = 0,
    @field:Column(name = "deleted_episode_revision")
    var deletedEpisodeRevision: Int = 0,
    @field:Column(name = "created_at")
    var createdAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
    @field:Column(name = "audience_rating")
    var audienceRating: String? = null,
    @field:Column(name = "creation_type")
    var creationType: String = "original",
    @field:Column(name = "restricted")
    var restricted: Boolean = false,
    @field:Column(name = "slug") var slug: String? = null,
    // 읽지 않는 칼럼이다. 작가명은 소유자의 Core 닉네임이며, 샘플 SQL·생성 경로 호환을 위해서만 남긴다.
    @field:Column(name = "author_name") var authorName: String = "작성자",
    @field:Column(name = "theme") var theme: String = "star",
    @field:Column(name = "hook") var hook: String = "",
    @field:Column(name = "hanja") var hanja: String? = null,
    @field:Column(name = "hero_line1") var heroLine1: String? = null,
    @field:Column(name = "hero_line2") var heroLine2: String? = null,
    @field:Column(name = "hero_background") var heroBackground: String? = null,
)
