package ai.storyfork.content.proposal.domain

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.proposal.service.dto.ChangeSpan
import java.security.MessageDigest
import java.util.HexFormat

object ChangeSetPolicy {
    fun hash(value: String): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))
    // 제목의 UTF-16 길이로 경계를 고정하여 제목·본문 결합의 모호함을 없앤다.
    fun documentHash(title: String, body: String) = hash("${title.length}:$title$body")

    fun quote(text: String, span: ChangeSpan): String {
        fun boundary(index: Int) = index==0 || index==text.length ||
            !(text[index-1].isHighSurrogate() && text[index].isLowSurrogate())
        checkContent(span.start>=0 && span.end>=span.start && span.end<=text.length,
            message="UTF-16 구간을 확인해 주세요.")
        checkContent(boundary(span.start) && boundary(span.end),message="UTF-16 문자 중간을 선택할 수 없어요.")
        return text.substring(span.start,span.end)
    }
}
