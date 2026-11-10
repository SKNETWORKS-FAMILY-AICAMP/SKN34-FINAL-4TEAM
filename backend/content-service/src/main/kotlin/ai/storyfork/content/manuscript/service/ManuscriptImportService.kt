package ai.storyfork.content.manuscript.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.attachment.service.dto.AttachmentUploadPayload
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.manuscript.domain.*
import ai.storyfork.content.manuscript.service.dto.*
import java.io.IOException
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.multipart.MultipartFile

/**
 * TXT·EPUB 원고 미리보기와 등록 확정. 상태를 저장하지 않으므로 확정은 같은 파일을 다시 읽어 조정한 범위로 회차를 만든다.
 * 회차 생성·저장 버전·이미지는 기존 EpisodeService·EpisodeVersionService·AttachmentService의 공개 메서드를 그대로 쓴다.
 */
@Service
class ManuscriptImportService(
    private val episodes: EpisodeService,
    private val versions: EpisodeVersionService,
    private val attachments: AttachmentService,
    @Qualifier("contentTransactions") private val transactions: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** 저장하지 않고 파일을 읽어 회차 후보를 보여 준다. 소유자가 아니면 파일을 읽기 전에 404다. */
    fun preview(work: String, owner: String, file: MultipartFile?): ManuscriptPreviewResponse {
        val existing = existingEpisodeCount(work, owner)
        val manuscript = parse(file)
        return ManuscriptPreviewResponse(manuscript.format, manuscript.unit, manuscript.unitCount, existing, manuscript.episodes.map { previewOf(it) })
    }

    /**
     * 요청 전체를 검증한 뒤(실패하면 아무것도 저장하지 않는 422) 회차를 번호 순서대로 하나씩 독립적으로 저장한다.
     * 일부가 실패해도 결과에 담아 돌려주며, 앞 회차가 실패해 생긴 공백 뒤의 번호는 등록하지 않는다.
     */
    fun confirm(work: String, owner: String, file: MultipartFile?, request: ManuscriptImportRequest?): ManuscriptImportResponse {
        var count = existingEpisodeCount(work, owner)
        checkContent(request?.rightsConfirmed == true, message = "원고를 등록하려면 권리 확인이 필요해요.")
        val manuscript = parse(file)
        val items = requireNotNull(request).items
        validate(items, manuscript.unitCount)
        // 저장된 회차(created·versioned·partial)는 그 번호까지 회차가 있다는 뜻이라 다음 번호의 기준이 된다.
        val results = items.map { item ->
            importOne(work, owner, item, manuscript.episode(item.from, item.to), count).also { if (it.status != "failed") count = maxOf(count, item.number) }
        }
        return ManuscriptImportResponse(results.count { it.status != "failed" }, results.count { it.status == "failed" }, results)
    }

    /** 현재 회차 수는 새 회차 번호를 정하는 EpisodeService.create와 같은 기준(가장 큰 번호)이다. */
    private fun existingEpisodeCount(work: String, owner: String) = episodes.list(work, owner).items.maxOfOrNull { it.number } ?: 0

    private fun parse(upload: MultipartFile?): Manuscript {
        val file = upload ?: throw ContentFailure(422, "올릴 파일을 선택해 주세요.")
        val name = file.originalFilename.orEmpty().substringAfterLast('/').substringAfterLast('\\')
        val extension = name.substringAfterLast('.', "").lowercase()
        val limit = when (extension) {
            "txt" -> TXT_LIMIT
            "epub" -> EPUB_LIMIT
            else -> throw ContentFailure(422, "지원하지 않는 형식이에요. .txt 또는 .epub 파일만 올릴 수 있어요.")
        }
        fun tooLarge() = ContentFailure(413, if (extension == "txt") "TXT 파일은 10MB 이하만 올릴 수 있어요." else "EPUB 파일은 50MB 이하만 올릴 수 있어요.")
        if (file.size > limit) throw tooLarge()
        val bytes = try { file.inputStream.use { it.readNBytes(limit + 1) } } catch (_: IOException) { throw ContentFailure(422, "파일을 읽지 못했어요.") }
        if (bytes.size > limit) throw tooLarge()
        val manuscript = if (extension == "txt") TxtManuscript.parse(bytes, name) else EpubManuscript.parse(bytes)
        if (manuscript.episodes.size > MAX_EPISODES) throw tooManyEpisodes(manuscript.episodes.size)
        return manuscript
    }

    private fun previewOf(episode: ParsedEpisode) = ManuscriptPreviewEpisode(
        episode.title, episode.from, episode.to, episode.bodyLength, episode.text.replace(IMAGE_PLACEHOLDER.toString(), "[이미지]").take(EXCERPT), episode.images.size,
        listOfNotNull(
            episode.error,
            BODY_TOO_LONG.takeIf { episode.bodyLength > MAX_BODY },
            "지원하지 않는 이미지 ${episode.missingImages}개는 빠져요.".takeIf { episode.missingImages > 0 },
            "회차당 이미지는 ${MAX_IMAGES}개까지라 ${episode.images.size - MAX_IMAGES}개는 빠져요.".takeIf { episode.images.size > MAX_IMAGES },
        ),
    )

    private fun validate(items: List<ManuscriptImportItem>, unitCount: Int) {
        checkContent(items.isNotEmpty(), message = "등록할 회차를 하나 이상 골라 주세요.")
        checkContent(items.size <= MAX_EPISODES, message = "한 번에 ${MAX_EPISODES}회차까지 등록할 수 있어요.")
        items.forEachIndexed { i, item ->
            checkContent(item.number >= 1 && (i == 0 || item.number > items[i - 1].number), message = "회차 번호는 1 이상이고 오름차순이어야 하며 겹치지 않아야 해요.")
            checkContent(item.from >= 0 && item.from < item.to && item.to <= unitCount, message = "회차 범위를 확인해 주세요.")
            checkContent(i == 0 || item.from >= items[i - 1].to, message = "회차 범위가 서로 겹치거나 순서가 맞지 않아요.")
        }
    }

    private fun importOne(work: String, owner: String, item: ManuscriptImportItem, episode: ParsedEpisode, count: Int): ManuscriptImportResult {
        val title = item.title.trim()
        fun failed(reason: String) = ManuscriptImportResult(item.number, title, "failed", reason, 0)
        episode.error?.let { return failed(it) }
        if (item.number > count + 1) return failed("앞 회차가 없어 등록할 수 없어요.")
        if (title.isEmpty() || title.length > MAX_TITLE) return failed("제목은 1~${MAX_TITLE}자로 입력해 주세요.")
        if (episode.bodyLength > MAX_BODY) return failed(BODY_TOO_LONG)
        return try {
            save(work, owner, item, title, episode, creating = item.number == count + 1)
        } catch (e: ContentFailure) {
            failed(e.message)
        } catch (e: RuntimeException) {
            log.warn("원고 가져오기 회차 저장 실패: work={} number={}", work, item.number, e)
            failed("저장하지 못했어요. 잠시 후 다시 시도해 주세요.")
        }
    }

    private fun save(work: String, owner: String, item: ManuscriptImportItem, title: String, episode: ParsedEpisode, creating: Boolean): ManuscriptImportResult {
        val existing = if (creating) null else episodes.read(work, owner, item.number)
        if (existing?.inherited == true) return ManuscriptImportResult(item.number, title, "failed", "원작 기준 회차는 수정할 수 없어요.", 0)
        var failedImages = 0
        if (episode.images.isEmpty()) {
            // 새 회차 만들기와 저장 버전이 한 트랜잭션이라 하나라도 실패하면 둘 다 취소된다.
            transactions.executeWithoutResult {
                val revision = existing?.draft?.revision ?: createEpisode(work, owner, item.number, title).draft.revision
                stack(work, owner, item.number, existing, revision, title, episode.text)
            }
        } else {
            // 이미지는 회차가 있어야 올릴 수 있고 이미지 저장소 DB 연결이 달라 같은 트랜잭션에 묶지 못한다. 회차를 먼저 확정한 뒤 올린다.
            val made = if (creating) createEpisode(work, owner, item.number, title) else null
            val revision = made?.draft?.revision ?: existing!!.draft.revision
            val uploaded = episode.images.map { upload(work, owner, item.number, it) }
            failedImages = uploaded.count { it == null }
            try {
                transactions.executeWithoutResult { stack(work, owner, item.number, existing, revision, title, withMarkers(episode.text, uploaded)) }
            } catch (e: RuntimeException) {
                uploaded.filterNotNull().forEach { discard(work, owner, item.number, it) }
                made?.let { removeEpisode(work, owner, it) }
                throw e
            }
        }
        val missing = episode.missingImages + failedImages
        val status = if (missing > 0) "partial" else if (creating) "created" else "versioned"
        return ManuscriptImportResult(item.number, title, status, "이미지 ${missing}개를 가져오지 못했어요.".takeIf { missing > 0 }, missing)
    }

    /**
     * 가져온 원고를 새 저장 버전으로 쌓는다. 기존 회차의 현재 초안이 최신 저장 버전과 다르면(UC-03 E4: 기존 원고를 묵시적으로 덮어쓰지 않는다)
     * 덮어쓰기 전에 그 초안을 그대로 저장 버전으로 남긴다. 두 저장은 한 트랜잭션이라 하나라도 실패하면 함께 취소된다.
     */
    private fun stack(work: String, owner: String, number: Int, existing: EpisodeResponse?, revision: Int, title: String, body: String) {
        val next = if (existing != null && hasUnsavedDraft(existing)) versions.save(work, owner, number, DraftRequest(existing.draft.title, existing.draft.body, revision, existing.draft.authorNote)).draft.revision else revision
        versions.save(work, owner, number, DraftRequest(title, body, next, existing?.draft?.authorNote.orEmpty()))
    }

    /** 최신 저장 버전과 제목·본문이 다른 초안이다. 저장 버전이 없으면 본문이 있는 초안이다. 빈 초안과 초안 없는 회차는 보존하지 않는다. */
    private fun hasUnsavedDraft(episode: EpisodeResponse): Boolean {
        if (!episode.hasDraft) return false
        val latest = episode.versions.lastOrNull() ?: return episode.draft.body.isNotEmpty() || episode.draft.authorNote.isNotEmpty()
        return episode.draft.title != latest.title || episode.draft.body != latest.body || episode.draft.authorNote != latest.authorNote
    }

    /** 다른 편집으로 회차 수가 바뀌어 만든 번호가 어긋나면 엉뚱한 회차에 저장하지 않도록 만든 회차를 정리하고 거절한다. */
    private fun createEpisode(work: String, owner: String, number: Int, title: String): EpisodeResponse {
        val made = episodes.create(work, owner, CreateEpisodeRequest(title))
        if (made.number != number) {
            removeEpisode(work, owner, made)
            throw ContentFailure(409, "회차 번호가 바뀌었어요. 다시 시도해 주세요.")
        }
        return made
    }

    /** 이미지 하나를 검사해 올리고 ID를 돌려준다. 읽지 못하거나 올리지 못하면 그 이미지만 null(빠진 이미지)이다. */
    private fun upload(work: String, owner: String, number: Int, image: ParsedImage): String? = try {
        AttachmentUploadHelper.validateImage(image.bytes, image.mediaType)
        val payload = AttachmentUploadPayload(if (image.mediaType == "image/png") "image.png" else "image.jpg", image.mediaType, "IMAGE", image.bytes)
        attachments.createEpisodeImage(work, number, owner, payload, image.altText).id
    } catch (e: RuntimeException) {
        log.warn("원고 가져오기 이미지 건너뜀: work={} number={} reason={}", work, number, e.message)
        null
    }

    /** 이미지 자리 줄은 올린 이미지의 표식으로 바꾸고, 올리지 못한 이미지의 줄은 뺀다. */
    private fun withMarkers(text: String, uploaded: List<String?>): String {
        var next = 0
        return text.lines().mapNotNull { if (it == IMAGE_PLACEHOLDER.toString()) uploaded[next++]?.let { id -> "[[image:$id]]" } else it }.joinToString("\n")
    }

    private fun discard(work: String, owner: String, number: Int, id: String) {
        try { attachments.discardUnreferencedEpisodeImage(work, number, id, owner) } catch (e: RuntimeException) { log.warn("가져오기 실패 이미지 정리 실패: work={} number={} image={}", work, number, id, e) }
    }

    private fun removeEpisode(work: String, owner: String, episode: EpisodeResponse) {
        try { episodes.deleteEpisode(work, owner, episode.number, episode.draft.revision) } catch (e: RuntimeException) { log.warn("가져오기 실패 회차 정리 실패: work={} number={}", work, episode.number, e) }
    }

    private companion object {
        const val TXT_LIMIT = 10 * 1024 * 1024
        const val EPUB_LIMIT = 50 * 1024 * 1024
        const val MAX_TITLE = 120
        const val MAX_BODY = 40_000
        const val MAX_IMAGES = 10
        const val EXCERPT = 300
        const val BODY_TOO_LONG = "본문이 40,000자를 넘어 등록할 수 없어요."
    }
}
