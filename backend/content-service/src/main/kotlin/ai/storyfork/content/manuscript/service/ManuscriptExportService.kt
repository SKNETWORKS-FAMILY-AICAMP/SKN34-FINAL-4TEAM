package ai.storyfork.content.manuscript.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.manuscript.domain.EpubManuscriptWriter
import ai.storyfork.content.manuscript.domain.ExportChapter
import ai.storyfork.content.manuscript.domain.ParsedImage
import ai.storyfork.content.manuscript.domain.TxtManuscriptWriter
import ai.storyfork.content.manuscript.service.dto.ManuscriptExportResult
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

/** 소유자의 초안·발행본을 TXT 또는 EPUB 파일로 만든다. Fork의 상속 회차는 빼고, 이미지는 기존 원고 이미지 다운로드 경로로 읽는다. */
@Service
class ManuscriptExportService(
    private val access: WorkAccessService,
    private val episodes: EpisodeService,
    private val attachments: AttachmentService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** episode가 없으면 작품 전체, 있으면 그 회차 하나다. 소유자가 아니면 형식 검사보다 먼저 404다. */
    fun export(work: String, owner: String, format: String?, source: String?, episode: Int?): ManuscriptExportResult {
        val workTitle = access.own(work, owner).title
        checkContent(format == "txt" || format == "epub", message = "내보내기 형식은 txt 또는 epub이에요.")
        checkContent(source == "draft" || source == "published", message = "내보내기 대상은 draft(초안) 또는 published(발행본)이에요.")
        val rows = if (episode == null) episodes.list(work, owner).items.filter { !it.inherited }
        else listOf(episodes.read(work, owner, episode).also { checkContent(!it.inherited, 403, "원작 기준 회차는 내보낼 수 없어요.") })
        val chapters = rows.mapNotNull { chapter(it, source == "published") }
        checkContent(chapters.isNotEmpty(), message = "내보낼 수 있는 회차가 없어요.")
        val name = if (episode == null) workTitle else chapters.single().title
        if (format == "txt") return ManuscriptExportResult(TxtManuscriptWriter.write(workTitle.takeIf { episode == null }, chapters), "text/plain;charset=UTF-8", filename(name, "txt"))
        // 대체 텍스트는 회차의 이미지 목록에서 한 번만 읽는다.
        val altTexts = HashMap<Int, Map<String, String>>()
        val epub = EpubManuscriptWriter.write(work, workTitle, chapters, Instant.now()) { number, id ->
            try {
                val downloaded = attachments.downloadEpisodeImage(work, number, id, owner, false)
                val alt = altTexts.getOrPut(number) { attachments.listEpisodeImages(work, number, owner).images.associate { it.id to it.altText } }[id].orEmpty()
                ParsedImage(downloaded.bytes, downloaded.attachment.mediaType, alt)
            } catch (e: RuntimeException) {
                log.warn("원고 내보내기 이미지 건너뜀: work={} number={} image={} reason={}", work, number, id, e.message)
                null
            }
        }
        return ManuscriptExportResult(epub, "application/epub+zip", filename(name, "epub"))
    }

    private fun chapter(episode: EpisodeResponse, published: Boolean): ExportChapter? =
        if (!published) ExportChapter(episode.number, episode.draft.title, episode.draft.body)
        else episode.publishedVersionId?.let { id -> episode.versions.firstOrNull { it.id == id } }?.let { ExportChapter(episode.number, it.title, it.body) }

    private fun filename(title: String, extension: String) = title.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().ifEmpty { "원고" } + "." + extension
}
