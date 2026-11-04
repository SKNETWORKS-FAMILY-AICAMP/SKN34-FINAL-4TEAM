package ai.storyfork.content.proposal.entity

import jakarta.persistence.*

@Entity
@Table(name = "proposal_episode_change")
class ProposalEpisodeChangeEntity(
    @field:Id @field:Column(name = "id")
    var id: String = "",
    @field:Column(name = "application_id")
    var applicationId: String = "",
    @field:Column(name = "episode_id")
    var episodeId: String = "",
    @field:Column(name = "result_version_id")
    var resultVersionId: String? = null,
    @field:Column(name = "position")
    var position: String? = null,
    @field:Column(name = "before_content")
    var beforeContent: String = "",
    @field:Column(name = "after_content")
    var afterContent: String = "",
    @field:Column(name = "base_draft_revision")
    var baseDraftRevision: Int = 0,
    @field:Column(name = "result_draft_revision")
    var resultDraftRevision: Int = 0,
)
