package ai.storyfork.content.feedbackreport.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.feedbackreport.domain.*
import ai.storyfork.content.feedbackreport.entity.FeedbackReportAmendmentEntity
import ai.storyfork.content.feedbackreport.entity.FeedbackReportEntity
import ai.storyfork.content.feedbackreport.entity.FeedbackReportResponseEntity
import ai.storyfork.content.feedbackreport.repository.FeedbackReportAmendmentRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportRepository
import ai.storyfork.content.feedbackreport.repository.FeedbackReportResponseRepository
import ai.storyfork.content.feedbackreport.service.dto.*
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

private const val NOT_FOUND = "제보를 찾을 수 없어요."

/** 응답 조립에 필요한 작품 제목과 소유자다. */
private data class WorkInfo(val title: String, val ownerId: String)

private fun WorkAccessResult.info() = WorkInfo(title, ownerId)

/**
 * 공개 작품의 발행 회차 제보 등록·열람과 제보자·작품 소유자의 처리를 맡는다. 제보는 지우지 않는다(DEC-42).
 * 제보 등록은 공개 작품·발행 회차만 대상이고, 이미 있는 제보의 처리는 작품이 삭제되지 않았으면 가능하다.
 * 작품 소유자 판단은 [WorkAccessService]를 재사용하고, 표시명은 응답마다 Core 닉네임으로 채운다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class FeedbackReportService(
    private val access: WorkAccessService,
    private val works: WorkRepository,
    private val current: EpisodeCurrentRepository,
    private val reports: FeedbackReportRepository,
    private val amendments: FeedbackReportAmendmentRepository,
    private val responses: FeedbackReportResponseRepository,
    private val nicknames: CoreNicknameService,
) {

    /**
     * 제보를 등록한다. 등록 시점의 발행 버전 ID를 고정 저장하며 입력 오류는 접근 판정보다 먼저 422다.
     * 응답의 제보자 이름은 Core 닉네임이고, 조회에 실패하면 예외가 트랜잭션을 되돌려 제보가 저장되지 않는다.
     */
    fun create(id: String, number: Int, member: String, data: CreateReportRequest): ReportResponse {
        val kind=reportKind(data.kind)
        val body=reportBody(data.body)
        val quote=reportQuote(data.quote)
        val visibility=reportVisibility(data.visibility)
        val work=access.published(id)
        val version=publishedVersion(id,number)
        val row=FeedbackReportEntity(contentId(),id,number,version,member,kind,body,quote,visibility,"unchecked")
        reports.save(row)
        return render(listOf(row),mapOf(id to work.info()),member).single()
    }

    /** 회차의 제보 목록이다. [viewer]가 볼 수 있는 것만 최신순으로 담으며 익명은 공개 제보와 공개 답변이 있는 제보(원문 숨김)만 본다. */
    fun list(id: String, number: Int, viewer: String?): ReportListResponse {
        val work=access.published(id)
        publishedVersion(id,number)
        // ponytail: 최근 200개 안에서 열람 권한을 거른다. 비공개 제보가 많은 회차는 오래된 공개 제보가 안 보일 수 있어 그때 DB 필터·페이지네이션으로 바꾼다.
        return ReportListResponse(render(reports.findTop200ByWorkIdAndEpisodeNumberOrderByCreatedAtDesc(id,number),mapOf(id to work.info()),viewer))
    }

    /** 제보 상세다. 다른 작품·회차의 제보이거나 [viewer]가 볼 수 없는 비공개 제보면 404다. */
    fun read(id: String, number: Int, reportId: String, viewer: String?): ReportResponse {
        val work=access.published(id)
        publishedVersion(id,number)
        val row=reports.findByIdAndWorkIdAndEpisodeNumber(reportId,id,number) ?: throw ContentFailure(404,NOT_FOUND)
        return render(listOf(row),mapOf(id to work.info()),viewer).singleOrNull() ?: throw ContentFailure(404,NOT_FOUND)
    }

    /** 내가 남긴 모든 제보다(최신순, 최대 200개). 작품이 비공개·삭제로 바뀌어도 내 제보는 남아 보인다. */
    fun mine(member: String): ReportListResponse {
        val rows=reports.findTop200ByReporterIdOrderByCreatedAtDesc(member)
        val titles=works.findAllById(rows.map {it.workId}.toSet()).associate {it.id to WorkInfo(it.title,it.ownerId)}
        return ReportListResponse(render(rows,titles,member))
    }

    /**
     * 내가 소유한(삭제되지 않은) 모든 작품의 제보다(최신순, 최대 200개). [workId]가 오면 그 작품의 제보만이며(200개 상한도 그 작품 안에서),
     * 내 작품이 아니거나 삭제됐거나 없으면 존재 여부를 드러내지 않도록 빈 목록이다. 빈 값(`workId=`)은 생략과 같다.
     */
    fun inbox(member: String, workId: String? = null): ReportListResponse {
        val owned=works.findAllByOwnerIdOrderByCreatedAtDesc(member).filter {it.deletedAt==null && (workId.isNullOrBlank() || it.id==workId)}
        if(owned.isEmpty()) return ReportListResponse(emptyList())
        return ReportListResponse(render(reports.findTop200ByWorkIdInOrderByCreatedAtDesc(owned.map {it.id}),owned.associate {it.id to WorkInfo(it.title,it.ownerId)},member))
    }

    /** 제보자만 공개 범위를 바꾼다. 철회한 뒤에도 바꿀 수 있다. */
    fun setVisibility(id: String, reportId: String, member: String, data: VisibilityRequest): ReportResponse {
        val visibility=reportVisibility(data.visibility)
        val (row,work)=lock(id,reportId,member,reporter=true)
        row.visibility=visibility
        touch(row)
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /** 제보자만 정정한다. 원문은 그대로 두고 정정 기록을 더하며 철회 뒤에는 409다. */
    fun correct(id: String, reportId: String, member: String, data: CorrectionRequest): ReportResponse {
        val text=correctionBody(data.body)
        val (row,work)=lock(id,reportId,member,reporter=true)
        ensureCanCorrect(row.withdrawnAt)
        amendments.save(FeedbackReportAmendmentEntity(contentId(),row.id,"correct",text))
        touch(row)
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /** 제보자만 한 번 철회한다. 상태와 원문은 그대로 두고 철회 기록과 시각만 남기며 두 번째는 409다. */
    fun withdraw(id: String, reportId: String, member: String): ReportResponse {
        val (row,work)=lock(id,reportId,member,reporter=true)
        ensureCanWithdraw(row.withdrawnAt)
        val now=now()
        amendments.save(FeedbackReportAmendmentEntity(contentId(),row.id,"withdraw",null,now))
        row.withdrawnAt=now
        row.updatedAt=now
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /** 작품 소유자만 확인한다. 확인 시각은 처음 한 번만 기록하고 확인 전이면 확인함이 된다. 이미 확인했다면 아무것도 바꾸지 않는다(멱등). */
    fun check(id: String, reportId: String, member: String): ReportResponse {
        val (row,work)=lock(id,reportId,member,reporter=false)
        if(row.authorCheckedAt==null) {
            val now=now()
            row.authorCheckedAt=now
            row.status=statusAfterCheck(row.status)
            row.updatedAt=now
        }
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /** 작품 소유자만 답변한다. 답변하면 확인 전·확인함은 답변함이 되고 공개 답변만 제3자에게 보인다. 확인한 적이 없으면 확인 시각도 함께 기록한다. */
    fun answer(id: String, reportId: String, member: String, data: ResponseRequest): ReportResponse {
        val text=responseBody(data.body)
        val (row,work)=lock(id,reportId,member,reporter=false)
        responses.save(FeedbackReportResponseEntity(contentId(),row.id,member,text,data.isPublic))
        row.status=statusAfterResponse(row.status)
        touchByAuthor(row)
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /**
     * 작품 소유자만 처리 상태를 바꾼다. 확인함·답변함·처리 완료·종료 중 아무 값으로나 바꿀 수 있고 확인 전으로는 되돌릴 수 없다(422).
     * 확인한 적이 없으면 확인 시각도 함께 기록한다.
     */
    fun setStatus(id: String, reportId: String, member: String, data: StatusRequest): ReportResponse {
        val status=settableStatus(data.status)
        val (row,work)=lock(id,reportId,member,reporter=false)
        row.status=status
        touchByAuthor(row)
        return render(listOf(row),mapOf(id to work),member).single()
    }

    /** 공개 작품의 발행 회차만 대상이다. 현재 발행 버전 ID를 돌려주며 미발행 회차는 404다. */
    private fun publishedVersion(id: String, number: Int): String =
        current.findByWorkIdAndSequence(id,number)?.publishedVersionId ?: throw ContentFailure(404,"공개 회차를 찾을 수 없어요.")

    /**
     * 쓰기 대상 제보를 잠그고 읽는다. 작품이 없거나 삭제됐거나 경로의 작품과 제보가 맞지 않으면 404다.
     * 제보자([reporter]=true: 공개 범위·정정·철회)나 작품 소유자([reporter]=false: 확인·답변·상태 변경)가 아니면 403이지만,
     * 요청자가 볼 수도 없는 비공개 제보는 존재를 숨기려고 404다.
     */
    private fun lock(id: String, reportId: String, member: String, reporter: Boolean): Pair<FeedbackReportEntity,WorkInfo> {
        val work=access.get(id)
        checkContent(!work.deleted,404,"작품을 찾을 수 없어요.")
        val row=reports.lockByIdAndWorkId(reportId,id) ?: throw ContentFailure(404,NOT_FOUND)
        val mine=row.reporterId==member
        val owner=work.ownerId==member
        if(!(if(reporter) mine else owner)) {
            val seen=reportView(row.visibility,mine,owner,responses.findAllByReportIdIn(listOf(row.id)).any {it.isPublic})
            checkContent(seen!=ReportView.HIDDEN,404,NOT_FOUND)
            throw ContentFailure(403,if(reporter) "제보자만 할 수 있어요." else "작품 소유자만 할 수 있어요.")
        }
        return row to work.info()
    }

    private fun now(): Instant = Instant.now().truncatedTo(ChronoUnit.MICROS)

    private fun touch(row: FeedbackReportEntity) { row.updatedAt=now() }

    /** 작가의 답변·상태 변경은 제보를 본 것이라 확인 시각이 없으면 이번 수정 시각으로 기록한다(처음 기록은 바꾸지 않는다). */
    private fun touchByAuthor(row: FeedbackReportEntity) {
        touch(row)
        row.authorCheckedAt=row.authorCheckedAt ?: row.updatedAt
    }

    private class Shown(val row: FeedbackReportEntity, val work: WorkInfo, val mine: Boolean, val owner: Boolean, val view: ReportView, val replies: List<FeedbackReportResponseEntity>)

    /**
     * 제보를 [viewer] 기준 응답으로 만든다. 볼 수 없는 제보는 뺀다. 원문을 볼 수 없는 제보(공개 답변만 노출)는 원문·인용·제보자 이름·정정을 비우고,
     * 비공개 답변은 제보자와 작품 소유자에게만 보인다. 표시명은 보이는 사람의 ID를 모아 Core에 한 번만 묻는다.
     */
    private fun render(rows: List<FeedbackReportEntity>, works: Map<String,WorkInfo>, viewer: String?): List<ReportResponse> {
        if(rows.isEmpty()) return emptyList()
        val ids=rows.map {it.id}
        val replies=responses.findAllByReportIdIn(ids).groupBy {it.reportId}
        val corrections=amendments.findAllByReportIdIn(ids).groupBy {it.reportId}
        val shown=rows.mapNotNull {row ->
            val work=works.getValue(row.workId)
            val mine=row.reporterId==viewer
            val owner=work.ownerId==viewer
            val all=replies[row.id].orEmpty().sortedBy {it.createdAt}
            val view=reportView(row.visibility,mine,owner,all.any {it.isPublic})
            if(view==ReportView.HIDDEN) null else Shown(row,work,mine,owner,view,if(mine || owner) all else all.filter {it.isPublic})
        }
        val names=nicknames.nicknames(shown.flatMap {s -> s.replies.map {it.authorId}+listOfNotNull(s.row.reporterId.takeIf {s.view==ReportView.FULL})})
        return shown.map {s ->
            val row=s.row
            val full=s.view==ReportView.FULL
            ReportResponse(row.id,row.workId,s.work.title,row.episodeNumber,row.publishedVersionId,row.kind,
                if(full) row.body else null,if(full) row.quote else null,row.visibility,row.status,
                if(full) names[row.reporterId] ?: WITHDRAWN_MEMBER_NAME else null,s.mine,s.owner,row.authorCheckedAt!=null,row.withdrawnAt!=null,
                if(full) corrections[row.id].orEmpty().sortedBy {it.createdAt}.map {AmendmentResponse(it.action,it.body,it.createdAt)} else emptyList(),
                s.replies.map {ReportReplyResponse(it.id,names[it.authorId] ?: WITHDRAWN_MEMBER_NAME,it.body,it.isPublic,it.createdAt)},
                row.createdAt,row.updatedAt)
        }
    }
}
