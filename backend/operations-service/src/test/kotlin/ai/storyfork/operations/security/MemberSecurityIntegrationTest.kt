package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.exception.CandidateRequiredException
import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations._common.service.dto.PageResponse
import ai.storyfork.operations.comment.controller.CommentController
import ai.storyfork.operations.comment.service.CommentService
import ai.storyfork.operations.comment.service.dto.OperationsComment
import ai.storyfork.operations.comment.service.dto.OperationsCommentList
import ai.storyfork.operations.activity.controller.AdminActivityController
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.activity.service.dto.AdminActivityListResponse
import ai.storyfork.operations.alert.controller.AlertController
import ai.storyfork.operations.alert.service.AlertService
import ai.storyfork.operations.alert.service.dto.AlertActRequest
import ai.storyfork.operations.alert.service.dto.AlertListResponse
import ai.storyfork.operations.alert.service.dto.AlertRuleListResponse
import ai.storyfork.operations.alert.service.dto.AlertRuleRequest
import ai.storyfork.operations.cardcategory.controller.CardCategoryController
import ai.storyfork.operations.cardcategory.service.CardCategoryService
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryCreateRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryOrderRequest
import ai.storyfork.operations.cardcategory.service.dto.CardCategoryUpdateRequest
import ai.storyfork.operations.credit.controller.CreditController
import ai.storyfork.operations.credit.service.CreditService
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.credit.service.dto.CreditBalancesRequest
import ai.storyfork.operations.dashboard.controller.DashboardController
import ai.storyfork.operations.dashboard.service.DashboardService
import ai.storyfork.operations.llmops.controller.LlmopsController
import ai.storyfork.operations.llmops.service.EvaluationService
import ai.storyfork.operations.llmops.service.LeakCheckService
import ai.storyfork.operations.llmops.service.LlmopsSettingService
import ai.storyfork.operations.llmops.service.MetricsService
import ai.storyfork.operations.llmops.service.ModelService
import ai.storyfork.operations.llmops.service.PipelineService
import ai.storyfork.operations.llmops.service.PromptService
import ai.storyfork.operations.llmops.service.TraceService
import ai.storyfork.operations.llmops.service.dto.PromptPromoteRequest
import ai.storyfork.operations.llmops.service.dto.TracePage
import ai.storyfork.operations.event.controller.AdminEventController
import ai.storyfork.operations.event.controller.PublicEventController
import ai.storyfork.operations.event.service.AdminEventService
import ai.storyfork.operations.event.service.EventService
import ai.storyfork.operations.event.service.dto.EventResponse
import ai.storyfork.operations.genre.controller.GenreController
import ai.storyfork.operations.genre.service.GenreService
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.report.controller.ReportController
import ai.storyfork.operations.report.service.ReportService
import ai.storyfork.operations.report.service.dto.ReportListResponse
import ai.storyfork.operations.work.controller.WorkController
import ai.storyfork.operations.work.service.WorkService
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import ai.storyfork.operations.worldstudio.controller.WorldStudioController
import ai.storyfork.operations.worldstudio.service.WorldStudioService
import java.time.Instant
import java.math.BigDecimal
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest
import org.springframework.context.annotation.Import
import org.springframework.data.domain.PageRequest
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** CI integration only: MVC assembly of the member Bearer and public event chains next to the service-token chain. */
@WebMvcTest(controllers = [ReportController::class, AdminEventController::class, AdminActivityController::class, PublicEventController::class, WorkController::class, CommentController::class,
    DashboardController::class, LlmopsController::class, AlertController::class, GenreController::class, CreditController::class,
    CardCategoryController::class, WorldStudioController::class], properties = [
    "app.operations.service-token=ci-operations-test-only-0123456789abcdef",
])
@Import(MemberSecurityConfig::class, PublicSecurityConfig::class, OperationsSecurityConfig::class, OperationsExceptionHandler::class,
    MemberSecurityIntegrationTest.MvcSecurity::class)
class MemberSecurityIntegrationTest {
    @TestConfiguration(proxyBeanMethods = false)
    @EnableWebSecurity
    class MvcSecurity

    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: JsonMapper
    @MockitoBean lateinit var core: CoreClient
    @MockitoBean lateinit var reports: ReportService
    @MockitoBean lateinit var adminEvents: AdminEventService
    @MockitoBean lateinit var events: EventService
    @MockitoBean lateinit var works: WorkService
    @MockitoBean lateinit var genres: GenreService
    @MockitoBean lateinit var credits: CreditService
    @MockitoBean lateinit var cardCategories: CardCategoryService
    @MockitoBean lateinit var worldStudios: WorldStudioService
    @MockitoBean lateinit var comments: CommentService
    @MockitoBean lateinit var adminActivities: AdminActivityService
    @MockitoBean lateinit var dashboard: DashboardService
    @MockitoBean lateinit var traces: TraceService
    @MockitoBean lateinit var metrics: MetricsService
    @MockitoBean lateinit var prompts: PromptService
    @MockitoBean lateinit var models: ModelService
    @MockitoBean lateinit var pipelines: PipelineService
    @MockitoBean lateinit var evaluations: EvaluationService
    @MockitoBean lateinit var leakChecks: LeakCheckService
    @MockitoBean lateinit var llmopsSettings: LlmopsSettingService
    @MockitoBean lateinit var alerts: AlertService
    private val serviceToken = "ci-operations-test-only-0123456789abcdef"
    private val bearer = "Bearer member-access"

    private fun code(body: String) = mapper.readTree(body)["code"].asString()

    @Test
    fun `member routes require a Core verified Bearer and ignore the service token`() {
        for (path in listOf("/api/v1/operations/reports", "/api/v1/operations/reports/mine", "/api/v1/operations/members", "/api/v1/operations/admins",
            "/api/v1/operations/support/inquiries", "/api/v1/operations/support/inquiries/mine")) {
            val response = mvc.perform(get(path).header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core)
    }

    @Test
    fun `verified member reaches the controller as principal without CSRF or session`() {
        val member = OperationsMember(UUID.randomUUID(), false)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(reports.mine(member)).thenReturn(ReportListResponse(emptyList()))

        val result = mvc.perform(get("/api/v1/operations/reports/mine").header("Authorization", bearer))
            .andExpect(status().isOk()).andReturn()

        assertNull(result.request.getSession(false))
        verify(reports).mine(member)
        mvc.perform(post("/api/v1/operations/reports/${UUID.randomUUID()}/restriction").header("Authorization", bearer))
            .andExpect(status().isOk())
    }

    @Test
    fun `Core verification failures keep 401 and 403 and otherwise return 502`() {
        for ((upstream, expected) in listOf(HttpStatus.UNAUTHORIZED to "UNAUTHORIZED", HttpStatus.FORBIDDEN to "FORBIDDEN",
            HttpStatus.BAD_GATEWAY to "UPSTREAM_FAILED")) {
            // doThrow: re-stubbing with when(core.verify(...)) would invoke the previous throwing stub.
            doThrow(ResponseStatusException(upstream)).`when`(core).verify(bearer)
            val response = mvc.perform(get("/api/v1/operations/reports/mine").header("Authorization", bearer)).andReturn().response
            assertEquals(upstream.value(), response.status)
            assertEquals(expected, code(response.contentAsString))
        }
    }

    @Test
    fun `existing service token routes still reject a member Bearer`() {
        mvc.perform(get("/api/v1/operations/notices").header("Authorization", bearer)).andExpect(status().isUnauthorized())
        verifyNoInteractions(core)
    }

    @Test
    fun `admin events require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/admin/events"), post("/api/v1/operations/admin/events"),
            get("/api/v1/operations/admin/events/$id"), put("/api/v1/operations/admin/events/$id"),
            delete("/api/v1/operations/admin/events/$id"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, adminEvents)
    }

    @Test
    fun `verified member reaches the admin events controller as principal`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(adminEvents.list(member)).thenReturn(PageResponse<EventResponse>(emptyList(), 0, 100, 0, 0))

        mvc.perform(get("/api/v1/operations/admin/events").header("Authorization", bearer)).andExpect(status().isOk())

        verify(adminEvents).list(member)
    }

    @Test
    fun `admin activities require a Core verified Bearer and ignore the service token`() {
        val response = mvc.perform(get("/api/v1/operations/admin/activities").header("X-Operations-Service-Token", serviceToken))
            .andExpect(status().isUnauthorized()).andReturn().response
        assertEquals("UNAUTHORIZED", code(response.contentAsString))
        assertNull(response.getHeader("Set-Cookie"))
        verifyNoInteractions(core, adminActivities)
    }

    @Test
    fun `verified member reaches the admin activities controller as principal with the forwarded bearer`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(adminActivities.list(member, bearer)).thenReturn(AdminActivityListResponse(emptyList()))

        mvc.perform(get("/api/v1/operations/admin/activities").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray())

        verify(adminActivities).list(member, bearer)
    }

    @Test
    fun `works routes require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/works"), put("/api/v1/operations/works/$id/restriction"),
            delete("/api/v1/operations/works/$id/restriction"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, works)
    }

    @Test
    fun `verified member reaches the works controller as principal and gets the service DTOs`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val id = UUID.randomUUID()
        val work = ContentWork(id, UUID.randomUUID().toString(), "작품", true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(works.list(member)).thenReturn(OperationsWorkList(emptyList()))
        `when`(works.restrict(member, id)).thenReturn(work)
        `when`(works.unrestrict(member, id)).thenReturn(work.copy(restricted = false))

        mvc.perform(get("/api/v1/operations/works").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray())
        mvc.perform(put("/api/v1/operations/works/$id/restriction").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.restricted").value(true))
        mvc.perform(delete("/api/v1/operations/works/$id/restriction").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.restricted").value(false))
    }

    @Test
    fun `comments routes require a Core verified Bearer and ignore the service token`() {
        for (builder in listOf(
            get("/api/v1/operations/comments"), put("/api/v1/operations/comments/ops-comment-1/hidden"),
            delete("/api/v1/operations/comments/ops-comment-1/hidden"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, comments)
    }

    @Test
    fun `verified member reaches the comments controller as principal and gets the service DTOs`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val comment = OperationsComment(
            "ops-comment-1", "ops-work-1", "작품", 3, "ops-comment-author", "작가", "원문", 2, true, Instant.parse("2026-11-10T01:02:03Z"),
        )
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(comments.list(member)).thenReturn(OperationsCommentList(listOf(comment)))
        `when`(comments.hide(member, "ops-comment-1")).thenReturn(comment)
        `when`(comments.unhide(member, "ops-comment-1")).thenReturn(comment.copy(hidden = false))

        mvc.perform(get("/api/v1/operations/comments").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].authorId").value("ops-comment-author"))
        mvc.perform(put("/api/v1/operations/comments/ops-comment-1/hidden").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.hidden").value(true))
        mvc.perform(delete("/api/v1/operations/comments/ops-comment-1/hidden").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.hidden").value(false))
    }

    @Test
    fun `genres routes require a Core verified Bearer and ignore the service token`() {
        for (builder in listOf(
            get("/api/v1/operations/genres"), post("/api/v1/operations/genres"),
            patch("/api/v1/operations/genres/genre-05"), put("/api/v1/operations/genres/order"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, genres)
    }

    @Test
    fun `verified member reaches the genres controller as principal and gets Content's JSON as is`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val rows = mapper.readTree("""[{"code":"genre-01","name":"판타지","emoji":"✨","active":true,"featured":true,"position":1,"workCount":3,"worldCount":1}]""")
        val row = mapper.readTree("""{"code":"genre-31","name":"사이버펑크"}""")
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(genres.list(member)).thenReturn(rows)
        `when`(genres.create(member, GenreCreateRequest("사이버펑크", "🤖"))).thenReturn(row)
        `when`(genres.update(member, "genre-31", GenreUpdateRequest(active = false))).thenReturn(row)
        `when`(genres.reorder(member, GenreOrderRequest(listOf("genre-02", "genre-01")))).thenReturn(rows)

        mvc.perform(get("/api/v1/operations/genres").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].workCount").value(3)).andExpect(jsonPath("$[0].emoji").value("✨"))
        mvc.perform(post("/api/v1/operations/genres").header("Authorization", bearer).contentType("application/json")
            .content("""{"name":"사이버펑크","emoji":"🤖"}""")).andExpect(status().isCreated()).andExpect(jsonPath("$.code").value("genre-31"))
        mvc.perform(patch("/api/v1/operations/genres/genre-31").header("Authorization", bearer).contentType("application/json")
            .content("""{"active":false}""")).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("사이버펑크"))
        mvc.perform(put("/api/v1/operations/genres/order").header("Authorization", bearer).contentType("application/json")
            .content("""{"codes":["genre-02","genre-01"]}""")).andExpect(status().isOk())
    }

    @Test
    fun `credits routes require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/credits/members/$id"), post("/api/v1/operations/credits/members/$id/grants"),
            post("/api/v1/operations/credits/members/$id/revocations"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, credits)
    }

    @Test
    fun `verified member reaches the credits controller as principal with the forwarded bearer and gets Core's JSON as is`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val id = UUID.randomUUID()
        val overview = mapper.readTree("""{"balance":{"total":1200,"items":[]},"history":{"items":[{"type":"revoke","kind":"operator","amount":300}]}}""")
        val updated = mapper.readTree("""{"total":1700,"items":[]}""")
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(credits.read(member, bearer, id)).thenReturn(overview)
        `when`(credits.grant(member, bearer, id, CreditAdjustRequest(BigDecimal(500), "이벤트 보상"))).thenReturn(updated)
        `when`(credits.revoke(member, bearer, id, CreditAdjustRequest(BigDecimal(200), "오지급 회수"))).thenReturn(updated)

        mvc.perform(get("/api/v1/operations/credits/members/$id").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.history.items[0].type").value("revoke"))
        mvc.perform(post("/api/v1/operations/credits/members/$id/grants").header("Authorization", bearer).contentType("application/json")
            .content("""{"amount":500,"reason":"이벤트 보상"}""")).andExpect(status().isCreated()).andExpect(jsonPath("$.total").value(1700))
        mvc.perform(post("/api/v1/operations/credits/members/$id/revocations").header("Authorization", bearer).contentType("application/json")
            .content("""{"amount":200,"reason":"오지급 회수"}""")).andExpect(status().isCreated()).andExpect(jsonPath("$.total").value(1700))
    }

    @Test
    fun `world studio, card category, episode and credit balance routes require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/world-studios"), put("/api/v1/operations/world-studios/$id/restriction"), delete("/api/v1/operations/world-studios/$id/restriction"),
            get("/api/v1/operations/card-categories"), post("/api/v1/operations/card-categories"),
            patch("/api/v1/operations/card-categories/object"), put("/api/v1/operations/card-categories/order"),
            get("/api/v1/operations/works/$id/episodes"), put("/api/v1/operations/works/$id/episodes/2/restriction"),
            delete("/api/v1/operations/works/$id/episodes/2/restriction"), post("/api/v1/operations/credits/balances"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, worldStudios, cardCategories, works, credits)
    }

    @Test
    fun `verified member reaches the world studio, card category, episode and balance routes and gets their JSON as is`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val id = UUID.randomUUID()
        val worlds = mapper.readTree("""[{"worldId":"$id","name":"별빛 세계","ownerName":"작가","linkedWorkId":null,"restricted":false}]""")
        val world = mapper.readTree("""{"worldId":"$id","name":"별빛 세계","restricted":true}""")
        val categories = mapper.readTree("""[{"code":"object","name":"물건","icon":null,"active":true,"position":6,"cardCount":2}]""")
        val category = mapper.readTree("""{"code":"card-category-9","name":"도구"}""")
        val episodes = mapper.readTree("""[{"number":1,"title":"1화","publicationStatus":"published","restricted":false,"inherited":false}]""")
        val episode = mapper.readTree("""{"number":2,"title":"2화","publicationStatus":"published","restricted":true,"inherited":false}""")
        val balances = mapper.readTree("""[{"memberId":"$id","total":1200}]""")
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(worldStudios.list(member)).thenReturn(worlds)
        `when`(worldStudios.restrict(member, id)).thenReturn(world)
        `when`(worldStudios.unrestrict(member, id)).thenReturn(world)
        `when`(cardCategories.list(member)).thenReturn(categories)
        `when`(cardCategories.create(member, CardCategoryCreateRequest("도구", "🔧"))).thenReturn(category)
        `when`(cardCategories.update(member, "card-category-9", CardCategoryUpdateRequest(active = false))).thenReturn(category)
        `when`(cardCategories.reorder(member, CardCategoryOrderRequest(listOf("object", "character")))).thenReturn(categories)
        `when`(works.episodes(member, id)).thenReturn(episodes)
        `when`(works.restrictEpisode(member, id, 2)).thenReturn(episode)
        `when`(works.unrestrictEpisode(member, id, 2)).thenReturn(episode)
        `when`(credits.balances(member, bearer, CreditBalancesRequest(listOf(id)))).thenReturn(balances)

        mvc.perform(get("/api/v1/operations/world-studios").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].ownerName").value("작가"))
        mvc.perform(put("/api/v1/operations/world-studios/$id/restriction").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.restricted").value(true))
        mvc.perform(delete("/api/v1/operations/world-studios/$id/restriction").header("Authorization", bearer)).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/card-categories").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].cardCount").value(2))
        mvc.perform(post("/api/v1/operations/card-categories").header("Authorization", bearer).contentType("application/json")
            .content("""{"name":"도구","icon":"🔧"}""")).andExpect(status().isCreated()).andExpect(jsonPath("$.code").value("card-category-9"))
        mvc.perform(patch("/api/v1/operations/card-categories/card-category-9").header("Authorization", bearer).contentType("application/json")
            .content("""{"active":false}""")).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("도구"))
        mvc.perform(put("/api/v1/operations/card-categories/order").header("Authorization", bearer).contentType("application/json")
            .content("""{"codes":["object","character"]}""")).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/works/$id/episodes").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].inherited").value(false))
        mvc.perform(put("/api/v1/operations/works/$id/episodes/2/restriction").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.restricted").value(true))
        mvc.perform(delete("/api/v1/operations/works/$id/episodes/2/restriction").header("Authorization", bearer)).andExpect(status().isOk())
        mvc.perform(post("/api/v1/operations/credits/balances").header("Authorization", bearer).contentType("application/json")
            .content("""{"memberIds":["$id"]}""")).andExpect(status().isOk()).andExpect(jsonPath("$[0].total").value(1200))
    }

    @Test
    fun `public events are readable without credentials and ignore any Bearer or service token`() {
        val missing = UUID.randomUUID()
        `when`(events.list(PageRequest.of(0, 100))).thenReturn(PageResponse<EventResponse>(emptyList(), 0, 100, 0, 0))
        `when`(events.read(missing)).thenThrow(NoSuchElementException())

        mvc.perform(get("/api/v1/operations/public/events")).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/public/events").header("Authorization", "Bearer ignored")
            .header("X-Operations-Service-Token", serviceToken)).andExpect(status().isOk())
        mvc.perform(get("/api/v1/operations/public/events/$missing")).andExpect(status().isNotFound())

        verifyNoInteractions(core)
    }

    @Test
    fun `public events reject every method but GET with or without credentials`() {
        val path = "/api/v1/operations/public/events"
        val id = UUID.randomUUID()
        for (method in listOf(HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE)) {
            for (uri in listOf(path, "$path/$id")) {
                val response = mvc.perform(request(method, uri)).andExpect(status().isForbidden()).andReturn().response
                assertEquals("FORBIDDEN", code(response.contentAsString))
                mvc.perform(request(method, uri).header("Authorization", bearer).header("X-Operations-Service-Token", serviceToken))
                    .andExpect(status().isForbidden())
            }
        }
        verifyNoInteractions(core, events)
    }

    @Test
    fun `the service token event route and lookalike paths stay closed to anonymous and Bearer callers`() {
        for (path in listOf("/api/v1/operations/events", "/api/v1/operations/public/eventsX", "/api/v1/operations/admin/eventsX")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
            mvc.perform(get(path).header("Authorization", bearer)).andExpect(status().isUnauthorized())
        }
        verifyNoInteractions(core, events, adminEvents)
    }

    @Test
    fun `dashboard llmops and alert routes require a Core verified Bearer and ignore the service token`() {
        val id = UUID.randomUUID()
        for (builder in listOf(
            get("/api/v1/operations/dashboard"), get("/api/v1/operations/llmops/traces"), get("/api/v1/operations/llmops/traces/t-1"),
            get("/api/v1/operations/llmops/metrics"), get("/api/v1/operations/llmops/prompts"), put("/api/v1/operations/llmops/prompts/qa-answer/production"),
            get("/api/v1/operations/llmops/models"), post("/api/v1/operations/llmops/evaluations"), get("/api/v1/operations/llmops/leak-checks"),
            get("/api/v1/operations/llmops/settings"), get("/api/v1/operations/alerts"), put("/api/v1/operations/alerts/$id"),
            get("/api/v1/operations/alerts/rules"), put("/api/v1/operations/alerts/rules/ai_failure_rate"),
        )) {
            val response = mvc.perform(builder.header("X-Operations-Service-Token", serviceToken))
                .andExpect(status().isUnauthorized()).andReturn().response
            assertEquals("UNAUTHORIZED", code(response.contentAsString))
            assertNull(response.getHeader("Set-Cookie"))
        }
        verifyNoInteractions(core, dashboard, traces, metrics, prompts, models, evaluations, leakChecks, llmopsSettings, alerts)
    }

    @Test
    fun `a verified operator reaches the dashboard controller with the principal and the forwarded bearer`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)

        mvc.perform(get("/api/v1/operations/dashboard").header("Authorization", bearer)).andExpect(status().isOk())

        // The service also takes the current time (a default argument), so the call is read back instead of stubbed.
        val call = mockingDetails(dashboard).invocations.single { it.method.name == "get" }
        assertEquals(listOf<Any>(member, bearer), call.arguments.take(2))
    }

    @Test
    fun `a verified operator reaches the trace route and the request id filter arrives at the service`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(traces.list(member, null, null, null, null, null, "req-1", 0)).thenReturn(TracePage(emptyList(), 0, 20, 0))

        mvc.perform(get("/api/v1/operations/llmops/traces?requestId=req-1").header("Authorization", bearer))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray()).andExpect(jsonPath("$.size").value(20))

        verify(traces).list(member, null, null, null, null, null, "req-1", 0)
    }

    @Test
    fun `promoting a prompt version that is not a candidate is a 409 with its own code`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(prompts.promote(member, "qa-answer", PromptPromoteRequest(3))).thenThrow(CandidateRequiredException())

        val response = mvc.perform(put("/api/v1/operations/llmops/prompts/qa-answer/production").header("Authorization", bearer)
            .contentType("application/json").content("""{"version":3}""")).andExpect(status().isConflict()).andReturn().response

        assertEquals("CANDIDATE_REQUIRED", code(response.contentAsString))
    }

    @Test
    fun `a verified operator reaches the alert routes with the body and the path values`() {
        val member = OperationsMember(UUID.randomUUID(), true)
        val id = UUID.randomUUID()
        `when`(core.verify(bearer)).thenReturn(member)
        `when`(alerts.list(member, "open")).thenReturn(AlertListResponse(emptyList()))
        `when`(alerts.rules(member)).thenReturn(AlertRuleListResponse(emptyList()))

        mvc.perform(get("/api/v1/operations/alerts?status=open").header("Authorization", bearer)).andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray())
        mvc.perform(get("/api/v1/operations/alerts/rules").header("Authorization", bearer)).andExpect(status().isOk()).andExpect(jsonPath("$.items").isArray())
        mvc.perform(put("/api/v1/operations/alerts/$id").header("Authorization", bearer).contentType("application/json")
            .content("""{"status":"resolved","note":"끝"}""")).andExpect(status().isOk())
        mvc.perform(put("/api/v1/operations/alerts/rules/ai_failure_rate").header("Authorization", bearer).contentType("application/json")
            .content("""{"threshold":0.2,"windowMinutes":30,"enabled":true}""")).andExpect(status().isOk())

        verify(alerts).act(member, id, AlertActRequest("resolved", "끝"))
        verify(alerts).updateRule(member, "ai_failure_rate", AlertRuleRequest(0.2, 30, true))
    }

    @Test
    fun `the llmops and dashboard lookalike paths stay on the service token chain`() {
        for (path in listOf("/api/v1/operations/dashboardX", "/api/v1/operations/llmopsX/traces", "/api/v1/operations/alertsX")) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized())
            mvc.perform(get(path).header("Authorization", bearer)).andExpect(status().isUnauthorized())
        }
        verifyNoInteractions(core, dashboard, alerts)
    }
}
