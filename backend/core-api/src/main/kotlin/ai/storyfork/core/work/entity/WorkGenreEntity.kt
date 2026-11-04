package ai.storyfork.core.work.entity

import jakarta.persistence.*

@Entity
@Table(name = "work_genre")
@IdClass(WorkGenreEntity.Key::class)
class WorkGenreEntity(
    @field:Id @field:Column(name = "work_id")
    var workId: String = "",
    @field:Id @field:Column(name = "genre_id")
    var genreId: String = "",
) {
    data class Key(var workId: String = "", var genreId: String = "") : java.io.Serializable
}
