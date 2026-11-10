package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.manuscript.domain.TxtManuscript
import java.nio.charset.Charset
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class TxtManuscriptTest {
    private fun parse(text: String, name: String = "원고.txt") = TxtManuscript.parse(text.toByteArray(), name)
    private fun failure(bytes: ByteArray) = assertThrows(ContentFailure::class.java) { TxtManuscript.parse(bytes, "원고.txt") }

    @Test fun `title lines split episodes and the preface joins the first one`() {
        val manuscript = parse(listOf("머리말", "1화 시작", "", "첫 줄", "둘째 줄", "", "2화", "다음 이야기").joinToString("\n") + "\n")
        assertEquals("txt", manuscript.format); assertEquals("line", manuscript.unit); assertEquals(8, manuscript.unitCount)
        val (first, second) = manuscript.episodes
        assertEquals(2, manuscript.episodes.size)
        assertEquals(listOf("1화 시작", 0, 6, "머리말\n\n첫 줄\n둘째 줄"), listOf(first.title, first.from, first.to, first.text))
        assertEquals(listOf("2화", 6, 8, "다음 이야기"), listOf(second.title, second.from, second.to, second.text))
        assertTrue(first.images.isEmpty() && first.missingImages == 0 && first.error == null)
    }

    @Test fun `no title line makes one episode named after the file`() {
        val episode = parse("그냥 글\n\n둘째 줄\n\n", "내 소설.txt").episodes.single()
        assertEquals(listOf("내 소설", 0, 4, "그냥 글\n\n둘째 줄"), listOf(episode.title, episode.from, episode.to, episode.text))
        assertEquals(120, parse("글", "나".repeat(150) + ".txt").episodes.single().title.length)
        assertEquals("원고", parse("글", ".txt").episodes.single().title)
    }

    @Test fun `title pattern is case insensitive short and anchored at the line start`() {
        val longLine = "1화 " + "가".repeat(60)
        val manuscript = parse(listOf("제 1 화", "본문1", "그는 3화를 봤다", "2화 제목", "본문2", "Chapter 3", "본문3", "CHAPTER 4: x", "  5화  ", "제\u30006\u3000화", longLine, "Chapter", "화 7").joinToString("\n"))
        assertEquals(listOf("제 1 화", "2화 제목", "Chapter 3", "CHAPTER 4: x", "5화", "제\u30006\u3000화"), manuscript.episodes.map { it.title })
        assertEquals(listOf("본문1\n그는 3화를 봤다", "본문2", "본문3", "", "", "$longLine\nChapter\n화 7"), manuscript.episodes.map { it.text })
    }

    @Test fun `merging adjacent episodes keeps later title lines as body and drops only the first`() {
        val manuscript = parse("1화\n가\n2화\n나\n3화\n다")
        assertEquals(listOf(0 to 2, 2 to 4, 4 to 6), manuscript.episodes.map { it.from to it.to })
        val merged = manuscript.episode(0, 4)
        assertEquals(listOf("1화", 0, 4, "가\n2화\n나"), listOf(merged.title, merged.from, merged.to, merged.text))
        assertEquals("나\n3화\n다", manuscript.episode(2, 6).text)
        assertEquals("가\n2화\n나\n3화\n다", manuscript.episode(0, 6).text)
    }

    @Test fun `line breaks of every platform count as lines and private placeholders are removed`() {
        val manuscript = parse("1화\r\n가\r나\n다\uE000라")
        assertEquals(4, manuscript.unitCount)
        assertEquals("가\n나\n다라", manuscript.episodes.single().text)
    }

    @Test fun `UTF-8 with BOM and CP949 are both decoded`() {
        val bom = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())
        assertEquals("본문", TxtManuscript.parse(bom + "1화\n본문".toByteArray(), "a.txt").episodes.single().text)
        for (name in listOf("MS949", "EUC-KR")) {
            val cp949 = "1화\n한글 본문".toByteArray(Charset.forName(name))
            val episode = TxtManuscript.parse(cp949, "a.txt").episodes.single()
            assertEquals(listOf("1화", "한글 본문"), listOf(episode.title, episode.text), name)
        }
    }

    @Test fun `undecodable binary and empty files are rejected with distinct 422 reasons`() {
        val utf16 = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0x31, 0x00, 0x54, 0xD5.toByte())
        for (bytes in listOf(utf16, byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0xFF.toByte(), 0xFF.toByte()))) {
            val failure = failure(bytes)
            assertEquals(422, failure.status); assertTrue("인코딩" in failure.message, failure.message)
        }
        val binary = failure("1화\u0000본문".toByteArray())
        assertEquals(422, binary.status); assertTrue("텍스트" in binary.message, binary.message)
        for (bytes in listOf(ByteArray(0), "  \n\r\n ".toByteArray())) {
            val empty = failure(bytes)
            assertEquals(422, empty.status); assertTrue("비어" in empty.message, empty.message)
        }
    }
}
