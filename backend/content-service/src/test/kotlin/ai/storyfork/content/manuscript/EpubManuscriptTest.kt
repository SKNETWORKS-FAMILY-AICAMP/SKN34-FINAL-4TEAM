package ai.storyfork.content.manuscript

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.manuscript.EpubFixture.epub
import ai.storyfork.content.manuscript.EpubFixture.xhtml
import ai.storyfork.content.manuscript.domain.EpubManuscript
import ai.storyfork.content.manuscript.domain.IMAGE_PLACEHOLDER
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

class EpubManuscriptTest {
    private val ph = IMAGE_PLACEHOLDER
    private fun failure(bytes: ByteArray) = assertThrows(ContentFailure::class.java) { EpubManuscript.parse(bytes) }
    private fun chapter(body: String, name: String = "ch1.xhtml", title: String = "", extra: Map<String, ByteArray> = emptyMap()) =
        EpubManuscript.parse(epub(listOf(name to xhtml(body, title)), extra = extra)).episodes.single()

    @Test fun `bulk joins spine text preserving headings and skips illustrations`() {
        val bytes = epub(listOf(
            "a.xhtml" to xhtml("<h1>첫 장</h1><img src=\"x.png\"/><p>본문</p>"),
            "b.xhtml" to xhtml("<h2>다음 장</h2><p>마지막</p>"),
        ), nav = listOf("a.xhtml" to "목차 제목"), extra = mapOf("OEBPS/x.png" to EpubFixture.png))
        assertEquals("첫 장\n본문\n다음 장\n마지막", EpubManuscript.singleEpisodeBody(bytes, 40_000))
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            EpubManuscript.singleEpisodeBody(bytes, 5)
        }.status)
    }

    @Test fun `bulk fails on a broken spine instead of keeping partial text`() {
        val bytes = epub(listOf("a.xhtml" to xhtml("<p>본문</p>")),
            spine = """<itemref idref="c0"/><itemref idref="missing"/>""")
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            EpubManuscript.singleEpisodeBody(bytes, 40_000)
        }.status)
        val oversized = EpubFixture.zeros("OEBPS/picture.png" to ((50L shl 20) + 1))
        val error = assertThrows(ContentFailure::class.java) {
            EpubManuscript.singleEpisodeBody(oversized, 40_000)
        }
        assertTrue("너무" in error.message)
    }

    @Test fun `bulk limits repeated spine references even when they have no body text`() {
        val reference = """<itemref idref="c0"/>"""
        val bytes = epub(listOf("empty.xhtml" to xhtml("")), spine = reference.repeat(2_001))
        val failure = assertThrows(ContentFailure::class.java) {
            EpubManuscript.singleEpisodeBody(bytes, 40_000)
        }
        assertTrue("너무 많거나" in failure.message)

        val padded = xhtml("<!--${"x".repeat(3 * 1024 * 1024)}-->")
        val repeated = epub(listOf("large.xhtml" to padded), spine = reference.repeat(70))
        val sizeFailure = assertThrows(ContentFailure::class.java) {
            EpubManuscript.singleEpisodeBody(repeated, 40_000)
        }
        assertTrue("너무 많거나" in sizeFailure.message)
    }

    @Test fun `spine chapters become episodes titled from the table of contents`() {
        val manuscript = EpubManuscript.parse(epub(
            listOf("ch1.xhtml" to xhtml("<h1>1화 시작</h1><p>첫 문단</p><p>둘째 문단</p>"), "ch2.xhtml" to xhtml("<p>둘째 장</p>")),
            nav = listOf("ch1.xhtml" to "1화 시작", "ch2.xhtml" to "2화")))
        assertEquals("epub", manuscript.format); assertEquals("chapter", manuscript.unit); assertEquals(2, manuscript.unitCount)
        assertEquals(listOf(listOf("1화 시작", 0, 1, "첫 문단\n둘째 문단"), listOf("2화", 1, 2, "둘째 장")),
            manuscript.episodes.map { listOf(it.title, it.from, it.to, it.text) })
    }

    @Test fun `title comes from nav then the first h1 to h3 then document title then the chapter number`() {
        val manuscript = EpubManuscript.parse(epub(listOf(
            "c1.xhtml" to xhtml("<h1>H1 제목</h1><p>본문1</p>"),
            "c2.xhtml" to xhtml("<h2>두번째 H1</h2><p>본문2</p>"),
            "c3.xhtml" to xhtml("<p>본문3</p>", title = "문서 제목"),
            "c4.xhtml" to xhtml("<p>본문4</p>"),
            "c5.xhtml" to xhtml("<h4>소제목</h4><p>x</p>"),
        ), nav = listOf("c1.xhtml" to "목차 제목")))
        assertEquals(listOf("목차 제목", "두번째 H1", "문서 제목", "4화", "5화"), manuscript.episodes.map { it.title })
        // 제목으로 쓴 머리글만 본문에서 빼고, 제목과 다른 머리글은 본문에 남긴다.
        assertEquals(listOf("H1 제목\n본문1", "본문2", "본문3", "본문4", "소제목\nx"), manuscript.episodes.map { it.text })
    }

    @Test fun `NCX labels name chapters when there is no nav document and titles are collapsed and cut`() {
        val ncx = EpubManuscript.parse(epub(listOf("ch1.xhtml" to xhtml("<p>본문</p>")), ncx = listOf("ch1.xhtml#start" to "NCX 제목")))
        assertEquals("NCX 제목", ncx.episodes.single().title)
        val long = EpubManuscript.parse(epub(listOf("a.xhtml" to xhtml("<p>a</p>"), "b.xhtml" to xhtml("<p>b</p>")),
            nav = listOf("a.xhtml" to "  긴   제목\n  입니다 ", "b.xhtml" to "가".repeat(200))))
        assertEquals(listOf("긴 제목 입니다", "가".repeat(120)), long.episodes.map { it.title })
    }

    @Test fun `blocks and line breaks become lines while inline markup whitespace and scripts are flattened`() {
        val episode = chapter("<p>가 <em>나</em>\n  다</p><div>라<br/>마</div><ul><li>바</li><li>사</li></ul><script>var x=1;</script><style>p{}</style>" +
            "<p>a&nbsp;b &amp; c &lt;d&gt; &hellip; &copy;</p><p>   </p><p>가<ruby>漢<rt>한</rt></ruby></p>")
        assertEquals(listOf("가 나 다", "라", "마", "바", "사", "a\u00A0b & c <d> … ©", "가漢"), episode.text.lines())
    }

    @Test fun `images keep their position and only PNG and JPEG within 10 MiB are used`() {
        val extra = mapOf(
            "OEBPS/images/a.png" to EpubFixture.png, "OEBPS/images/b.JPG" to EpubFixture.jpeg, "OEBPS/images/c.gif" to byteArrayOf(1),
            "OEBPS/images/d.webp" to byteArrayOf(2), "OEBPS/images/big.png" to ByteArray(10 * 1024 * 1024 + 1), "OEBPS/images/pic.svg" to "<svg/>".toByteArray(),
        )
        val episode = chapter("<p>앞</p><img src=\"images/a.png\" alt=\"\"/><p>뒤</p><p><img src=\"../OEBPS/images/b.JPG\"/></p>" +
            "<img src=\"images/c.gif\"/><img src=\"images/missing.png\"/><img src=\"images/d.webp\"/><img src=\"images/big.png\"/><img src=\"images/pic.svg\"/>", extra = extra)
        assertEquals(listOf("앞", "$ph", "뒤", "$ph"), episode.text.lines())
        assertEquals(listOf("image/png", "image/jpeg"), episode.images.map { it.mediaType })
        assertArrayEquals(EpubFixture.png, episode.images[0].bytes)
        // GIF·WebP·SVG(저장소가 받지 않는 형식), 없는 파일, 10 MiB 초과가 빠진 이미지다.
        assertEquals(5, episode.missingImages)
        assertEquals(7 + 2 * 45, episode.bodyLength)
    }

    @Test fun `img alt becomes the image alt text with spaces collapsed control characters removed and 300 characters kept`() {
        val extra = mapOf("OEBPS/images/a.png" to EpubFixture.png)
        val episode = chapter("<img src=\"images/a.png\" alt=\"  지도&#10;  그림 &amp; &lt;표&gt;  \"/><img src=\"images/a.png\"/><img src=\"images/a.png\" alt=\"a&#133;b\"/>" +
            "<img src=\"images/a.png\" alt=\"" + "가".repeat(400) + "\"/>", extra = extra)
        assertEquals(listOf("지도 그림 & <표>", "", "ab", "가".repeat(300)), episode.images.map { it.altText })
    }

    @Test fun `relative paths resolve against the chapter and the OPF including percent encoding`() {
        val nested = EpubManuscript.parse(epub(listOf("text/ch1.xhtml" to xhtml("<img src=\"../images/%EC%A7%80%EB%8F%84.png\"/><img src=\"./../images/./a.png\"/>")),
            extra = mapOf("OEBPS/images/지도.png" to EpubFixture.png, "OEBPS/images/a.png" to EpubFixture.png))).episodes.single()
        assertEquals(2, nested.images.size); assertEquals(0, nested.missingImages)
        val encoded = EpubManuscript.parse(epub(listOf("text/%EC%A0%9C1.xhtml" to ""),
            extra = mapOf("OEBPS/text/제1.xhtml" to xhtml("<p>인코딩</p>").toByteArray()))).episodes.single()
        assertEquals("인코딩", encoded.text)
    }

    @Test fun `path traversal absolute paths and URL schemes are never read and count as missing images`() {
        val traps = listOf("../../secret.png", "/abs.png", "http://127.0.0.1:1/x.png", "https://evil.example/x.png", "data:image/png;base64,AAAA",
            "file:///etc/passwd.png", "images\\a.png", "%2e%2e/%2e%2e/secret.png", "jar:file:/x.jar!/a.png", "images/a.png#frag?x=../..")
        val extra = mapOf("../../secret.png" to EpubFixture.png, "secret.png" to EpubFixture.png, "abs.png" to EpubFixture.png, "OEBPS/images/a.png" to EpubFixture.png)
        val episode = chapter(traps.joinToString("") { "<img src=\"$it\"/>" } + "<p>본문</p>", extra = extra)
        // 마지막 경로는 조각·질의를 떼면 정상 경로라 읽고, 나머지 9개는 빠진 이미지다.
        assertEquals(1, episode.images.size); assertEquals(9, episode.missingImages)
        assertEquals("$ph\n본문", episode.text)
    }

    @Test fun `spine items outside the zip root or of another type are skipped`() {
        val manifest = """<item id="evil" href="../../outside.xhtml" media-type="application/xhtml+xml"/><item id="svg" href="cover.svg" media-type="image/svg+xml"/>"""
        val manuscript = EpubManuscript.parse(epub(listOf("ch1.xhtml" to xhtml("<p>본문</p>")), manifest = manifest,
            spine = """<itemref idref="evil"/><itemref idref="svg"/><itemref idref="c0"/><itemref idref="nothing"/>""",
            extra = mapOf("../../outside.xhtml" to xhtml("<p>탈출</p>").toByteArray(), "outside.xhtml" to xhtml("<p>탈출</p>").toByteArray())))
        assertEquals(1, manuscript.unitCount)
        assertEquals("본문", manuscript.episodes.single().text)
    }

    @Test fun `DRM is refused but font obfuscation is allowed`() {
        fun encryption(vararg algorithms: String) = """<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${
            algorithms.joinToString("") { """<enc:EncryptedData><enc:EncryptionMethod Algorithm="$it"/><enc:CipherData><enc:CipherReference URI="OEBPS/f.otf"/></enc:CipherData></enc:EncryptedData>""" }}</encryption>""".toByteArray()
        fun book(extra: Map<String, ByteArray>) = epub(listOf("ch1.xhtml" to xhtml("<p>본문</p>")), extra = extra)
        val fonts = arrayOf("http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC")
        assertEquals("본문", EpubManuscript.parse(book(mapOf("META-INF/encryption.xml" to encryption(*fonts)))).episodes.single().text)
        for (extra in listOf(
            mapOf("META-INF/rights.xml" to "<rights/>".toByteArray()),
            mapOf("META-INF/RIGHTS.XML" to "<rights/>".toByteArray()),
            mapOf("META-INF/encryption.xml" to encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc")),
            mapOf("META-INF/encryption.xml" to encryption(*fonts, "http://www.w3.org/2001/04/xmlenc#aes256-cbc")),
        )) {
            val failure = failure(book(extra))
            assertEquals(422, failure.status); assertTrue("DRM" in failure.message, failure.message)
        }
        assertEquals(422, failure(book(mapOf("META-INF/encryption.xml" to "<broken".toByteArray()))).status)
    }

    @Test fun `zip bombs are stopped by the bytes actually read`() {
        fun limited(bytes: ByteArray) = failure(bytes).also { assertEquals(422, it.status); assertTrue("너무" in it.message, it.message) }
        limited(EpubFixture.zeros("OEBPS/big.bin" to ((50L shl 20) + 1)))
        limited(EpubFixture.zeros(*(1..5).map { "OEBPS/part$it.bin" to (45L shl 20) }.toTypedArray()))
        limited(EpubFixture.zip((0..2000).associate { "f$it.txt" to byteArrayOf(1) }))
        // 한도 안의 항목 수는 한도 오류가 아니라 EPUB 구조 오류다.
        assertFalse("너무" in failure(EpubFixture.zip((0 until 2000).associate { "f$it.txt" to byteArrayOf(1) })).message)
    }

    @Test fun `a text entry over 4 MiB is refused whatever its extension while exactly 4 MiB is not a limit error`() {
        for (name in listOf("OEBPS/big.xhtml", "OEBPS/big.html", "OEBPS/big.htm", "OEBPS/big.opf", "OEBPS/toc.ncx", "META-INF/big.xml")) {
            val over = failure(EpubFixture.zeros(name to ((4L shl 20) + 1)))
            assertEquals(422, over.status); assertTrue("너무" in over.message, "$name: ${over.message}")
            assertFalse("너무" in failure(EpubFixture.zeros(name to (4L shl 20))).message, name)
        }
    }

    // 스레드가 할당한 바이트(HotSpot)로 '작은 압축 EPUB 하나가 힙을 부풀리지 않는다'를 확인한다.
    private fun <T> allocating(action: () -> T): Pair<T, Long> {
        val bean = java.lang.management.ManagementFactory.getThreadMXBean() as com.sun.management.ThreadMXBean
        assumeTrue(bean.isThreadAllocatedMemorySupported)
        val before = bean.currentThreadAllocatedBytes
        val result = action()
        return result to bean.currentThreadAllocatedBytes - before
    }

    @Test fun `a huge text entry is refused after reading only its limit instead of being held`() {
        val bomb = EpubFixture.zeros("OEBPS/huge.xhtml" to (45L shl 20))
        val (failure, allocated) = allocating { failure(bomb) }
        assertEquals(422, failure.status); assertTrue("너무" in failure.message, failure.message)
        assertTrue(allocated < 32L shl 20, "allocated $allocated bytes")
    }

    @Test fun `entries that are not kept are only counted with a fixed buffer and the total still stops them`() {
        val fonts = EpubFixture.zeros(*(1..5).map { "OEBPS/font$it.otf" to (45L shl 20) }.toTypedArray())
        val (failure, allocated) = allocating { failure(fonts) }
        assertEquals(422, failure.status); assertTrue("너무" in failure.message, failure.message)
        assertTrue(allocated < 8L shl 20, "allocated $allocated bytes")
        val one = EpubFixture.zeros("OEBPS/font.otf" to (45L shl 20))
        val (single, singleAllocated) = allocating { failure(one) }
        // 한 항목은 한도 안이라 한도 오류가 아니라 EPUB 구조 오류(container.xml 없음)일 뿐이다.
        assertFalse("너무" in single.message, single.message)
        assertTrue(singleAllocated < 8L shl 20, "allocated $singleAllocated bytes")
    }

    @Test fun `an image of exactly 10 MiB is used and a larger one is dropped but still counted toward the limits`() {
        val episode = chapter("<img src=\"images/max.png\"/><img src=\"images/over.png\"/>",
            extra = mapOf("OEBPS/images/max.png" to ByteArray(10 shl 20), "OEBPS/images/over.png" to ByteArray((10 shl 20) + 1)))
        assertEquals(1, episode.images.size); assertEquals(1, episode.missingImages)
        fun limited(bytes: ByteArray) = failure(bytes).also { assertTrue("너무" in it.message, it.message) }
        limited(EpubFixture.zeros("OEBPS/images/huge.png" to ((50L shl 20) + 1)))
        limited(EpubFixture.zeros(*(1..5).map { "OEBPS/images/p$it.jpg" to (45L shl 20) }.toTypedArray()))
    }

    @Test fun `external entities DTDs and entity expansion are never loaded and the chapter is reported`() {
        ServerSocket(0, 5, InetAddress.getLoopbackAddress()).use { server ->
            val url = "http://127.0.0.1:${server.localPort}"
            val evil = listOf(
                "<!DOCTYPE html [<!ENTITY xxe SYSTEM \"$url/xxe\">]>" to "<p>&xxe;</p>",
                "<!DOCTYPE html [<!ENTITY % remote SYSTEM \"$url/dtd\"> %remote;]>" to "<p>x</p>",
                "<!DOCTYPE html [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>" to "<p>&xxe;</p>",
                "<!DOCTYPE html [<!ENTITY a \"aaaaaaaaaa\"><!ENTITY b \"&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;\">]>" to "<p>&b;</p>",
            )
            val manuscript = EpubManuscript.parse(epub(
                evil.mapIndexed { i, (doctype, body) -> "e$i.xhtml" to xhtml(body, doctype = doctype) } +
                    listOf("ext.xhtml" to xhtml("<p>외부 DTD&nbsp;참조</p>", doctype = "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"$url/ext.dtd\">"),
                        "ok.xhtml" to xhtml("<p>정상</p>"))))
            assertEquals(6, manuscript.unitCount)
            assertTrue(manuscript.episodes.take(4).all { it.error != null && it.text.isEmpty() }, manuscript.episodes.map { it.error }.toString())
            assertEquals(listOf(null, null), manuscript.episodes.drop(4).map { it.error })
            assertEquals(listOf("외부 DTD\u00A0참조", "정상"), manuscript.episodes.drop(4).map { it.text })
            // 같은 시도를 container.xml에 해도 EPUB 전체를 읽지 못한 것으로 끝난다.
            val container = """<?xml version="1.0"?><!DOCTYPE container [<!ENTITY x SYSTEM "$url/container">]><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"""
            assertEquals(422, failure(epub(listOf("ch1.xhtml" to xhtml("<p>x</p>")), extra = mapOf("META-INF/container.xml" to container.toByteArray()))).status)
            server.soTimeout = 300
            assertThrows(SocketTimeoutException::class.java) { server.accept() }
        }
    }

    @Test fun `a malformed chapter is reported on its own episode and propagates when merged`() {
        val manuscript = EpubManuscript.parse(epub(listOf("a.xhtml" to xhtml("<p>정상</p>"), "b.xhtml" to "<html><body><p>닫지 않음</body>", "c.xhtml" to xhtml("<p>뒤</p>"))))
        assertEquals(listOf(null, "이 장을 읽지 못했어요.", null), manuscript.episodes.map { it.error })
        assertEquals("", manuscript.episodes[1].text)
        assertEquals("이 장을 읽지 못했어요.", manuscript.episode(0, 3).error)
        assertNull(manuscript.episode(2, 3).error)
        val missing = EpubManuscript.parse(epub(listOf("a.xhtml" to xhtml("<p>정상</p>")), manifest = """<item id="gone" href="gone.xhtml" media-type="application/xhtml+xml"/>""",
            spine = """<itemref idref="c0"/><itemref idref="gone"/>"""))
        assertEquals(listOf(null, "이 장을 찾지 못했어요."), missing.episodes.map { it.error })
    }

    @Test fun `merged chapters keep later titles as lines and add up images`() {
        val manuscript = EpubManuscript.parse(epub(
            listOf("a.xhtml" to xhtml("<p>a1</p><img src=\"images/a.png\"/>"), "b.xhtml" to xhtml("<p>b1</p><img src=\"images/nope.png\"/>"), "c.xhtml" to xhtml("<p>c1</p>")),
            nav = listOf("a.xhtml" to "A", "b.xhtml" to "B", "c.xhtml" to "C"), extra = mapOf("OEBPS/images/a.png" to EpubFixture.png)))
        val merged = manuscript.episode(0, 2)
        assertEquals(listOf("A", 0, 2, "a1\n$ph\nB\nb1"), listOf(merged.title, merged.from, merged.to, merged.text))
        assertEquals(1, merged.images.size); assertEquals(1, merged.missingImages)
        assertEquals("b1\nC\nc1", manuscript.episode(1, 3).text)
    }

    @Test fun `more than 300 chapters are refused before any chapter is read`() {
        fun book(count: Int) = epub((1..count).map { "c$it.xhtml" to xhtml("<p>$it</p>") })
        assertEquals(300, EpubManuscript.parse(book(300)).unitCount)
        val failure = failure(book(301))
        assertEquals(422, failure.status); assertTrue("300" in failure.message && "301" in failure.message, failure.message)
    }

    @Test fun `files that are not readable EPUBs are rejected with 422`() {
        val plain = failure("hello".toByteArray())
        assertEquals(422, plain.status); assertTrue("읽지 못" in plain.message, plain.message)
        assertEquals(422, failure(EpubFixture.zip(mapOf("a.txt" to byteArrayOf(1)))).status)
        assertEquals(422, failure(EpubFixture.zip(mapOf("META-INF/container.xml" to """<container><rootfiles><rootfile full-path="OEBPS/none.opf"/></rootfiles></container>""".toByteArray()))).status)
        val empty = failure(epub(emptyList()))
        assertEquals(422, empty.status); assertTrue("읽을 수 있는 장" in empty.message, empty.message)
    }
}
