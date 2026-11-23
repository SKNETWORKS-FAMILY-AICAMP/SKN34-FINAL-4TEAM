package ai.storyfork.content.serial.entity

import jakarta.persistence.*

/** 회원이 제안 글에 누른 추천 하나다. 글마다 회원당 한 번이고 취소는 이 행의 삭제다. */
@Entity
@Table(name = "serial_proposal_like")
@IdClass(SerialProposalLikeEntity.Key::class)
class SerialProposalLikeEntity(
    @field:Id @field:Column(name = "proposal_id")
    var proposalId: String = "",
    @field:Id @field:Column(name = "member_id")
    var memberId: String = "",
) {
    data class Key(var proposalId: String = "", var memberId: String = "") : java.io.Serializable
}
