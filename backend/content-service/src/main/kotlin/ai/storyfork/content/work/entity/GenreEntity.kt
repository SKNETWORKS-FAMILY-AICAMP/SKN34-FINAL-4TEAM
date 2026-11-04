package ai.storyfork.content.work.entity

import jakarta.persistence.*

@Entity
@Table(name = "genre")
class GenreEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "code")
    var code: String = "",
    @field:Column(name = "name")
    var name: String = "",
)
