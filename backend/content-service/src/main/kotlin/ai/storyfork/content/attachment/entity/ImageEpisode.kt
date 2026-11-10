package ai.storyfork.content.attachment.entity

import jakarta.persistence.*
import org.hibernate.annotations.Immutable

/** 이미지 업로드 잠금 이후 삭제되지 않은 회차를 확인하는 읽기 전용 매핑. */
@Entity
@Immutable
@Table(name="episode_current")
class ImageEpisode(
    @field:Id var id: String = "",
    @field:Column(name="work_id") var workId: String = "",
    @field:Column(name="sequence") var sequence: Int = 0,
)
