package ai.storyfork.content.notice.repository

import ai.storyfork.content.notice.entity.WorkNoticeEntity
import org.springframework.data.jpa.repository.JpaRepository

interface WorkNoticeRepository : JpaRepository<WorkNoticeEntity, String> {
    /** 삭제되지 않은 작품 소식을 고정 먼저, 그 안에서 최신순(같은 시각은 id 역순)으로 최대 200개 돌려준다. */
    fun findTop200ByWorkIdAndDeletedAtIsNullOrderByPinnedDescCreatedAtDescIdDesc(workId: String): List<WorkNoticeEntity>

    /** 삭제되지 않은 소식 하나다. 작품이 다르면 없는 것으로 본다. */
    fun findByIdAndWorkIdAndDeletedAtIsNull(id: String, workId: String): WorkNoticeEntity?
}
