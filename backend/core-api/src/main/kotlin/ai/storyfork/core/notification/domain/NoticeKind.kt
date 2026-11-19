package ai.storyfork.core.notification.domain

/**
 * 알림 분류(UC-27). 읽기·창작·AI 도구 변경 알림만 회원이 끌 수 있고, 처리 결과·크레딧·권리·보안 알림은 항상 만들어진다.
 * 세부 사건 종류는 사건 계약이 확정된 뒤 추가한다.
 */
enum class NoticeKind(val code: String, val mutable: Boolean) {
    READING("reading", true),
    CREATION("creation", true),
    RESULT("result", false),
    CREDIT("credit", false),
    RIGHTS_SECURITY("rights-security", false),

    /** AI·외부 도구(MCP)가 회원의 콘텐츠를 바꿨다는 알림(#553). 같은 대상의 읽지 않은 알림은 하나로 묶인다(NoticeService.create). */
    AI_TOOL("ai-tool", true);

    companion object {
        fun fromCode(code: String): NoticeKind? = entries.firstOrNull { it.code == code }
    }
}
