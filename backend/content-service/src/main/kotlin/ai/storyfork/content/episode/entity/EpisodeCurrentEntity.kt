package ai.storyfork.content.episode.entity

import jakarta.persistence.*
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "episode_current")
@Immutable
class EpisodeCurrentEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "sequence")
    var sequence: Int = 0,
    @field:Column(name = "published_version_id")
    var publishedVersionId: String? = null,
    @field:Column(name = "inherited")
    var inherited: Boolean = false,
    @field:Column(name = "publication_status")
    var publicationStatus: String = if(publishedVersionId==null) "draft" else "published",
)
