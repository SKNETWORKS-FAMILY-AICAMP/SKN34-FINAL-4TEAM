package ai.storyfork.core.notification.repository

import java.time.Instant

/** 같은 종류·대상으로 묶은 알림의 집계 한 줄. 별칭 이름이 [NoticeRepository.groupSummaries] 쿼리와 같아야 한다. */
interface NoticeGroupRow {
    val kind: String
    val targetType: String
    val targetId: String
    val total: Long
    val unread: Long
    val latestAt: Instant
}
