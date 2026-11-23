package ai.storyfork.content.mcp

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.config.OPERATOR_AUTHORITY
import ai.storyfork.content.context.service.ContextService
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.EpisodeWorldBasisService
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.SavedEpisodeVersionResult
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.fork.service.ForkService
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.notice.service.WorkNoticeService
import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.proposal.service.ProposalService
import ai.storyfork.content.publication.service.PublicationScheduleService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.InitialWorldAnalysisRead
import ai.storyfork.content.world.service.InitialWorldAnalysisService
import ai.storyfork.content.world.service.InitialWorldApplicationService
import ai.storyfork.content.world.service.InitialWorldBasis
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldCheckpointService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest
import io.modelcontextprotocol.spec.McpSchema.CallToolResult
import java.util.UUID
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.mockito.Mockito.*
import org.mockito.stubbing.Answer
import org.slf4j.LoggerFactory
import org.springframework.ai.mcp.annotation.spring.SyncMcpAnnotationProviders
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder

private const val ME = "11111111-1111-4111-8111-111111111111"
private const val WORK = "work-1"
private const val NEW_WORK = "work-new"
private const val FORK_WORK = "work-fork"
private const val OWNER = "88888888-8888-4888-8888-888888888888"
private val WORLD: UUID = UUID.fromString("22222222-2222-4222-8222-222222222222")
private val NEW_WORLD: UUID = UUID.fromString("77777777-7777-4777-8777-777777777777")
private val ANALYSIS: UUID = UUID.fromString("33333333-3333-4333-8333-333333333333")
private val CANDIDATE: UUID = UUID.fromString("44444444-4444-4444-8444-444444444444")
private val APPLICATION: UUID = UUID.fromString("55555555-5555-4555-8555-555555555555")
private val REVISION: UUID = UUID.fromString("66666666-6666-4666-8666-666666666666")

/** 기존 ContentAuthenticationFilter가 만드는 인증과 같은 모양으로 호출자를 싣는다(Principal 이름은 회원 UUID). */
private fun signedIn(operator: Boolean = false): McpTransportContext {
    SecurityContextHolder.getContext().authentication =
        UsernamePasswordAuthenticationToken.authenticated(ME, null, if (operator) listOf(SimpleGrantedAuthority(OPERATOR_AUTHORITY)) else emptyList())
    try {
        return mcpCallerContext()
    } finally {
        SecurityContextHolder.clearContext()
    }
}

/** 저장소에 건넨 outbox 행이다(Mockito 매처 없이 호출 기록에서 읽는다). */
private fun ContentEventOutboxRepository.saved() =
    mockingDetails(this).invocations.filter { it.method.name == "save" }.map { it.arguments[0] as ContentEventOutboxEntity }

/**
 * 다섯 도구 클래스를 Service 대역 위에 올린 실제 @McpTool 호출 경로다. [answer]가 있으면 모든 Service 호출이 그 답을 한다.
 * 응답을 읽는 도구(생성 도구의 새 id·초안·접수증)에는 값이 있는 응답을 주고 그 밖의 호출은 Mockito 기본값(null·빈 목록)이다.
 */
private class Rig(private val answer: Answer<Any?>? = null) {
    val outbox: ContentEventOutboxRepository = mock(ContentEventOutboxRepository::class.java)

    private fun <T : Any> service(type: Class<T>, vararg results: Pair<String, Any>): T {
        val byName = results.toMap()
        return if (answer != null) mock(type, answer) else mock(type) { call -> byName[call.method.name] ?: RETURNS_DEFAULTS.answer(call) }
    }

    private fun workOf(id: String) = WorkResponse(id, "제목 ${id}", "소개", "public", true, true, null, emptyList(), null)
    private fun draftOf(id: UUID) = WorldDraftResponse(id, 1, null, null, "달빛 세계", "설명", emptyList(), emptyList())

    private val access = service(WorkAccessService::class.java, "get" to WorkAccessResult(WORK, OWNER, "제목", "소개", 1, "world-1", "private", false, false, null))
    val changeNotice = McpChangeNotice(outbox, access)
    private val works = service(WorkService::class.java, "create" to workOf(NEW_WORK))
    private val forks = service(ForkService::class.java, "create" to workOf(FORK_WORK))
    private val versions = service(EpisodeVersionService::class.java,
        "saveCurrent" to SavedEpisodeVersionResult(DraftResponse("제목", "본문", 4, "작가의 말"), VersionResponse("v-9", "제목", "본문", 4, 2, "2030-01-01T00:00:00Z", "작가의 말")))
    private val studio = service(WorldStudioService::class.java, "create" to draftOf(NEW_WORLD), "edit" to draftOf(WORLD),
        "save" to WorldRevisionResponse(WORLD, REVISION, 1, "달빛 세계", "설명", null, null, emptyList(), null))
    private val analyses = service(InitialWorldAnalysisService::class.java,
        "analyze" to InitialWorldAnalysisRead(InitialWorldAnalysisResponse(ANALYSIS, InitialWorldBasis(1, 0, null, "hash"), "completed", "current", null, emptyMap()), null))
    private val applications = service(InitialWorldApplicationService::class.java,
        "apply" to InitialWorldApplicationResponse(APPLICATION, "applied", 1, null, emptyList(), emptyList()))

    val specs = SyncMcpAnnotationProviders.statelessToolSpecifications(listOf<Any>(
        EpisodeMcpTools(service(EpisodeService::class.java), service(EpisodeWorldBasisService::class.java), versions,
            service(PublicationService::class.java), service(PublicationScheduleService::class.java), works, changeNotice),
        StoryPlanMcpTools(service(StoryPlanService::class.java), changeNotice),
        WorkMcpTools(works, service(WorkWorldService::class.java), service(WorkNoticeService::class.java), forks,
            service(ContextService::class.java), service(ProposalService::class.java), changeNotice),
        WorldMcpTools(service(WorldService::class.java), service(WorldCheckpointService::class.java), changeNotice),
        WorldStudioMcpTools(studio, service(WorkWorldService::class.java), service(PublicWorldService::class.java), analyses, applications, changeNotice),
    ))

    fun call(tool: String, args: Map<String, Any?>, operator: Boolean = false): CallToolResult =
        specs.single { it.tool().name() == tool }.callHandler().apply(signedIn(operator), CallToolRequest.builder(tool).arguments(args).build())
}

/**
 * 계약(docs/design/mcp-change-notice-contract.md) 'Content: 사건을 남기는 도구' 표를 고정한다. 도구 이름 ↔ 사건 대상 표 하나가 기준이며,
 * 성공한 쓰기는 outbox 한 행(대상·수신자 포함)을 남기고 표 밖의 쓰기·실패한 도구·조회는 남기지 않는다. Spring context·DB 없이 실제 @McpTool 경로를 지난다.
 */
class McpChangeNoticeTest {
    private val rig = Rig()
    private val logger = LoggerFactory.getLogger(McpChangeNotice::class.java) as Logger
    private val logs = ListAppender<ILoggingEvent>().also { it.start(); logger.addAppender(it) }

    @AfterEach fun detach() {
        logger.detachAppender(logs)
    }

    // ---- 기록 컴포넌트 ----

    // 사건의 종류·수신자·대상은 아래 도구 표가 도구마다 확인한다. 여기서는 표가 보지 않는 행 자체(발행 대기·고유 id)만 본다.
    @Test fun `each event is a pending outbox row with its own id`() {
        val notice = rig.changeNotice

        notice.world(signedIn(), "${WORLD}")
        notice.work(signedIn(), WORK)

        val rows = rig.outbox.saved()
        assertEquals(2, rows.size)
        assertNotEquals(rows[0].id, rows[1].id)
        assertTrue(rows.none { it.id == UUID(0, 0) || it.publishedAt != null })
    }

    @Test fun `a failed save is logged and never thrown because the tool already succeeded`() {
        val broken = mock(ContentEventOutboxRepository::class.java) { throw DataAccessResourceFailureException("db down: 원고 본문") }

        McpChangeNotice(broken, mock(WorkAccessService::class.java)).work(signedIn(), WORK)

        val error = logs.list.single { it.level == Level.ERROR }
        assertTrue("work" in error.formattedMessage && WORK in error.formattedMessage, error.formattedMessage)
        // 예외 메시지에는 입력·본문이 섞일 수 있어 종류만 남긴다.
        assertFalse("원고" in error.formattedMessage, error.formattedMessage)
    }

    @Test fun `a failing owner lookup is logged like a failing save and never thrown`() {
        val access = mock(WorkAccessService::class.java) { throw ContentFailure(404, "작품을 찾을 수 없어요.") }

        McpChangeNotice(rig.outbox, access).workToOwner(WORK)

        assertEquals(0, rig.outbox.saved().size)
        assertEquals(1, logs.list.count { it.level == Level.ERROR })
    }

    // ---- 도구 ↔ 대상 표 ----

    /**
     * 쓰기 도구 하나의 올바른 호출이다. [target]이 null이면 사건을 남기지 않는 쓰기이고, [id]는 사건의 대상 id다(생성 도구는 응답의 새 id).
     * [recipient]는 사건의 수신자(기본은 도구를 부른 회원, 운영자도 성공하는 소식 도구는 작품 소유자)이고 [operator]는 호출자가 운영자인지다.
     */
    private class Case(val tool: String, val args: Map<String, Any?>, val target: String? = null, val id: String = WORK, val recipient: String = ME, val operator: Boolean = false)

    private val draftJson = mapOf("title" to "제목", "body" to "본문", "revision" to 3, "authorNote" to "작가의 말")
    private val publishJson = mapOf("revision" to 3, "rightsConfirmed" to true, "allowFork" to true, "allowForkPublication" to true, "versionId" to "v-1")
    private val scheduleJson = mapOf("versionId" to "v-1", "scheduledAt" to "2030-01-02T03:04:05Z", "rightsConfirmed" to true, "revision" to 4)
    private val scene = mapOf("kind" to "scene", "parentId" to "plot-1", "title" to "첫 장면", "content" to "내용",
        "episodeNumber" to 2, "characterIds" to listOf("character-1"), "placeIds" to listOf("place-1"), "revision" to 3)
    private val noticeJson = mapOf("category" to "info", "title" to "휴재 안내", "body" to "이번 주는 쉽니다", "pinned" to true)

    private val cases = listOf(
        // world: 세계관 id가 대상이다(생성은 새 세계관).
        Case("world_studio_create", mapOf("request" to mapOf("name" to "달빛 세계")), "world", "${NEW_WORLD}"),
        Case("world_studio_edit_draft", mapOf("id" to "${WORLD}", "request" to mapOf("expectedDraftRevision" to 1, "name" to "달빛 세계", "description" to "설명")), "world", "${WORLD}"),
        Case("world_studio_save_revision", mapOf("id" to "${WORLD}", "request" to mapOf("expectedDraftRevision" to 1, "key" to "save-1")), "world", "${WORLD}"),
        Case("world_studio_update_publication", mapOf("id" to "${WORLD}", "request" to mapOf("visibility" to "public", "genre" to "genre-01")), "world", "${WORLD}"),
        Case("world_analysis_apply", mapOf("worldId" to "${WORLD}", "analysisId" to "${ANALYSIS}",
            "request" to mapOf("key" to "apply-1", "expectedDraftRevision" to 1, "candidates" to listOf(mapOf("candidateId" to "${CANDIDATE}", "decisionSequence" to 1)))), "world", "${WORLD}"),
        // work: 작품과 그에 딸린 설정·소식·제안 반영(생성은 새 작품, Fork 생성은 새 Fork 작품).
        Case("work_create", mapOf("data" to mapOf("title" to "달빛 서점")), "work", NEW_WORK),
        Case("work_update", mapOf("id" to WORK, "data" to mapOf("title" to "새 제목", "summary" to "새 소개", "revision" to 3)), "work"),
        Case("work_delete", mapOf("id" to WORK), "work"),
        Case("work_update_policy", mapOf("id" to WORK, "data" to mapOf("revision" to 2, "allowFork" to true, "allowForkPublication" to false)), "work"),
        Case("work_link_world_studio", mapOf("id" to WORK, "worldId" to "${WORLD}"), "work"),
        Case("work_stop_fork_publication", mapOf("id" to WORK), "work"),
        Case("work_fork_create", mapOf("id" to WORK, "data" to mapOf("episode" to 2, "title" to "다른 결말")), "work", FORK_WORK),
        Case("work_fork_world_change", mapOf("id" to WORK, "data" to mapOf("revision" to 1, "changeId" to "change-1", "decision" to "apply")), "work"),
        // 운영자(호출자 ME)가 남의 작품 소식을 쓰거나 고치거나 지워도 알림은 호출한 운영자가 아니라 작품 소유자에게 간다.
        Case("work_notice_create", mapOf("id" to WORK, "data" to noticeJson), "work", recipient = OWNER, operator = true),
        Case("work_notice_update", mapOf("id" to WORK, "noticeId" to "notice-1", "data" to noticeJson), "work", recipient = OWNER, operator = true),
        Case("work_notice_delete", mapOf("id" to WORK, "noticeId" to "notice-1"), "work", recipient = OWNER, operator = true),
        Case("work_proposal_accept", mapOf("id" to WORK, "proposalId" to "proposal-1", "data" to mapOf("revision" to 4)), "work"),
        Case("work_setting_draft", mapOf("id" to WORK, "sid" to "s1", "data" to mapOf("revision" to 2, "setting" to mapOf("name" to "왕국"), "sourceToken" to "tok")), "work"),
        Case("work_setting_commit", mapOf("id" to WORK, "sid" to "s1", "data" to mapOf("revision" to 4)), "work"),
        Case("work_setting_revert", mapOf("id" to WORK, "sid" to "s1", "data" to mapOf("revision" to 5, "versionId" to "v1")), "work"),
        // work: 회차는 회차 번호 없이 작품 단위다.
        Case("episode_create", mapOf("id" to WORK, "data" to mapOf("title" to "새 회차")), "work"),
        Case("episode_update_draft", mapOf("id" to WORK, "number" to 2, "data" to draftJson), "work"),
        Case("episode_save_current_draft", mapOf("id" to WORK, "data" to draftJson), "work"),
        Case("episode_delete", mapOf("id" to WORK, "number" to 2, "revision" to 5), "work"),
        Case("episode_delete_draft", mapOf("id" to WORK, "number" to 2, "revision" to 5), "work"),
        Case("episode_version_save", mapOf("id" to WORK, "number" to 2, "data" to draftJson), "work"),
        Case("episode_version_restore", mapOf("id" to WORK, "number" to 2, "data" to mapOf("revision" to 3, "versionId" to "v-1")), "work"),
        Case("episode_publish", mapOf("id" to WORK, "number" to 2, "data" to publishJson), "work"),
        Case("episode_publish_current", mapOf("id" to WORK, "data" to publishJson), "work"),
        Case("episode_update_visibility", mapOf("id" to WORK, "number" to 2, "data" to mapOf("revision" to 3, "visible" to true, "rightsConfirmed" to true)), "work"),
        Case("episode_world_basis_choose", mapOf("id" to WORK, "number" to 2, "data" to mapOf("worldId" to "${WORLD}", "revisionId" to "${REVISION}", "revision" to 1)), "work"),
        // work: 플롯·장면 계획.
        Case("story_plan_create", mapOf("workId" to WORK, "data" to scene), "work"),
        Case("story_plan_update", mapOf("workId" to WORK, "id" to "plan-1", "data" to scene), "work"),
        Case("story_plan_delete", mapOf("workId" to WORK, "id" to "plan-1", "revision" to 5), "work"),
        // 정본을 바꾸지 않는 쓰기(분석 요청·후보 결정·체크포인트·발행 예약·다른 작품에 보내는 제안)는 사건을 남기지 않는다.
        Case("world_analysis_create", mapOf("worldId" to "${WORLD}", "request" to mapOf("key" to "analyze-1", "expectedDraftRevision" to 1))),
        Case("world_analysis_decide", mapOf("worldId" to "${WORLD}", "analysisId" to "${ANALYSIS}", "candidateId" to "${CANDIDATE}",
            "request" to mapOf("key" to "decide-1", "expectedDecisionSequence" to 0, "action" to "approve", "editedCandidate" to null, "comment" to ""))),
        Case("world_checkpoint_create", mapOf("id" to WORK)),
        Case("episode_schedule_create", mapOf("id" to WORK, "number" to 2, "data" to scheduleJson - "revision")),
        Case("episode_schedule_update", mapOf("id" to WORK, "number" to 2, "scheduleId" to "s-1", "data" to scheduleJson)),
        Case("episode_schedule_cancel", mapOf("id" to WORK, "number" to 2, "scheduleId" to "s-1", "revision" to 4)),
        Case("work_proposal_create", mapOf("id" to WORK, "data" to mapOf("revision" to 4, "prompt" to "다음 장면", "consent" to true))),
    )

    @Test fun `every write tool is classified as recording or not so a new write tool cannot be forgotten`() {
        val writes = rig.specs.filter { it.tool().annotations()?.readOnlyHint() != true }.map { it.tool().name() }

        assertEquals(writes.sorted(), cases.map { it.tool }.sorted())
    }

    @TestFactory fun `a successful write records its event for the right target and a write outside the contract records nothing`(): List<DynamicTest> =
        cases.map { case ->
            dynamicTest("${case.tool} -> ${case.target ?: "no event"}") {
                clearInvocations(rig.outbox)

                val result = rig.call(case.tool, case.args, case.operator)

                assertNotEquals(true, result.isError(), "${case.tool}: ${result.content()}")
                val rows = rig.outbox.saved()
                if (case.target == null) {
                    assertEquals(0, rows.size, case.tool)
                } else {
                    assertEquals(1, rows.size, case.tool)
                    val row = rows.first()
                    assertEquals(listOf("content.mcp.${case.target}-changed", case.recipient, case.target, case.id), listOf(row.type, row.recipientId, row.targetType, row.targetId), case.tool)
                }
            }
        }

    @TestFactory fun `a tool that fails records nothing`(): List<DynamicTest> {
        val failing = Rig(Answer<Any?> { throw ContentFailure(409, "다른 변경과 충돌했어요.", "SOME_CODE") })
        return cases.filter { it.target != null }.map { case ->
            dynamicTest("${case.tool} fails without an event") {
                clearInvocations(failing.outbox)
                val result = failing.call(case.tool, case.args, case.operator)

                assertEquals(true, result.isError(), case.tool)
                verifyNoInteractions(failing.outbox)
            }
        }
    }
}
