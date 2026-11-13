package ai.storyfork.content.manuscript

import ai.storyfork.content.manuscript.domain.*
import java.io.ByteArrayInputStream
import java.io.StringReader
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.xml.sax.InputSource

class ManuscriptWriterTest {
    private val workId = "7d0c3c52-6d5b-4ef6-8f55-0d5f5f2f1a11"
    private val first = "11111111-1111-1111-1111-111111111111"
    private val chapters = listOf(
        ExportChapter(1, "1화 시작", "첫 문단\n\n[[image:$first]]\n\n둘째 문단"),
        ExportChapter(3, "3화 & <끝>", "x < y & z \"q\""),
    )
    private val modified = Instant.parse("2026-11-09T01:02:03.456Z")
    private fun epub(chapters: List<ExportChapter> = this.chapters, image: (Int, String) -> ParsedImage? = { n, id -> if (n == 1 && id == first) ParsedImage(EpubFixture.png, "image/png") else null }) =
        EpubManuscriptWriter.write(workId, "내 소설", chapters, modified, image)
    private fun entries(bytes: ByteArray): Map<String, ByteArray> = linkedMapOf<String, ByteArray>().also { map ->
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip -> while (true) { val entry = zip.nextEntry ?: break; map[entry.name] = zip.readAllBytes() } }
    }
    /** 한 회차만 내보낸 챕터의 `<body>` 안쪽. 올바른 XML인지도 함께 확인한다. */
    private fun chapterBody(body: String): String {
        val xhtml = String(entries(epub(listOf(ExportChapter(1, "제목", body)))).getValue("OEBPS/chapter1.xhtml"))
        assertDoesNotThrow({ DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(InputSource(StringReader(xhtml))) }, xhtml)
        return xhtml.substringAfter("<body>").substringBefore("</body>")
    }
    private fun markup(vararg lines: String) = lines.joinToString("") { "$it\n" }

    @Test fun `TXT starts with a BOM and separates the title and episodes with blank lines while dropping image markers`() {
        val whole = TxtManuscriptWriter.write("내 소설", chapters)
        assertArrayEquals(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()), whole.copyOf(3))
        assertEquals("내 소설\n\n\n1화 시작\n\n첫 문단\n\n\n\n둘째 문단\n\n\n3화 & <끝>\n\nx < y & z \"q\"\n", String(whole, 3, whole.size - 3, Charsets.UTF_8))
        val single = TxtManuscriptWriter.write(null, chapters.drop(1))
        assertEquals("3화 & <끝>\n\nx < y & z \"q\"\n", String(single, 3, single.size - 3, Charsets.UTF_8))
    }

    @Test fun `EPUB follows the container layout with a stored mimetype first and the required metadata`() {
        val bytes = epub()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            val head = zip.nextEntry
            assertEquals("mimetype", head.name); assertEquals(ZipEntry.STORED, head.method)
            assertNull(head.extra); assertEquals("application/epub+zip", String(zip.readAllBytes()))
        }
        val files = entries(bytes)
        assertEquals(listOf("mimetype", "META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/chapter1.xhtml", "OEBPS/chapter3.xhtml", "OEBPS/images/image1.png"), files.keys.toList())
        assertTrue("full-path=\"OEBPS/content.opf\"" in String(files.getValue("META-INF/container.xml")))
        val opf = String(files.getValue("OEBPS/content.opf"))
        for (part in listOf("<dc:title>내 소설</dc:title>", "<dc:language>ko</dc:language>", "urn:uuid:$workId", "<meta property=\"dcterms:modified\">2026-11-09T01:02:03Z</meta>",
            "href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"", "href=\"images/image1.png\" media-type=\"image/png\"", "<itemref idref=\"chapter1\"/><itemref idref=\"chapter3\"/>")) {
            assertTrue(part in opf, "$part\n$opf")
        }
        files.filterKeys { it.endsWith(".xml") || it.endsWith(".xhtml") || it.endsWith(".opf") }.forEach { (name, xml) ->
            assertDoesNotThrow({ DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(InputSource(StringReader(String(xml)))) }, name)
        }
        assertTrue("<a href=\"chapter3.xhtml\">3화 &amp; &lt;끝&gt;</a>" in String(files.getValue("OEBPS/nav.xhtml")))
    }

    @Test fun `own parser reads the written EPUB back including titles text and images`() {
        val book = EpubManuscript.parse(epub())
        assertEquals(2, book.unitCount)
        assertEquals(listOf("1화 시작", "3화 & <끝>"), book.episodes.map { it.title })
        assertEquals(listOf("첫 문단\n${IMAGE_PLACEHOLDER}\n둘째 문단", "x < y & z \"q\""), book.episodes.map { it.text })
        assertArrayEquals(EpubFixture.png, book.episodes[0].images.single().bytes)
        assertEquals(listOf(0, 0), book.episodes.map { it.missingImages })
        assertTrue(book.episodes.all { it.error == null })
    }

    @Test fun `unreadable images are dropped alone and every supported type gets its own file extension`() {
        val jpeg = "22222222-2222-2222-2222-222222222222"; val gone = "44444444-4444-4444-4444-444444444444"; val gif = "55555555-5555-5555-5555-555555555555"
        val body = "[[image:$first]]\n[[image:$jpeg]]\n[[image:$gone]]\n[[image:not-a-uuid]]\n[[image:$gif]]\n끝"
        val bytes = epub(listOf(ExportChapter(2, "그림", body))) { _, id -> when (id) {
            first -> ParsedImage(EpubFixture.png, "image/png", "지도 & <그림>"); jpeg -> ParsedImage(EpubFixture.jpeg, "image/jpeg"); gif -> ParsedImage(byteArrayOf(1), "image/gif"); else -> null
        } }
        val files = entries(bytes)
        assertEquals(listOf("OEBPS/images/image1.png", "OEBPS/images/image2.jpg"), files.keys.filter { "/images/" in it })
        assertTrue("<img src=\"images/image1.png\" alt=\"지도 &amp; &lt;그림&gt;\"/>" in String(files.getValue("OEBPS/chapter2.xhtml")))
        assertTrue("<img src=\"images/image2.jpg\" alt=\"\"/>" in String(files.getValue("OEBPS/chapter2.xhtml")))
        val episode = EpubManuscript.parse(bytes).episodes.single()
        assertEquals(listOf("image/png", "image/jpeg"), episode.images.map { it.mediaType })
        assertEquals(listOf("지도 & <그림>", ""), episode.images.map { it.altText })
        assertEquals("$IMAGE_PLACEHOLDER\n$IMAGE_PLACEHOLDER\n끝", episode.text)
    }

    @Test fun `characters XML cannot hold are removed and blank lines are not exported as paragraphs`() {
        val book = EpubManuscript.parse(epub(listOf(ExportChapter(1, "a\u0000b\u0008", "x\u0008y\n\n   \n\uD800z\n  들여쓰기  ")), image = { _, _ -> null }))
        assertEquals("ab", book.episodes.single().title)
        assertEquals("xy\nz\n들여쓰기", book.episodes.single().text)
    }

    @Test fun `manuscripts without format marks keep the exact chapter markup they had before formatting`() {
        val body = listOf(
            "첫 문단", "", "  들여쓴 줄  ", "\t", "${Char(0x3000)}전각 들여쓰기", "윈도우 줄\r", "옛 맥 줄\r둘로 나뉜다",
            "앞 [[image:$first]] 뒤", "[[image:not-a-uuid]]",
            "- 목록 아님", "1. 목록 아님", "`코드 아님`", "<b>태그 아님</b>", "#태그", "--", " ---", "## ",
            "2 * 3 * 4", "**짝 없음", "** 공백 **", "끝에 별표*", "a > b & \"c\"",
        ).joinToString("\n")
        assertEquals(markup(
            "<h1>제목</h1>", "<p>첫 문단</p>", "<p>들여쓴 줄</p>", "<p>전각 들여쓰기</p>", "<p>윈도우 줄</p>", "<p>옛 맥 줄</p>", "<p>둘로 나뉜다</p>",
            "<p>앞</p>", "<p><img src=\"images/image1.png\" alt=\"\"/></p>", "<p>뒤</p>",
            "<p>- 목록 아님</p>", "<p>1. 목록 아님</p>", "<p>`코드 아님`</p>", "<p>&lt;b&gt;태그 아님&lt;/b&gt;</p>", "<p>#태그</p>", "<p>--</p>", "<p>---</p>", "<p>##</p>",
            "<p>2 * 3 * 4</p>", "<p>**짝 없음</p>", "<p>** 공백 **</p>", "<p>끝에 별표*</p>", "<p>a &gt; b &amp; &quot;c&quot;</p>",
        ), chapterBody(body))
    }

    @Test fun `TXT keeps format marks as written so importing the file again keeps the formatting`() {
        val body = "## 1장 새벽\n**굵게** *기울임*\n> 인용\n---\n\\*별표\\*"
        val txt = TxtManuscriptWriter.write(null, listOf(ExportChapter(1, "1화", body)))
        assertEquals("1화\n\n$body\n", String(txt, 3, txt.size - 3, Charsets.UTF_8))
        assertEquals(body, TxtManuscript.parse(txt, "원고.txt").episodes.single().text)
    }

    @Test fun `EPUB draws bold italic subheadings and dividers from the manuscript format`() {
        val body = listOf(
            "## 1장 새벽", "# **굵은** 제목", "**그는 돌아오지 않았다.** 그는 *분명히* 말했다.", "  ***끝*** **굵게 *둘 다* 굵게**  ",
            "---", "*****",
            "별표 \\*글자\\*", "\\# 소제목 아님", "\\> 인용 아님", "\\---", "**<b> & \"q\"**", "**줄을", "넘는 굵게**",
            // XML에 쓸 수 없는 글자뿐인 소제목은 그릴 글이 없으므로 내지 않는다.
            "## ${Char(1)}",
        ).joinToString("\n")
        assertEquals(markup(
            "<h1>제목</h1>", "<h2>1장 새벽</h2>", "<h2><strong>굵은</strong> 제목</h2>",
            "<p><strong>그는 돌아오지 않았다.</strong> 그는 <em>분명히</em> 말했다.</p>", "<p><strong><em>끝</em></strong> <strong>굵게 <em>둘 다</em> 굵게</strong></p>",
            "<hr/>", "<hr/>",
            "<p>별표 *글자*</p>", "<p># 소제목 아님</p>", "<p>&gt; 인용 아님</p>", "<p>---</p>", "<p><strong>&lt;b&gt; &amp; &quot;q&quot;</strong></p>", "<p>**줄을</p>", "<p>넘는 굵게**</p>",
        ), chapterBody(body))
        // 다시 가져오면 글자만 남는다(가져오기는 서식을 되살리지 않는다).
        assertEquals(
            "1장 새벽\n굵은 제목\n그는 돌아오지 않았다. 그는 분명히 말했다.\n끝 굵게 둘 다 굵게\n별표 *글자*\n# 소제목 아님\n> 인용 아님\n---\n<b> & \"q\"\n**줄을\n넘는 굵게**",
            EpubManuscript.parse(epub(listOf(ExportChapter(1, "제목", body)))).episodes.single().text,
        )
    }

    @Test fun `consecutive quote lines share one blockquote and empty quote lines are not exported`() {
        val body = listOf("> 그가 말했다.", ">", ">  **붙여** 쓴 인용  ", "", "> 빈 줄 뒤", "[[image:$first]]", "> 그림 뒤", "---", ">구분선 뒤", "문단", ">", "> ").joinToString("\n")
        assertEquals(markup(
            "<h1>제목</h1>",
            "<blockquote>", "<p>그가 말했다.</p>", "<p><strong>붙여</strong> 쓴 인용</p>", "</blockquote>",
            "<blockquote>", "<p>빈 줄 뒤</p>", "</blockquote>",
            "<p><img src=\"images/image1.png\" alt=\"\"/></p>",
            "<blockquote>", "<p>그림 뒤</p>", "</blockquote>",
            "<hr/>",
            "<blockquote>", "<p>구분선 뒤</p>", "</blockquote>",
            "<p>문단</p>",
        ), chapterBody(body))
    }

    @Test fun `text sharing a line with an image marker is exported as paragraphs without line formats`() {
        fun img(n: Int) = "<p><img src=\"images/image$n.png\" alt=\"\"/></p>"
        val body = listOf(
            "## 앞 조각 [[image:$first]]# 뒤 조각", "---[[image:$first]]> 뒤 조각", "\\# 앞[[image:$first]]***", "**굵게** [[image:$first]] *기울임*",
            "> 온전한 인용", "[[image:$first]]", "## 온전한 소제목",
        ).joinToString("\n")
        assertEquals(markup(
            "<h1>제목</h1>",
            "<p>## 앞 조각</p>", img(1), "<p># 뒤 조각</p>",
            "<p>---</p>", img(2), "<p>&gt; 뒤 조각</p>",
            "<p>\\# 앞</p>", img(3), "<p>***</p>",
            "<p><strong>굵게</strong></p>", img(4), "<p><em>기울임</em></p>",
            "<blockquote>", "<p>온전한 인용</p>", "</blockquote>", img(5), "<h2>온전한 소제목</h2>",
        ), chapterBody(body))
    }

    @Test fun `lines whose content is over 2000 characters keep their marks as text`() {
        // 내용 2,000자까지는 서식을 그리고, 2,001자부터는 기호와 백슬래시를 글자 그대로 낸다. 줄 종류(인용)와 XML 이스케이프는 그대로다.
        val within = "가".repeat(1993); val over = "가".repeat(1990); val quoted = "가".repeat(1994)
        val body = listOf("**굵게** $within", "**굵게** & \\*$over", "> **굵게** $quoted").joinToString("\n")
        assertEquals(markup(
            "<h1>제목</h1>",
            "<p><strong>굵게</strong> $within</p>",
            "<p>**굵게** &amp; \\*$over</p>",
            "<blockquote>", "<p>**굵게** $quoted</p>", "</blockquote>",
        ), chapterBody(body))
    }
}
