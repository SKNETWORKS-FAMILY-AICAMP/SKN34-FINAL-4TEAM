package ai.storyfork.content.manuscript.domain

import ai.storyfork.content._common.exception.ContentFailure
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.StringReader
import java.net.URLDecoder
import java.util.zip.ZipInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.springframework.web.util.HtmlUtils
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import org.xml.sax.InputSource

/**
 * EPUB 원고. spine 순서의 XHTML 한 장이 단위이고 기본으로 한 회차가 된다.
 * ZIP 항목은 디스크에 쓰지 않고 메모리에서만 읽으며, 외부 자원은 어떤 것도 불러오지 않는다.
 */
class EpubManuscript private constructor(private val chapters: List<Chapter>) : Manuscript {
    private class Chapter(val title: String, val text: String, val images: List<ParsedImage>, val missingImages: Int, val error: String?)

    override val format = "epub"
    override val unit = "chapter"
    override val unitCount get() = chapters.size
    override val episodes: List<ParsedEpisode> by lazy { chapters.indices.map { episode(it, it + 1) } }

    /** 합친 뒤쪽 장의 제목은 본문 첫 줄로 남긴다. 한 장이라도 읽지 못했으면 그 오류를 가진다. */
    override fun episode(from: Int, to: Int): ParsedEpisode {
        val range = chapters.subList(from, to)
        val text = (listOf(range.first().text) + range.drop(1).flatMap { listOf(it.title, it.text) }).filter { it.isNotEmpty() }.joinToString("\n")
        return ParsedEpisode(range.first().title, from, to, text, range.flatMap { it.images }, range.sumOf { it.missingImages }, range.firstNotNullOfOrNull { it.error })
    }

    companion object {
        private const val MAX_ENTRIES = 2_000
        private const val MAX_ENTRY_BYTES = 50L shl 20
        private const val MAX_TOTAL_BYTES = 200L shl 20
        // 메모리에 남기는 한도다. 회차 본문은 40,000자 이하라 텍스트 항목은 작게 제한하고, 이미지는 10 MiB를 넘으면 어차피 쓰지 않는다.
        private const val MAX_TEXT_ENTRY_BYTES = 4L shl 20
        private const val MAX_IMAGE_BYTES = 10L shl 20
        private const val MAX_TITLE = 120
        private const val MAX_ALT_TEXT = 300
        private const val MAX_DEPTH = 256
        private const val OPS = "http://www.idpf.org/2007/ops"
        private val FONT_ALGORITHMS = setOf("http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC")
        private val XHTML_TYPES = setOf("application/xhtml+xml", "text/html")
        // 본문·목차(텍스트)와 이미지 확장자만 메모리에 남기고 나머지(글꼴·CSS 등)는 크기만 센다.
        private val TEXT_EXTENSIONS = setOf("xml", "opf", "ncx", "xhtml", "html", "htm")
        private val IMAGE_EXTENSIONS = setOf("png", "jpg", "jpeg")
        private val BLOCKS = setOf("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote", "section", "article", "table", "tr", "hr")
        private val SKIP = setOf("head", "script", "style", "rt", "rp", "svg", "math")
        private val HEADINGS = setOf("h1", "h2", "h3")
        private val SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")
        private val HTML_SPACE = Regex("[ \\t\\r\\n\\u000C]+")
        // 안에 하위 선언([)이 없는 DOCTYPE만 떼어 낸다. 엔티티를 선언하는 DOCTYPE은 남겨서 파서가 거절한다.
        private val SIMPLE_DOCTYPE = Regex("<!DOCTYPE[^>\\[]*>", RegexOption.IGNORE_CASE)
        private val NAMED_ENTITY = Regex("&([A-Za-z][A-Za-z0-9]*);")
        private val XML_ENTITIES = setOf("amp", "lt", "gt", "quot", "apos")

        private fun tooBig() = ContentFailure(422, "EPUB 안의 파일이 너무 많거나 너무 커요.")
        private fun unreadable() = ContentFailure(422, "EPUB 파일을 읽지 못했어요.")
        private fun drm() = ContentFailure(422, "DRM이 걸린 EPUB은 가져올 수 없어요.")
        private fun <T> readable(action: () -> T): T = try { action() } catch (e: ContentFailure) { throw e } catch (_: Exception) { throw unreadable() }

        fun parse(bytes: ByteArray): EpubManuscript =
            EpubManuscript(readChapters(bytes, textOnly = false).toList())

        fun singleEpisodeBody(bytes: ByteArray, maxChars: Int): String {
            val body = StringBuilder()
            for (chapter in readChapters(bytes, textOnly = true)) {
                chapter.error?.let { throw ContentFailure(422, it) }
                if (chapter.text.isEmpty()) continue
                val separatorLength = if (body.isEmpty()) 0 else 1
                if (body.length.toLong() + separatorLength + chapter.text.length > maxChars) {
                    throw ContentFailure(422, "본문이 ${maxChars}자를 넘어 등록할 수 없어요.")
                }
                if (body.isNotEmpty()) body.append('\n')
                body.append(chapter.text)
            }
            if (body.isBlank()) throw ContentFailure(422, "읽을 수 있는 본문이 없어요.")
            return body.toString()
        }

        private fun readChapters(bytes: ByteArray, textOnly: Boolean): Sequence<Chapter> {
            val files = read(bytes, textOnly)
            checkDrm(files)
            val container = readable { xml(files["META-INF/container.xml"] ?: throw unreadable()) }
            val opfPath = container.elements("rootfile").firstOrNull()?.getAttribute("full-path")?.let { resolve("", it) } ?: throw unreadable()
            val opf = readable { xml(files[opfPath] ?: throw unreadable()) }
            val base = opfPath.substringBeforeLast('/', "")
            val items = opf.elements("item").mapNotNull { e ->
                resolve(base, e.getAttribute("href"))?.let { e.getAttribute("id") to Item(it, e.getAttribute("media-type"), e.getAttribute("properties")) }
            }.toMap()
            val references = opf.elements("itemref")
            if (textOnly && references.size > MAX_ENTRIES) throw tooBig()
            val spine = references.mapNotNull { ref ->
                val item = items[ref.getAttribute("idref")]
                if (textOnly) {
                    if (item == null) throw ContentFailure(422, "EPUB의 읽기 순서가 가리키는 문서를 찾지 못했어요.")
                    if (item.type !in XHTML_TYPES) throw ContentFailure(422, "EPUB에 읽을 수 없는 형식의 본문 문서가 있어요.")
                }
                item?.takeIf { it.type in XHTML_TYPES }
            }
            if (spine.isEmpty()) throw ContentFailure(422, "읽을 수 있는 장이 없어요.")
            // Repeated spine references must also fit the byte budget for XML parsing.
            if (textOnly && spine.sumOf { files[it.path]?.size?.toLong() ?: 0L } > MAX_TOTAL_BYTES) {
                throw tooBig()
            }
            if (!textOnly && spine.size > MAX_EPISODES) throw tooManyEpisodes(spine.size)
            val labels = HashMap<String, String>()
            if (!textOnly) {
                items.values.firstOrNull { "nav" in it.properties.split(' ') }?.let {
                    navLabels(it.path, files, labels) { doc -> navLinks(doc) }
                }
                items.values.firstOrNull { it.type == "application/x-dtbncx+xml" }?.let {
                    navLabels(it.path, files, labels) { doc -> ncxLinks(doc) }
                }
            }
            return spine.asSequence().mapIndexed { index, item ->
                chapter(item.path, files, labels[item.path], index + 1, textOnly)
            }
        }

        private class Item(val path: String, val type: String, val properties: String)

        /**
         * 헤더의 크기를 믿지 않고 실제로 읽은 바이트를 센다. 항목 수·항목 크기·전체 크기 중 하나라도 넘으면 422다.
         * 메모리에는 텍스트 항목(4 MiB까지, 넘으면 422)과 이미지(10 MiB까지, 넘으면 빠진 이미지)만 남기고,
         * 나머지 항목은 고정 버퍼로 크기만 센다.
         */
        private fun read(bytes: ByteArray, textOnly: Boolean): Map<String, ByteArray> {
            val files = HashMap<String, ByteArray>()
            val buffer = ByteArray(64 * 1024)
            var count = 0
            var total = 0L
            try {
                ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                    while (true) {
                        val entry = zip.nextEntry ?: break
                        if (++count > MAX_ENTRIES) throw tooBig()
                        val extension = entry.name.substringAfterLast('.', "").lowercase()
                        val isText = !entry.isDirectory && extension in TEXT_EXTENSIONS
                        val limit = when {
                            isText -> MAX_TEXT_ENTRY_BYTES
                            !entry.isDirectory && !textOnly && extension in IMAGE_EXTENSIONS -> MAX_IMAGE_BYTES
                            else -> 0L
                        }
                        var kept = if (limit > 0) ByteArrayOutputStream() else null
                        val room = minOf(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - total)
                        var size = 0L
                        while (true) {
                            val n = zip.read(buffer)
                            if (n < 0) break
                            size += n
                            if (size > room) throw tooBig()
                            if (size > limit) {
                                if (isText) throw tooBig()
                                kept = null
                            }
                            kept?.write(buffer, 0, n)
                        }
                        total += size
                        kept?.let { files[entry.name] = it.toByteArray() }
                    }
                }
            } catch (e: ContentFailure) { throw e } catch (_: Exception) { throw unreadable() }
            return files
        }

        /** rights.xml이 있거나 글꼴 난독화 말고 다른 암호화가 있으면 DRM으로 보고 거절한다. */
        private fun checkDrm(files: Map<String, ByteArray>) {
            if (files.keys.any { it.equals("META-INF/rights.xml", ignoreCase = true) }) throw drm()
            val encryption = files.entries.firstOrNull { it.key.equals("META-INF/encryption.xml", ignoreCase = true) }?.value ?: return
            if (readable { xml(encryption).elements("EncryptionMethod") }.any { it.getAttribute("Algorithm") !in FONT_ALGORITHMS }) throw drm()
        }

        /**
         * DOCTYPE(하위 선언 없는 것)은 읽지 않고 떼어 낸다. 흔한 HTML 이름 엔티티는 숫자 참조로 바꾼 뒤 파싱하므로
         * 엔티티·외부 DTD·XInclude는 어떤 경로로도 불러오지 않는다. 하위 선언이 있는 DOCTYPE은 파서가 거절한다.
         */
        private fun xml(bytes: ByteArray): Document {
            val text = String(bytes, Charsets.UTF_8).removePrefix("\uFEFF").replaceFirst(SIMPLE_DOCTYPE, "").replace(NAMED_ENTITY) { match ->
                if (match.groupValues[1] in XML_ENTITIES) match.value else HtmlUtils.htmlUnescape(match.value).let { if (it == match.value) it else "&#${it.codePointAt(0)};" }
            }
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                isXIncludeAware = false
                isExpandEntityReferences = false
                setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
                setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                setFeature("http://xml.org/sax/features/external-general-entities", false)
                setFeature("http://xml.org/sax/features/external-parameter-entities", false)
                setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false)
                setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
                setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
            }
            val builder = factory.newDocumentBuilder().apply { setEntityResolver { _, _ -> InputSource(StringReader("")) } }
            return builder.parse(InputSource(StringReader(text)))
        }

        private fun Document.elements(name: String) = getElementsByTagNameNS("*", name).elements()
        private fun Element.elements(name: String) = getElementsByTagNameNS("*", name).elements()
        private fun NodeList.elements(): List<Element> = (0 until length).map { item(it) as Element }

        /** href를 base 디렉터리 기준 ZIP 안 경로로 바꾼다. 절대 경로·스킴·역슬래시·ZIP 루트 밖(`..`)이면 null이라 그 자원은 쓰지 않는다. */
        private fun resolve(base: String, href: String): String? {
            val raw = href.substringBefore('#').substringBefore('?')
            if (raw.isBlank()) return null
            val decoded = try { URLDecoder.decode(raw.replace("+", "%2B"), Charsets.UTF_8) } catch (_: IllegalArgumentException) { return null }
            if (SCHEME.containsMatchIn(raw) || SCHEME.containsMatchIn(decoded) || decoded.startsWith('/') || '\\' in decoded || decoded.any { it.isISOControl() }) return null
            val parts = ArrayList<String>()
            if (base.isNotEmpty()) parts += base.split('/')
            for (segment in decoded.split('/')) when (segment) {
                "", "." -> {}
                ".." -> if (parts.isEmpty()) return null else parts.removeAt(parts.size - 1)
                else -> parts += segment
            }
            return parts.joinToString("/").takeIf { it.isNotEmpty() }
        }

        private fun collapse(text: String) = text.replace(HTML_SPACE, " ").trim()

        /** 목차 파일(nav·NCX)에서 장 경로별 첫 라벨을 모은다. 목차를 읽지 못해도 본문 제목으로 대신하므로 실패는 무시한다. */
        private fun navLabels(path: String, files: Map<String, ByteArray>, labels: MutableMap<String, String>, links: (Document) -> List<Pair<String, String>>) {
            val bytes = files[path] ?: return
            try {
                val dir = path.substringBeforeLast('/', "")
                for ((href, label) in links(xml(bytes))) resolve(dir, href)?.let { target -> collapse(label).takeIf { it.isNotEmpty() }?.let { labels.putIfAbsent(target, it) } }
            } catch (_: Exception) { /* 라벨 없이 진행 */ }
        }

        private fun navLinks(doc: Document): List<Pair<String, String>> {
            val navs = doc.elements("nav")
            val toc = navs.firstOrNull { "toc" in it.getAttributeNS(OPS, "type").split(' ') } ?: navs.firstOrNull() ?: return emptyList()
            return toc.elements("a").map { it.getAttribute("href") to it.textContent }
        }

        private fun ncxLinks(doc: Document): List<Pair<String, String>> = doc.elements("navPoint").mapNotNull { point ->
            val src = point.elements("content").firstOrNull()?.getAttribute("src") ?: return@mapNotNull null
            src to (point.elements("text").firstOrNull()?.textContent ?: "")
        }

        private fun chapter(path: String, files: Map<String, ByteArray>, label: String?, number: Int, textOnly: Boolean): Chapter {
            fun failed(reason: String) = Chapter(label?.let { collapse(it) }?.takeIf { it.isNotEmpty() }?.take(MAX_TITLE) ?: "${number}화", "", emptyList(), 0, reason)
            val bytes = files[path] ?: return failed("이 장을 찾지 못했어요.")
            return try { extract(path, xml(bytes), files, label, number, textOnly) } catch (_: Exception) { failed("이 장을 읽지 못했어요.") }
        }

        /** 블록 요소·br은 줄바꿈으로, img는 그 위치의 이미지 자리(IMAGE_PLACEHOLDER 한 줄)로 바꾼다. 제목으로 쓴 맨 앞 머리글은 본문에서 뺀다. */
        private fun extract(path: String, doc: Document, files: Map<String, ByteArray>, label: String?, number: Int, textOnly: Boolean): Chapter {
            val dir = path.substringBeforeLast('/', "")
            val lines = ArrayList<String>()
            val images = ArrayList<ParsedImage>()
            var missing = 0
            val line = StringBuilder()
            var headingSeen = false
            var headingLine = -1
            var heading: String? = null
            fun flush() { collapse(line.toString()).takeIf { it.isNotEmpty() }?.let { lines += it }; line.setLength(0) }
            fun walk(node: Node, depth: Int) {
                check(depth <= MAX_DEPTH)
                when (node.nodeType) {
                    Node.TEXT_NODE, Node.CDATA_SECTION_NODE -> line.append(node.nodeValue.replace(IMAGE_PLACEHOLDER.toString(), "").replace(HTML_SPACE, " "))
                    Node.ELEMENT_NODE -> {
                        val name = node.localName.lowercase()
                        when {
                            name in SKIP -> {}
                            name == "br" -> flush()
                            name == "img" && textOnly -> flush()
                            name == "img" -> {
                                flush()
                                val image = image(dir, node as Element, files)
                                if (image == null) missing++ else { images += image; lines += IMAGE_PLACEHOLDER.toString() }
                            }
                            else -> {
                                val block = name in BLOCKS
                                val first = !headingSeen && name in HEADINGS
                                if (block) flush()
                                if (first) { headingSeen = true; headingLine = lines.size }
                                for (i in 0 until node.childNodes.length) walk(node.childNodes.item(i), depth + 1)
                                if (block) flush()
                                if (first && lines.size > headingLine) heading = lines[headingLine]
                            }
                        }
                    }
                }
            }
            walk(doc.getElementsByTagNameNS("*", "body").item(0) ?: doc.documentElement, 0)
            val title = listOf(label, heading, doc.getElementsByTagNameNS("*", "title").item(0)?.textContent)
                .firstNotNullOfOrNull { text -> text?.let { collapse(it) }?.takeIf { it.isNotEmpty() } }?.take(MAX_TITLE) ?: "${number}화"
            if (!textOnly && headingLine == 0 && heading == title) lines.removeAt(0)
            return Chapter(title, lines.joinToString("\n"), images, missing, null)
        }

        // 저장소(content_image)가 받는 형식이 PNG·JPEG뿐이라 WebP·GIF·SVG는 지원하지 않는 이미지로 센다.
        private fun image(dir: String, img: Element, files: Map<String, ByteArray>): ParsedImage? {
            val path = resolve(dir, img.getAttribute("src")) ?: return null
            val type = when (path.substringAfterLast('.', "").lowercase()) { "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; else -> return null }
            // 대체 텍스트는 공백을 정리하고 제어 문자를 빼 300자로 자른다. 가져오기가 대체 텍스트 때문에 실패하지는 않는다.
            val alt = collapse(img.getAttribute("alt")).filterNot { it.isISOControl() }.take(MAX_ALT_TEXT).trim()
            return files[path]?.let { ParsedImage(it, type, alt) }
        }
    }
}
