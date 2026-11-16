package ai.storyfork.content.manuscript.domain

/** TXT 내보내기. UTF-8 BOM, 작품 제목(전체일 때)과 회차를 빈 줄 두 개로 구분하며 이미지 표식은 지운다. */
object TxtManuscriptWriter {
    fun write(workTitle: String?, chapters: List<ExportChapter>): ByteArray {
        val blocks = listOfNotNull(workTitle) + chapters.map { "${it.title}\n\n${it.body.replace(IMAGE_MARKER, "")}" }
        return "\uFEFF${blocks.joinToString("\n\n\n")}\n".toByteArray(Charsets.UTF_8)
    }
}
