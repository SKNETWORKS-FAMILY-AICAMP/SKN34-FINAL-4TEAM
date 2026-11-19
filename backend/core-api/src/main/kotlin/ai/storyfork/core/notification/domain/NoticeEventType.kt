package ai.storyfork.core.notification.domain

/**
 * Core가 알림으로 바꿔 주는 사건 종류(계약 schemaVersion 1). code는 RabbitMQ routing key이자 메시지의 type이다.
 * 새 사건은 여기에 추가하고 docs/notification-event-contract.md에도 적는다. 처음 연결할 사건은 팀 확인 전의 후보다.
 */
enum class NoticeEventType(val code: String, val kind: NoticeKind, val summary: String, val targetType: String) {
    /** Content 세계관 변경 -> 해당 작품을 보는 Fork 독자에게 읽기 알림(UC-27). */
    WORLD_CHANGED("content.world.changed", NoticeKind.READING, "보고 있는 작품의 세계관이 바뀌었어요", "work"),

    /** Content 새 회차 발행 -> 그 작품을 관심 작품으로 담은 독자(작가 본인 제외)에게 읽기 알림(UC-01 A7·UC-27). */
    EPISODE_PUBLISHED("content.episode.published", NoticeKind.READING, "관심 작품에 새 회차가 올라왔어요", "work"),

    /** Core 크레딧 소멸 예정 -> 남은 크레딧이 곧 소멸되는 회원에게 크레딧 알림(UC-17·UC-27). target.id는 소멸 날짜(KST, yyyy-MM-dd). */
    CREDIT_EXPIRING("core.credit.expiring", NoticeKind.CREDIT, "곧 소멸되는 크레딧이 있어요", "credit-expiry"),

    /** Core 탈퇴 요청 -> 요청한 회원에게 권리·보안 알림(UC-22·UC-27). target.id는 탈퇴 요청 id. */
    WITHDRAWAL_REQUESTED("core.member.withdrawal-requested", NoticeKind.RIGHTS_SECURITY, "탈퇴가 요청됐어요. 유예 기간 안에 프로필에서 탈퇴 요청을 취소하면 복구할 수 있어요", "withdrawal"),

    /** Content MCP 쓰기가 세계관 내용·설정을 바꿈 -> 도구를 부른 작가에게 AI 변경 알림(#553). target.id는 WorldStudio 세계관 id. 같은 대상의 읽지 않은 알림은 묶는다. */
    MCP_WORLD_CHANGED("content.mcp.world-changed", NoticeKind.AI_TOOL, "AI가 MCP로 세계관을 수정했어요", "world"),

    /** Content MCP 쓰기가 작품·회차·플롯·공지·작품 설정을 바꿈 -> 도구를 부른 작가에게 AI 변경 알림(#553). target.id는 작품 id. 같은 대상의 읽지 않은 알림은 묶는다. */
    MCP_WORK_CHANGED("content.mcp.work-changed", NoticeKind.AI_TOOL, "AI가 MCP로 작품을 수정했어요", "work"),

    /** 운영자가 작품을 제한함 -> 작품 소유자에게 처리 결과 알림(#553). 묶지 않는다. */
    OPERATOR_WORK_RESTRICTED("content.operator.work-restricted", NoticeKind.RESULT, "운영자가 작품을 제한했어요", "work"),

    /** 운영자가 작품 제한을 해제함 -> 작품 소유자에게 처리 결과 알림(#553). 묶지 않는다. */
    OPERATOR_WORK_UNRESTRICTED("content.operator.work-unrestricted", NoticeKind.RESULT, "운영자가 작품 제한을 해제했어요", "work"),

    /** 운영자가 댓글을 숨김 -> 댓글 작성자에게 처리 결과 알림(#553). target.id는 댓글이 달린 작품 id. 묶지 않는다. */
    OPERATOR_COMMENT_HIDDEN("content.operator.comment-hidden", NoticeKind.RESULT, "운영자가 내 댓글을 숨겼어요", "work"),

    /** 운영자가 숨긴 댓글을 다시 게시함 -> 댓글 작성자에게 처리 결과 알림(#553). target.id는 댓글이 달린 작품 id. 묶지 않는다. */
    OPERATOR_COMMENT_RESTORED("content.operator.comment-restored", NoticeKind.RESULT, "운영자가 숨긴 내 댓글을 다시 게시했어요", "work");

    companion object {
        fun fromCode(code: String): NoticeEventType? = entries.firstOrNull { it.code == code }
    }
}
