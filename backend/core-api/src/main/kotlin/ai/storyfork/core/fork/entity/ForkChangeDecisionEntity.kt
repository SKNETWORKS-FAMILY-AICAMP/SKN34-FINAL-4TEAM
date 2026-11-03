package ai.storyfork.core.fork.entity

import jakarta.persistence.*
import java.time.Instant
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "fork_change_decision")
@Immutable
class ForkChangeDecisionEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "source_change_id")
    var sourceChangeId: String = "",
    @field:Column(name = "actor_id")
    var actorId: String = "",
    @field:Column(name = "decision")
    var decision: String = "",
    @field:Column(name = "decided_at")
    var decidedAt: Instant = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS),
)
