package ai.storyfork.content.world.studio.entity

import jakarta.persistence.*

/** 세계관 카드의 카테고리(카드 유형)다. 정본은 이 표이고 카드는 FK 없이 코드로 가리킨다(서비스가 확인, 장르 DEC-56과 같은 방식). 삭제는 없고 숨기기만 한다. */
@Entity
@Table(name="card_category", schema="worldstudio")
class CardCategory(
    @Id @Column(columnDefinition="text") var code: String = "",
    @Column(columnDefinition="text", nullable=false) var name: String = "",
    /** 이름 앞에 보이는 아이콘이다(선택, 최대 8자). */
    @Column(columnDefinition="text") var icon: String? = null,
    /** 숨기면(false) 카드에 새로 고를 수 없다. 이미 그 카테고리를 쓰는 카드는 그대로 보인다. */
    @Column(nullable=false) var active: Boolean = true,
    /** 표시 순서(1부터)다. 운영 화면이 바꾼다. */
    @Column(nullable=false) var position: Int = 0,
)
