package ai.storyfork.content.manuscript.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/** TXT 원고. 회차 제목 줄(`1화`·`제1화`·`Chapter 1`)로 나누고, 위치 단위는 줄이다. */
class TxtManuscript private constructor(private val lines: List<String>, private val fileTitle: String) : Manuscript {
    override val format = "txt"
    override val unit = "line"
    override val unitCount get() = lines.size

    override val episodes: List<ParsedEpisode> by lazy {
        // 첫 제목 줄 앞의 내용은 첫 회차 본문 앞에 붙는다. 제목 줄이 없으면 [0, n) 전체가 한 회차다.
        val starts = listOf(0) + lines.indices.filter { isTitle(lines[it]) }.drop(1)
        starts.mapIndexed { i, start -> episode(start, starts.getOrElse(i + 1) { lines.size }) }
    }

    /** 범위 안의 첫 제목 줄이 제목이고 본문에서는 뺀다. 합친 뒤쪽 회차의 제목 줄은 본문에 그대로 남는다. */
    override fun episode(from: Int, to: Int): ParsedEpisode {
        val range = lines.subList(from, to)
        val titleIndex = range.indexOfFirst(::isTitle)
        val body = range.filterIndexed { i, _ -> i != titleIndex }.dropWhile { it.isBlank() }.dropLastWhile { it.isBlank() }.joinToString("\n")
        return ParsedEpisode(if (titleIndex >= 0) range[titleIndex].trim().take(MAX_TITLE) else fileTitle, from, to, body)
    }

    companion object {
        private const val MAX_TITLE = 120
        private val TITLE = Regex("(?U)^(제\\s*\\d+\\s*화|\\d+\\s*화|chapter\\s+\\d+)", RegexOption.IGNORE_CASE)
        private fun isTitle(line: String) = line.trim().let { it.length <= 60 && TITLE.containsMatchIn(it) }

        /** BOM을 뗀 뒤 엄격한 UTF-8 → 엄격한 CP949(MS949, EUC-KR 포함) 순으로 읽는다. 둘 다 안 되거나 제어 문자가 있으면 422다. */
        fun parse(bytes: ByteArray, filename: String): TxtManuscript {
            val text = readText(bytes)
            val lines = text.lines().let { if (it.last().isEmpty()) it.dropLast(1) else it }
            val name = filename.substringAfterLast('/').substringAfterLast('\\').substringBeforeLast('.').trim()
            return TxtManuscript(lines, name.ifEmpty { "원고" }.take(MAX_TITLE))
        }

        fun singleEpisodeBody(bytes: ByteArray): String =
            readText(bytes).replace("\r\n", "\n").replace('\r', '\n')

        private fun readText(bytes: ByteArray): String {
            val text = decode(bytes).replace(IMAGE_PLACEHOLDER.toString(), "")
            if (text.any { it.isISOControl() && it !in "\t\r\n" }) throw ContentFailure(422, "글자가 아닌 제어 문자가 들어 있어 텍스트 파일로 읽을 수 없어요.")
            if (text.isBlank()) throw ContentFailure(422, "파일이 비어 있어요.")
            return text
        }

        private fun decode(bytes: ByteArray): String {
            val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
            val data = if (bytes.size >= 3 && bytes.copyOf(3).contentEquals(bom)) bytes.copyOfRange(3, bytes.size) else bytes
            for (charset in listOf("UTF-8", "MS949")) {
                try {
                    return Charset.forName(charset).newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(data)).toString()
                } catch (_: CharacterCodingException) { /* 다음 인코딩을 시도한다 */ }
            }
            throw ContentFailure(422, "텍스트 인코딩을 알 수 없어요. UTF-8 또는 CP949(EUC-KR) 파일만 가져올 수 있어요.")
        }
    }
}
