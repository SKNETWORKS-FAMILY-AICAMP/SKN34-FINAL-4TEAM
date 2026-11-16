package ai.storyfork.content.notice.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.notice.entity.WorkNoticeEntity
import ai.storyfork.content.notice.repository.WorkNoticeRepository
import ai.storyfork.content.notice.service.dto.WorkNoticeListResponse
import ai.storyfork.content.notice.service.dto.WorkNoticeRequest
import ai.storyfork.content.notice.service.dto.WorkNoticeResponse
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

private val CATEGORIES = setOf("info", "hiatus", "event")

/**
 * 작품 소식(공지)의 공개 목록과 작성·전체 수정·소프트 삭제를 맡는다. 쓰기는 작품 소유자와 운영자만 하고 그 밖의 회원은 403이다.
 * 입력 오류(422)는 작품 조회(404)와 권한(403)보다 먼저 판정한다. 등록·수정 때 회원 알림은 보내지 않는다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class WorkNoticeService(
    private val access: WorkAccessService,
    private val notices: WorkNoticeRepository,
) {

    /** 공개 작품의 소식 목록이다. 고정 먼저, 그 안에서 최신순이며 최대 200개다. 비공개·제한·삭제 작품은 404다. */
    fun list(id: String): WorkNoticeListResponse {
        access.published(id)
        return WorkNoticeListResponse(notices.findTop200ByWorkIdAndDeletedAtIsNullOrderByPinnedDescCreatedAtDescIdDesc(id).map(::respond))
    }

    /** 소식을 쓴다. 소유자의 비공개 작품에도 쓸 수 있고(공개 전 준비) 삭제된 작품은 404다. */
    fun create(id: String, member: String, operator: Boolean, data: WorkNoticeRequest): WorkNoticeResponse {
        val clean=clean(data)
        manageable(id,member,operator)
        return respond(notices.save(WorkNoticeEntity(contentId(),id,member,clean.category,clean.title,clean.body,clean.pinned)))
    }

    /** 소식을 전체 수정한다(고정 설정·해제 포함). 다른 작품의 소식이거나 삭제됐으면 404이며, 처음 쓴 회원은 바뀌지 않는다. */
    fun update(id: String, noticeId: String, member: String, operator: Boolean, data: WorkNoticeRequest): WorkNoticeResponse {
        val clean=clean(data)
        manageable(id,member,operator)
        val row=find(id,noticeId)
        row.category=clean.category
        row.title=clean.title
        row.body=clean.body
        row.pinned=clean.pinned
        row.updatedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
        return respond(row)
    }

    /** 소프트 삭제한다. deleted_at만 기록하며 이후 목록·수정·삭제에서 404다. */
    fun delete(id: String, noticeId: String, member: String, operator: Boolean) {
        manageable(id,member,operator)
        find(id,noticeId).deletedAt=Instant.now().truncatedTo(ChronoUnit.MICROS)
    }

    /** 소유자나 운영자가 쓸 수 있는 작품인지 본다. 없거나 삭제된 작품은 404, 그 밖의 회원은 403이다(소식이 있는지는 알리지 않는다). */
    private fun manageable(id: String, member: String, operator: Boolean) {
        val work=access.get(id)
        checkContent(!work.deleted,404,"작품을 찾을 수 없어요.")
        checkContent(operator || work.ownerId==member,403,"작품 소유자나 운영자만 소식을 관리할 수 있어요.")
    }

    /** 삭제되지 않은 소식 하나다. 다른 작품의 소식이면 404다. */
    private fun find(id: String, noticeId: String): WorkNoticeEntity =
        notices.findByIdAndWorkIdAndDeletedAtIsNull(noticeId,id) ?: throw ContentFailure(404,"소식을 찾을 수 없어요.")

    // Kotlin trim·isBlank는 NBSP도 공백으로 본다(Bean Validation @NotBlank와 다르다). U+0000은 PostgreSQL text에 저장할 수 없다.
    private fun clean(data: WorkNoticeRequest): WorkNoticeRequest {
        checkContent(data.category in CATEGORIES,message="분류는 안내(info)·휴재(hiatus)·이벤트(event) 중 하나로 보내 주세요.")
        val title=data.title.trim()
        checkContent(title.isNotBlank() && title.length<=200 && '\u0000' !in title,message="제목은 1~200자로 입력해 주세요.")
        val body=data.body.trim()
        checkContent(body.isNotBlank() && body.length<=20_000 && '\u0000' !in body,message="본문은 1~20,000자로 입력해 주세요.")
        return data.copy(title=title,body=body)
    }

    private fun respond(row: WorkNoticeEntity) =
        WorkNoticeResponse(row.id,row.workId,row.category,row.title,row.body,row.pinned,row.createdAt,row.updatedAt)
}
