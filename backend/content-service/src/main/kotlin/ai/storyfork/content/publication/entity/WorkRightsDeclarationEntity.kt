package ai.storyfork.content.publication.entity

import jakarta.persistence.*
import java.time.Instant

@Entity
@Table(name = "work_rights_declaration")
class WorkRightsDeclarationEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "work_id")
    var workId: String = "",
    @field:Column(name = "member_id")
    var memberId: String = "",
    @field:Column(name = "notice_version")
    var noticeVersion: String = "",
    @field:Column(name = "response")
    var response: String = "",
    @field:Column(name = "confirmed_at")
    var confirmedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
