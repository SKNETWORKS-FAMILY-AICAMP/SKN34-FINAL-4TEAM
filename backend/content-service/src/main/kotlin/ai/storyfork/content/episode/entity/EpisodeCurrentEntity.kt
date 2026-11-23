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
    @field:Column(name = "draft_revision_floor")
    var draftRevisionFloor: Int = -1,
    /** 운영 제한 여부다. 뷰가 자기 회차의 제한과, 물려받은 원작 회차의 제한을 합쳐 계산한다(V46). */
    @field:Column(name = "restricted")
    var restricted: Boolean = false,
) {
    /**
     * 독자가 열 수 있는 발행 버전이다. 발행본이 있고 운영 제한이 없을 때만 있다. 독자 쪽 경로(열람·조회수·독서 기록·댓글·수정 제안·제보)는 모두 이 값을 쓰고,
     * 작가 쪽(집필·발행·목록)은 제한과 무관하게 [publishedVersionId]를 그대로 쓴다.
     */
    val readerVersionId: String? get() = publishedVersionId.takeUnless { restricted }
}
