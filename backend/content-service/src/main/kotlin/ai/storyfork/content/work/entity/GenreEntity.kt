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
    /** 숨기면(false) 새로 고를 수 없다. 이미 붙은 작품·세계관은 그대로 보인다(DEC-56). */
    @field:Column(name = "active")
    var active: Boolean = true,
    /** 표시 순서(1부터)다. 운영 화면이 바꾼다. */
    @field:Column(name = "position")
    var position: Int = 0,
    /** 홈 장르 칩에 보인다. 활성이면서 켠 장르는 최대 6개다. */
    @field:Column(name = "featured")
    var featured: Boolean = false,
    /** 칩 앞 아이콘이다(선택, 최대 8자). */
    @field:Column(name = "emoji")
    var emoji: String? = null,
)
