package ai.storyfork.content.manuscript

import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.imageio.ImageIO

/** 테스트용 EPUB·ZIP 조립기. 일부러 깨지거나 위험한 파일도 만들 수 있도록 항목 이름과 내용을 그대로 쓴다. */
internal object EpubFixture {
    val png: ByteArray = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "png", it) }.toByteArray()
    val jpeg: ByteArray = ByteArrayOutputStream().also { ImageIO.write(BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB), "jpg", it) }.toByteArray()

    fun xhtml(body: String, title: String = "", doctype: String = "<!DOCTYPE html>") =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n$doctype\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><head><title>$title</title></head><body>$body</body></html>"

    fun zip(entries: Map<String, ByteArray>): ByteArray = ByteArrayOutputStream().also { out ->
        ZipOutputStream(out).use { zip -> entries.forEach { (name, bytes) -> zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry() } }
    }.toByteArray()

    /** 같은 바이트(0)를 size만큼 압축해 넣은 ZIP. 메모리에 size만큼 올리지 않고 흘려 쓴다. */
    fun zeros(vararg sizes: Pair<String, Long>): ByteArray = ByteArrayOutputStream().also { out ->
        ZipOutputStream(out).use { zip ->
            val block = ByteArray(1 shl 20)
            for ((name, size) in sizes) {
                zip.putNextEntry(ZipEntry(name))
                var left = size
                while (left > 0) { val n = minOf(left, block.size.toLong()).toInt(); zip.write(block, 0, n); left -= n }
                zip.closeEntry()
            }
        }
    }.toByteArray()

    /**
     * chapters는 (OPF 기준 파일 경로, XHTML) 목록이다. nav·ncx는 (chapter 경로, 라벨) 목록이며 주면 해당 목차 파일을 만든다.
     * manifest는 추가 manifest 항목 XML, extra는 그대로 넣을 ZIP 항목(이름은 ZIP 루트 기준)이다.
     */
    fun epub(
        chapters: List<Pair<String, String>>, nav: List<Pair<String, String>>? = null, ncx: List<Pair<String, String>>? = null,
        manifest: String = "", spine: String? = null, extra: Map<String, ByteArray> = emptyMap(), opfPath: String = "OEBPS/content.opf",
    ): ByteArray {
        val dir = opfPath.substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it/" }
        val files = linkedMapOf<String, ByteArray>("mimetype" to "application/epub+zip".toByteArray())
        files["META-INF/container.xml"] = """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="$opfPath" media-type="application/oebps-package+xml"/></rootfiles></container>""".toByteArray()
        val items = StringBuilder()
        chapters.forEachIndexed { i, (path, _) -> items.append("""<item id="c$i" href="$path" media-type="application/xhtml+xml"/>""") }
        if (nav != null) {
            items.append("""<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>""")
            files[dir + "nav.xhtml"] = xhtml("""<nav epub:type="toc"><ol>${nav.joinToString("") { (href, label) -> """<li><a href="$href">$label</a></li>""" }}</ol></nav>""").toByteArray()
        }
        if (ncx != null) {
            items.append("""<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>""")
            files[dir + "toc.ncx"] = """<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${ncx.mapIndexed { i, (src, label) -> """<navPoint id="n$i" playOrder="${i + 1}"><navLabel><text>$label</text></navLabel><content src="$src"/></navPoint>""" }.joinToString("")}</navMap></ncx>""".toByteArray()
        }
        val itemrefs = spine ?: chapters.indices.joinToString("") { """<itemref idref="c$it"/>""" }
        files[opfPath] = """<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:test</dc:identifier><dc:title>테스트</dc:title><dc:language>ko</dc:language></metadata><manifest>$items$manifest</manifest><spine${if (ncx != null) " toc=\"ncx\"" else ""}>$itemrefs</spine></package>""".toByteArray()
        chapters.forEach { (path, xml) -> files[dir + path] = xml.toByteArray() }
        files.putAll(extra)
        return zip(files)
    }
}
