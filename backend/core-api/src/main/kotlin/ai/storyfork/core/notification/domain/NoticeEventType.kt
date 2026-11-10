package ai.storyfork.core.notification.domain

/**
 * Core가 알림으로 바꿔 주는 사건 종류(계약 schemaVersion 1). code는 RabbitMQ routing key이자 메시지의 type이다.
 * 새 사건은 여기에 추가하고 docs/notification-event-contract.md에도 적는다. 처음 연결할 사건은 팀 확인 전의 후보다.
 */
enum class NoticeEventType(val code: String, val kind: NoticeKind, val summary: String, val targetType: String) {
    /** Content 세계관 변경 -> 해당 작품을 보는 Fork 독자에게 읽기 알림(UC-27). */
    WORLD_CHANGED("content.world.changed", NoticeKind.READING, "보고 있는 작품의 세계관이 바뀌었어요", "work"),

    /** Content 새 회차 발행 -> 그 작품을 관심 작품으로 담은 독자(작가 본인 제외)에게 읽기 알림(UC-01 A7·UC-27). */
    EPISODE_PUBLISHED("content.episode.published", NoticeKind.READING, "관심 작품에 새 회차가 올라왔어요", "work");

    companion object {
        fun fromCode(code: String): NoticeEventType? = entries.firstOrNull { it.code == code }
    }
}
