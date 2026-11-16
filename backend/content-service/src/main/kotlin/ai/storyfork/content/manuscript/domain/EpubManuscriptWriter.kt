package ai.storyfork.content.manuscript.domain

import ai.storyfork.content.manuscript.domain.ManuscriptFormat.Kind
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * EPUB 3 내보내기. 회차를 챕터로, 본문을 원고 서식 문법([ManuscriptFormat])대로 문단(`<p>`)·소제목(`<h2>`)·인용(`<blockquote>`)·구분선(`<hr/>`)과
 * 굵게(`<strong>`)·기울임(`<em>`)으로 담고 읽을 수 있는 이미지만 파일로 포함한다.
 */
object EpubManuscriptWriter {
    private val EXTENSIONS = mapOf("image/png" to "png", "image/jpeg" to "jpg")
    // XML 1.0이 허용하지 않는 문자(제어 문자·짝 없는 서로게이트 등)는 파일을 깨뜨리므로 뺀다.
    private val INVALID_XML = Regex("[^\\x09\\x0A\\x0D\\x20-\\x{D7FF}\\x{E000}-\\x{FFFD}\\x{10000}-\\x{10FFFF}]")

    private fun clean(text: String) = text.replace(INVALID_XML, "")
    private fun escape(text: String) = clean(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    private fun page(title: String, body: String) = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"ko\"><head><meta charset=\"UTF-8\"/><title>${escape(title)}</title></head><body>$body</body></html>\n"

    /**
     * 이미지 표식 사이의 글을 줄마다 서식 문법대로 그린다. 줄 앞뒤 공백을 떼고 그릴 글이 없는 줄은 내지 않으며,
     * 연속한 인용 줄은 `<blockquote>` 하나로 묶는다. 표식은 [write]가 먼저 잘라 내므로 이미지 줄은 여기 오지 않는다.
     * 표식과 같은 줄에 있던 조각(afterMarker면 첫 줄, beforeMarker면 끝 줄)은 줄 전체가 아니므로 서식 도입 전처럼 문단으로만 낸다.
     */
    private fun blocks(part: String, afterMarker: Boolean, beforeMarker: Boolean): String {
        val out = StringBuilder()
        var quoting = false
        val lines = part.lines()
        lines.forEachIndexed { index, raw ->
            val fragment = (afterMarker && index == 0) || (beforeMarker && index == lines.lastIndex)
            val line = if (fragment) ManuscriptFormat.Line(Kind.PARAGRAPH, raw) else ManuscriptFormat.line(raw)
            val html = ManuscriptFormat.inline(line.content, ::escape, { "<strong>$it</strong>" }, { "<em>$it</em>" }).trim()
            // 인용 묶음은 그릴 글이 있는 첫 인용 줄에서 열고 인용이 아닌 줄에서 닫는다.
            val quoted = line.kind == Kind.QUOTE && (quoting || html.isNotEmpty())
            if (quoted != quoting) out.append(if (quoted) "<blockquote>\n" else "</blockquote>\n")
            quoting = quoted
            when {
                line.kind == Kind.DIVIDER -> out.append("<hr/>\n")
                html.isEmpty() -> {}
                line.kind == Kind.HEADING -> out.append("<h2>$html</h2>\n")
                else -> out.append("<p>$html</p>\n")
            }
        }
        if (quoting) out.append("</blockquote>\n")
        return out.toString()
    }

    /** image는 (회차 번호, 이미지 ID)로 이미지를 찾아 주며 null이면 그 이미지만 뺀다. */
    fun write(workId: String, title: String, chapters: List<ExportChapter>, modified: Instant, image: (Int, String) -> ParsedImage?): ByteArray {
        val chapterFiles = LinkedHashMap<String, ByteArray>()
        val imageFiles = LinkedHashMap<String, ByteArray>()
        val manifest = StringBuilder()
        val spine = StringBuilder()
        val toc = StringBuilder()
        for (chapter in chapters) {
            val name = "chapter${chapter.number}.xhtml"
            val body = StringBuilder("<h1>${escape(chapter.title)}</h1>\n")
            var last = 0
            for (marker in IMAGE_MARKER.findAll(chapter.body)) {
                body.append(blocks(chapter.body.substring(last, marker.range.first), last > 0, true))
                image(chapter.number, marker.groupValues[1])?.takeIf { it.mediaType in EXTENSIONS }?.let { found ->
                    val file = "images/image${imageFiles.size + 1}.${EXTENSIONS.getValue(found.mediaType)}"
                    imageFiles["OEBPS/$file"] = found.bytes
                    manifest.append("<item id=\"image${imageFiles.size}\" href=\"$file\" media-type=\"${found.mediaType}\"/>")
                    body.append("<p><img src=\"$file\" alt=\"${escape(found.altText)}\"/></p>\n")
                }
                last = marker.range.last + 1
            }
            body.append(blocks(chapter.body.substring(last), last > 0, false))
            chapterFiles["OEBPS/$name"] = page(chapter.title, body.toString()).toByteArray()
            manifest.append("<item id=\"chapter${chapter.number}\" href=\"$name\" media-type=\"application/xhtml+xml\"/>")
            spine.append("<itemref idref=\"chapter${chapter.number}\"/>")
            toc.append("<li><a href=\"$name\">${escape(chapter.title)}</a></li>")
        }
        val container = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">" +
            "<rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>\n"
        val opf = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\">" +
            "<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:identifier id=\"bookid\">urn:uuid:${escape(workId)}</dc:identifier><dc:title>${escape(title)}</dc:title>" +
            "<dc:language>ko</dc:language><meta property=\"dcterms:modified\">${modified.truncatedTo(ChronoUnit.SECONDS)}</meta></metadata>" +
            "<manifest><item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>$manifest</manifest><spine>$spine</spine></package>\n"
        val nav = page("목차", "<nav epub:type=\"toc\"><h1>목차</h1><ol>$toc</ol></nav>")
        return ByteArrayOutputStream().also { out ->
            ZipOutputStream(out).use { zip ->
                val mimetype = "application/epub+zip".toByteArray()
                // EPUB은 첫 항목 mimetype을 압축하지 않고 추가 필드 없이 두도록 요구한다.
                zip.putNextEntry(ZipEntry("mimetype").apply { method = ZipEntry.STORED; size = mimetype.size.toLong(); compressedSize = size; crc = CRC32().apply { update(mimetype) }.value })
                zip.write(mimetype); zip.closeEntry()
                val rest = linkedMapOf("META-INF/container.xml" to container.toByteArray(), "OEBPS/content.opf" to opf.toByteArray(), "OEBPS/nav.xhtml" to nav.toByteArray()) + chapterFiles + imageFiles
                rest.forEach { (path, bytes) -> zip.putNextEntry(ZipEntry(path)); zip.write(bytes); zip.closeEntry() }
            }
        }.toByteArray()
    }
}
