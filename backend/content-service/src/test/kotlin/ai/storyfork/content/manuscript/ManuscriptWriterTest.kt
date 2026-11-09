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
}
