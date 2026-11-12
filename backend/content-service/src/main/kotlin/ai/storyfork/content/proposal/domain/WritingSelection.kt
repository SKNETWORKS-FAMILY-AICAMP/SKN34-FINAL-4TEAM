package ai.storyfork.content.proposal.domain

import ai.storyfork.content._common.exception.checkContent

/** 부분 수정(#62)의 선택 구간. 위치는 초안 본문의 UTF-16 offset `start:end`이며 반영 시 이 구간만 교체한다. */
data class WritingSelection(val before: String, val preceding: String, val following: String, val position: String) {
    companion object {
        private const val MAX_SELECTION = 5000
        private const val MAX_SURROUNDING = 2000

        fun of(body: String, start: Int, end: Int): WritingSelection {
            checkContent(start in 0 until end && end <= body.length && end - start <= MAX_SELECTION &&
                !body.splits(start) && !body.splits(end) && body.substring(start, end).isNotBlank(),
                422, "수정할 구간을 다시 선택해 주세요. 공백이 아닌 5,000자 이하만 고칠 수 있어요.")
            return WritingSelection(body.substring(start, end),
                body.substring(maxOf(0, start - MAX_SURROUNDING), start).dropWhile { it.isLowSurrogate() },
                body.substring(end).take(MAX_SURROUNDING).dropLastWhile { it.isHighSurrogate() }, "$start:$end")
        }

        fun apply(body: String, position: String, after: String): String {
            val (start, end) = position.split(":").map { it.toInt() }
            return body.substring(0, start) + after + body.substring(end)
        }

        private fun String.splits(offset: Int) = offset in 1 until length && Character.isSurrogatePair(this[offset - 1], this[offset])
    }
}
