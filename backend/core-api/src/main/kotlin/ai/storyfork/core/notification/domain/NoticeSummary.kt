package ai.storyfork.core.notification.domain

/** 사건 메시지의 선택 필드 `detail`: 문구 재료(#941). [title]은 작품명 또는 세계관명이고 모두 선택이다. 비공개 원고 본문·개인정보는 받지 않는다. 계약: docs/notification-event-contract.md */
data class NoticeDetail(
    val title: String? = null,
    val episodeNumber: Int? = null,
    val subject: String? = null,
    val reason: String? = null,
)

/**
 * 사건 종류와 [NoticeDetail]로 알림 문구를 만든다(#941). 제목이 없으면 사건 종류의 기본 문구([NoticeEventType.summary])를 쓴다.
 * 제목 40자·바뀐 대상 60자·사유 100자에서 자르므로 문구는 항상 알림 한도(300자) 안이다.
 */
object NoticeSummary {
    /** [subject]는 ai-tool 묶음 요약([bundled])에 다시 쓰는 대상 구절이며 ai-tool 사건에만 있다. */
    data class Text(val summary: String, val subject: String? = null)

    fun of(type: NoticeEventType, detail: NoticeDetail?): Text {
        if (detail == null) return Text(type.summary)
        val title = detail.title?.let { clip(it, 40) } ?: return Text(type.summary)
        val episode = detail.episodeNumber
        val subject = detail.subject?.let { clip(it, 60) }
        val reason = detail.reason?.let { clip(it, 100) }?.let { " · 사유: $it" }.orEmpty()
        val work = "「$title」" + episode?.let { " ${it}화" }.orEmpty()
        return when (type) {
            NoticeEventType.MCP_WORK_CHANGED -> listOfNotNull(work, subject).joinToString(" ").let { Text("AI가 MCP로 ${withObject(it)} 수정했어요", it) }
            NoticeEventType.MCP_WORLD_CHANGED -> ("「$title」" + subject?.let { "의 $it" }.orEmpty()).let { Text("AI가 MCP로 ${withObject(it)} 수정했어요", it) }
            NoticeEventType.OPERATOR_WORK_RESTRICTED -> Text("운영자가 ${withObject(work)} 제한했어요$reason")
            NoticeEventType.OPERATOR_WORK_UNRESTRICTED -> Text("운영자가 $work 제한을 해제했어요")
            NoticeEventType.OPERATOR_WORLD_RESTRICTED -> Text("운영자가 「$title」 세계관을 제한했어요$reason")
            NoticeEventType.OPERATOR_WORLD_UNRESTRICTED -> Text("운영자가 「$title」 세계관 제한을 해제했어요")
            NoticeEventType.OPERATOR_COMMENT_HIDDEN -> Text("운영자가 ${work}에 남긴 내 댓글을 숨겼어요")
            NoticeEventType.OPERATOR_COMMENT_RESTORED -> Text("운영자가 숨긴 ${work}의 내 댓글을 다시 게시했어요")
            NoticeEventType.EPISODE_PUBLISHED -> Text("관심 작품 「$title」에 ${episode?.let { "${it}화" } ?: "새 회차"}가 올라왔어요")
            else -> Text(type.summary)
        }
    }

    /** 묶인 ai-tool 알림의 요약이다. [subject]는 마지막 사건의 대상 구절, [more]는 그 밖에 합쳐진 사건 수다. 예: AI가 MCP로 「작품명」 3화 원고 외 2건을 수정했어요 */
    fun bundled(subject: String, more: Int) = "AI가 MCP로 $subject 외 ${more}건을 수정했어요"

    /** 공백·줄바꿈을 한 칸으로 접고 코드 포인트 기준 [max]자를 넘으면 자른다(이모지를 반으로 쪼개지 않는다). 비면 null이다. */
    private fun clip(text: String, max: Int): String? {
        val folded = text.replace(Regex("\\s+"), " ").trim()
        return when {
            folded.isEmpty() -> null
            folded.codePointCount(0, folded.length) > max -> folded.substring(0, folded.offsetByCodePoints(0, max)) + "…"
            else -> folded
        }
    }

    /** 목적격 조사를 붙인다. 마지막 글자(닫는 괄호·말줄임표 제외)가 한글이면 받침, 숫자면 읽는 소리로 고르고, 그 밖에는 "을(를)"이다. */
    private fun withObject(phrase: String): String {
        val last = phrase.trimEnd('」', ' ', '…').lastOrNull()
        val batchim = when {
            last == null -> null
            last in '가'..'힣' -> (last - '가') % 28 != 0
            last.isDigit() -> last in "013678"
            else -> null
        }
        return phrase + when (batchim) { true -> "을"; false -> "를"; null -> "을(를)" }
    }
}
