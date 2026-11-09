package ai.storyfork.content.world.entity

import jakarta.persistence.*
import org.hibernate.annotations.Immutable

@Entity
@Table(name = "setting_reading_detail")
@Immutable
class SettingReadingDetailEntity(
    @field:Id @field:Column(name = "setting_version_id") var settingVersionId: String = "",
    @field:Column(name = "source_key") var sourceKey: String = "",
    @field:Column(name = "wiki_category") var wikiCategory: String = "world",
    var color: String = "#7C8A9E",
    var image: String? = null,
    @field:Column(name = "event_episode") var eventEpisode: Int? = null,
    @field:Column(name = "event_line") var eventLine: String? = null,
    @field:Column(name = "source_basis_episode") var sourceBasisEpisode: Int? = null,
    @field:ElementCollection @field:CollectionTable(name = "setting_reading_property", joinColumns = [JoinColumn(name = "setting_version_id")])
    @field:OrderColumn(name = "position") var properties: MutableList<ReadingProperty> = mutableListOf(),
    @field:ElementCollection @field:CollectionTable(name = "setting_reading_alias", joinColumns = [JoinColumn(name = "setting_version_id")])
    @field:OrderColumn(name = "position") @field:Column(name = "alias") var aliases: MutableList<String> = mutableListOf(),
    @field:ElementCollection @field:CollectionTable(name = "setting_reading_participant", joinColumns = [JoinColumn(name = "setting_version_id")])
    @field:OrderColumn(name = "position") @field:Column(name = "name") var participants: MutableList<String> = mutableListOf(),
    @field:ElementCollection @field:CollectionTable(name = "setting_reading_link", joinColumns = [JoinColumn(name = "setting_version_id")])
    @field:OrderColumn(name = "position") var links: MutableList<ReadingLink> = mutableListOf(),
    @field:ElementCollection @field:CollectionTable(name = "setting_reading_knowledge", joinColumns = [JoinColumn(name = "setting_version_id")])
    @field:OrderColumn(name = "position") var knowledge: MutableList<ReadingKnowledge> = mutableListOf(),
)

@Embeddable
data class ReadingProperty(var episode: Int = 0, var name: String = "", var value: String = "",
    @field:Column(name = "public_from_episode") var publicFromEpisode: Int? = episode)

@Embeddable
data class ReadingLink(@field:Column(name = "target_logical_id") var target: String = "", var kind: String = "")

@Embeddable
data class ReadingKnowledge(
    @field:Column(name = "content") var text: String = "",
    @field:Column(name = "known_at") var knownAt: Int = 1,
    @field:Column(name = "public_at") var publicAt: Int? = null,
)
