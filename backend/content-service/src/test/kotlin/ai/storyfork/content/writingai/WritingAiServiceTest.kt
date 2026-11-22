package ai.storyfork.content.writingai

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.context.service.QaScopeGrant
import ai.storyfork.content.context.service.QaScopeGrants
import ai.storyfork.content.context.service.QaScopeService
import ai.storyfork.content.context.service.dto.QaScope
import ai.storyfork.content.context.service.dto.QaScopeRequest
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.writingai.client.WritingAiClient
import ai.storyfork.content.writingai.service.WritingAiService
import ai.storyfork.content.writingai.service.dto.WritingAiAttachment
import ai.storyfork.content.writingai.service.dto.WritingAiPage
import ai.storyfork.content.writingai.service.dto.WritingAiPageContent
import ai.storyfork.content.writingai.service.dto.WritingAiRequest
import ai.storyfork.content.writingai.service.dto.WritingAiResume
import ai.storyfork.content.writingai.service.dto.WritingAiScene
import ai.storyfork.content.writingai.service.dto.WritingAiSimulation
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentCaptor
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper

class WritingAiServiceTest {
    private val scopes = mock(QaScopeService::class.java)
    private val client = mock(WritingAiClient::class.java).also {
        `when`(it.history(anyString(), anyString())).thenReturn(JsonMapper.builder().build().readTree("""{"turns":[]}"""))
    }
    private val grants = QaScopeGrants()
    private val access = mock(WorkAccessService::class.java)
    private val episodes = mock(EpisodeService::class.java)
    private val forks = mock(ForkRepository::class.java)
    private val workWorlds = mock(WorkWorldService::class.java)
    private val worlds = mock(WorldStudioService::class.java)
    private val service = WritingAiService(scopes, grants, client, access, episodes, forks, workWorlds, worlds)
    private val result = JsonMapper.builder().build().readTree("""{"status":"completed"}""")
    private val ask = WritingAiRequest(request = "길드 규칙은?", episode = 2, episodeVersionId = "r2")

    @Suppress("UNCHECKED_CAST")
    private fun sent(): Map<String, Any?> {
        val body = ArgumentCaptor.forClass(Map::class.java)
        verify(client).orchestrate(body.capture() as Map<String, Any?>? ?: emptyMap(), eq("Bearer user") ?: "")
        return body.value as Map<String, Any?>
    }

    private fun token(scope: Any?) = (scope as Map<*, *>)["scopeToken"] as String

    @Test
    fun `new turn issues a scope token bound to the signed-in author and forwards the author's bearer`() {
        `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2"))).thenReturn(
            QaScope("work", null, 2, "r2", emptyList()))
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        val response = service.run("work", "owner", "Bearer user", ask)
        assertEquals(result, response.result)
        val body = sent()
        assertEquals("길드 규칙은?", body["request"])
        assertEquals(mapOf("threadId" to response.threadId, "scope" to "user:owner/work:work"), body["conversation"])
        assertEquals(QaScopeGrant("work", "owner", 2, "r2"), grants.read(token(body["scope"])))
        assertEquals(mapOf("workId" to "work", "episode" to 2, "episodeVersionId" to "r2"), body["target"])
        verify(client, never()).history(anyString(), anyString())  // 새 요청은 이력을 읽지 않는다
    }

    private fun grounded() = `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2"))).thenReturn(
        QaScope("work", null, 2, "r2", emptyList()))

    @Test
    fun `a Fork work marks the target as fork for the AI trace while a plain work sends no fork key`() {
        grounded()
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        `when`(forks.existsById("work")).thenReturn(true)
        service.run("work", "owner", "Bearer user", ask)
        assertEquals(mapOf("workId" to "work", "episode" to 2, "episodeVersionId" to "r2", "fork" to true), sent()["target"])
    }

    @Test
    fun `a target episode after the grounding episode reflects into that episode while the grounding stays as it was`() {
        grounded()
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", "owner", "Bearer user", ask.copy(targetEpisode = 5))  // 2화까지 발행됐고 작가는 5화 초안을 열어 두었다
        val body = sent()
        assertEquals(mapOf("workId" to "work", "episode" to 5, "baseEpisode" to 2, "episodeVersionId" to "r2"), body["target"])  // 반영은 5화, 지식 상한은 근거 2화
        assertEquals(QaScopeGrant("work", "owner", 2, "r2"), grants.read(token(body["scope"])))  // 근거 조회 범위는 그대로
        verify(scopes).resolve("work", "owner", QaScopeRequest(2, "r2"))
        verify(episodes).read("work", "owner", 5)  // 반영 회차가 이 작품의 활성 회차인지 확인한다
    }

    @Test
    fun `a target episode equal to the grounding episode or missing changes nothing and needs no lookup`() {
        grounded()
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", "owner", "Bearer user", ask.copy(targetEpisode = 2))
        assertEquals(mapOf("workId" to "work", "episode" to 2, "episodeVersionId" to "r2"), sent()["target"])
        verifyNoInteractions(episodes)
    }

    @Test
    fun `a target episode before the grounding episode is refused before anything is resolved or sent`() {
        for (before in listOf(1, 0, -3)) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", "owner", "Bearer user", ask.copy(targetEpisode = before)) }.status)
        }
        verifyNoInteractions(scopes, episodes, client)
    }

    @Test
    fun `a target episode the work does not have is a 422 while other lookup failures keep their status`() {
        grounded()
        `when`(episodes.read("work", "owner", 9)).thenThrow(ContentFailure(404, "회차를 찾을 수 없어요."))
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", "owner", "Bearer user", ask.copy(targetEpisode = 9)) }.status)
        `when`(episodes.read("work", "owner", 8)).thenThrow(ContentFailure(403, "권한이 없어요."))
        assertEquals(403, assertThrows(ContentFailure::class.java) { service.run("work", "owner", "Bearer user", ask.copy(targetEpisode = 8)) }.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `resume ignores the target episode because the conversation already has its target`() {
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", "owner", "Bearer user", ask.copy(request = null, resume = WritingAiResume(true), threadId = "thread", targetEpisode = 1))
        assertFalse("target" in sent())
        verifyNoInteractions(episodes, forks)
    }

    @Test
    fun `resume sends a fresh scope token without a new request`() {
        `when`(client.history("thread", "user:owner/work:work")).thenReturn(
            mapper.readTree("""{"turns":[{"reply":{"basis":{"episode":2,"episodeVersionId":"r2"}}}]}"""))
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", "owner", "Bearer user", ask.copy(request = null, resume = WritingAiResume(true), threadId = "thread"))
        val body = sent()
        assertFalse("request" in body)
        val resume = body["resume"] as Map<*, *>
        assertEquals(true, resume["approved"])
        assertEquals("owner", grants.read(token(resume["scope"]))?.owner)
        assertEquals("thread", (body["conversation"] as Map<*, *>)["threadId"])
    }

    @Test
    fun `resuming while another episode is open keeps the stopped turn's basis on every resume path`() {
        // 2화·r2 근거로 멈춘 뒤 작가가 10화를 열었다(#668)
        `when`(client.history("thread", "user:owner/work:work")).thenReturn(mapper.readTree(
            """{"turns":[{"reply":{"basis":{"episode":9,"episodeVersionId":"r9"}}},
            {"reply":{"missingInputs":["research"],"basis":{"episode":2,"episodeVersionId":"r2"}}}]}"""))
        val paths = mapOf("input" to WritingAiResume(true, mapper.readTree("""{"research":{"question":"길"}}""")),
            "approve" to WritingAiResume(true), "reject" to WritingAiResume(false),
            "scene" to WritingAiResume(true, scene = WritingAiScene("next")), "refresh" to WritingAiResume(false, refresh = true))
        val issued = paths.mapValues { (_, resume) ->
            val opened = WritingAiRequest(resume = resume, episode = 10, episodeVersionId = "r10")
            grants.read(token((service.message("work", "owner", "thread", opened)["resume"] as Map<*, *>)["scope"]))
        }
        assertEquals(paths.mapValues { QaScopeGrant("work", "owner", 2, "r2") }, issued)
        verifyNoInteractions(scopes)  // 판본이 바뀌었어도 승인·거절은 막지 않는다. 검색 때 Content가 저장된 판본으로 확인한다
    }

    @Test
    fun `resume without a stored basis sends no token so the AI keeps the token of that turn`() {
        val unknown = listOf("""{"turns":[]}""", """{"turns":[{"reply":null}]}""",
            """{"turns":[{"reply":{"approvalEpisode":2}}]}""", """{"turns":[{"reply":{"basis":null}}]}""",
            """{"turns":[{"reply":{"basis":{"episode":2,"episodeVersionId":"r2"}}},{"reply":{"basis":null}}]}""")  // 앞 턴의 근거를 빌리지 않는다
        for (history in unknown) {
            `when`(client.history("thread", "user:owner/work:work")).thenReturn(mapper.readTree(history))
            val resume = service.message("work", "owner", "thread",
                WritingAiRequest(resume = WritingAiResume(true), episode = 10, episodeVersionId = "r10"))["resume"] as Map<*, *>
            assertEquals(mapOf("approved" to true), resume, history)
        }
    }

    @Test
    fun `ambiguous input or resume without thread never reach the model`() {
        for (bad in listOf(ask.copy(resume = WritingAiResume(true)),
            ask.copy(request = null), ask.copy(request = null, resume = WritingAiResume(false)))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", "owner", "Bearer user", bad) }.status)
        }
        verifyNoInteractions(client, scopes)
    }

    // 대화 세션(#331): 작품 권한을 확인한 뒤 작가·작품 scope로만 AI 세이버의 대화를 다룬다.
    private val scope = "user:owner/work:work"

    @Test
    fun `session reads and changes are bound to the signed-in author and work`() {
        `when`(client.sessions(scope)).thenReturn(result)
        `when`(client.history("thread", scope)).thenReturn(result)
        assertEquals(result, service.sessions("work", "owner"))
        assertEquals(result, service.history("work", "owner", "thread"))
        service.rename("work", "owner", "thread", "새 제목")
        service.delete("work", "owner", "thread")
        service.truncate("work", "owner", "thread", 2)
        verify(access, times(5)).own("work", "owner")
        verify(client).rename("thread", scope, "새 제목")
        verify(client).delete("thread", scope)
        verify(client).truncate("thread", scope, 2)
    }

    @Test
    fun `another author's work never reaches the AI`() {
        `when`(access.own("work", "intruder")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.sessions("work", "intruder") }.status)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.open("work", "intruder") }.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `a new session id is issued only for an owned work`() {
        val first = service.open("work", "owner").threadId
        assertNotEquals(first, service.open("work", "owner").threadId)
        verify(access, times(2)).own("work", "owner")
    }

    @Test
    fun `message body uses the path thread and edits rerun from the chosen turn`() {
        `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2"))).thenReturn(
            QaScope("work", null, 2, "r2", emptyList()))
        val body = service.message("work", "owner", "thread", ask.copy(threadId = "ignored"), fromTurn = 1)
        assertEquals(mapOf("threadId" to "thread", "scope" to scope), body["conversation"])
        assertEquals(1, body["fromTurn"])
        assertFalse("fromTurn" in service.message("work", "owner", "thread", ask))
    }

    @Test
    fun `resume forwards the inputs the author filled in`() {
        waitingOn(null)
        val inputs = JsonMapper.builder().build().readTree("""{"research":{"question":"한양에서 동래까지?"}}""")
        val body = service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true, inputs)))
        assertEquals(inputs, (body["resume"] as Map<*, *>)["inputs"])
    }

    // 채팅 구간 입력(#497): resume의 inputs.writing_editing.span을 Content가 검증하고 patch로 바꿔 AI에 보낸다. 허용 문맥은 AI가 채우므로 싣지 않는다.
    private val mapper = JsonMapper.builder().build()
    private val before = "가".repeat(2500)
    private val after = "나".repeat(2500)
    private val picked = "그는 웃었다."

    private fun draftOf(body: String, revision: Int = 4) =
        EpisodeResponse(2, DraftResponse("2화", body, revision), emptyList(), null, false, null)

    private fun spanInputs(start: Int, end: Int, revision: Int = 4, instruction: String? = "더 차갑게", episode: Int = 2) = mapper.readTree(
        """{"writing_editing":{"span":{"episode":$episode,"revision":$revision,"start":$start,"end":$end${instruction?.let { ""","instruction":"$it"""" } ?: ""}}}}""")

    private fun waitingOn(episode: Int?) {
        val history = mapper.readTree("""{"turns":[{"reply":{"approvalEpisode":9}},
            {"reply":{"approvalEpisode":$episode,"missingInputs":["research","writing_editing","manuscript_review"]}}]}""")
        `when`(client.history("thread", "user:owner/work:work")).thenReturn(history)
    }

    private fun resumedWith(inputs: tools.jackson.databind.JsonNode) =
        service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true, inputs)))["resume"] as Map<*, *>

    private fun refusedWith(inputs: tools.jackson.databind.JsonNode) =
        assertThrows(ContentFailure::class.java) { resumedWith(inputs) }.status

    @Test
    fun `a span on another episode than the waiting turn reflects into is a 422`() {
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(picked))
        waitingOn(3)  // 3화를 고치려고 멈췄는데 2화에서 고른 구간이 왔다
        assertEquals(422, refusedWith(spanInputs(0, 3)))
        waitingOn(null)  // 반영 회차를 알 수 없으면 통과시키지 않는다
        assertEquals(422, refusedWith(spanInputs(0, 3)))
        `when`(client.history("thread", "user:owner/work:work")).thenReturn(mapper.readTree("""{"turns":[]}"""))
        assertEquals(422, refusedWith(spanInputs(0, 3)))
    }

    @Test
    fun `a chosen span becomes a patch with the selection the surrounding text and the instruction but no context`() {
        waitingOn(2)
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(before + picked + after))
        val patch = resumedWith(spanInputs(2500, 2500 + picked.length))["inputs"]
        assertEquals(mapper.readTree("""{"writing_editing":{"patch":{"selection":"$picked","instruction":"더 차갑게",
            "precedingText":"${"가".repeat(2000)}","followingText":"${"나".repeat(2000)}"}}}"""), patch)
        assertFalse(patch.toString().contains("context"))
        assertFalse(patch.toString().contains("span"))
    }

    @Test
    fun `a span outside the other inputs leaves them as they were`() {
        waitingOn(2)
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(picked))
        val inputs = mapper.readTree("""{"research":{"question":"한양에서 동래까지?"},"writing_editing":{"span":{"episode":2,"revision":4,"start":0,"end":3,"instruction":"다듬어 줘"}}}""")
        val sent = resumedWith(inputs)["inputs"]
        assertEquals("한양에서 동래까지?", (sent as tools.jackson.databind.JsonNode).path("research").path("question").asString())
        assertEquals("그는 ", sent.path("writing_editing").path("patch").path("selection").asString())
    }

    @Test
    fun `spans that break the selection rules are a 422 and nothing reaches the AI`() {
        waitingOn(2)
        val body = "그는 웃었다. 😀 바람이 찼다."  // 공백이 7, 이모지(서로게이트 쌍)가 8~9에 있다
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(body))
        assertEquals(422, refusedWith(spanInputs(3, 3)))  // 빈 구간
        assertEquals(422, refusedWith(spanInputs(5, 3)))  // 거꾸로
        assertEquals(422, refusedWith(spanInputs(-1, 3)))
        assertEquals(422, refusedWith(spanInputs(0, body.length + 1)))  // 본문 밖
        assertEquals(422, refusedWith(spanInputs(0, 9)))  // 서로게이트 쌍의 중간에서 끝남
        assertEquals(422, refusedWith(spanInputs(9, 12)))  // 서로게이트 쌍의 중간에서 시작
        assertEquals(422, refusedWith(mapper.readTree("""{"writing_editing":{"span":{"episode":2,"revision":4,"start":7,"end":8,"instruction":"x"}}}""")))  // 공백뿐
        verify(client, never()).orchestrate(anyMap(), anyString())
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf("가".repeat(6000)))
        assertEquals(422, refusedWith(spanInputs(0, 5001)))  // 5,000자 초과
        resumedWith(spanInputs(0, 5000))  // 5,000자는 허용
    }

    @Test
    fun `a draft saved after the span was chosen is a 409`() {
        waitingOn(2)
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(picked, revision = 5))
        assertEquals(409, refusedWith(spanInputs(0, 3, revision = 4)))
    }

    @Test
    fun `a missing instruction or a malformed span is a 422 and an over-long instruction too`() {
        waitingOn(2)
        `when`(episodes.read("work", "owner", 2)).thenReturn(draftOf(picked))
        assertEquals(422, refusedWith(spanInputs(0, 3, instruction = null)))
        assertEquals(422, refusedWith(spanInputs(0, 3, instruction = " ")))
        assertEquals(422, refusedWith(spanInputs(0, 3, instruction = "가".repeat(2001))))
        assertEquals(422, refusedWith(mapper.readTree("""{"writing_editing":{"span":{"episode":"2","revision":4,"start":0,"end":3,"instruction":"x"}}}""")))
        assertEquals(422, refusedWith(mapper.readTree("""{"writing_editing":{"span":"0:3"}}""")))
        resumedWith(spanInputs(0, 3, instruction = "가".repeat(2000)))
    }

    @Test
    fun `another author's work or a missing episode keeps its own error`() {
        waitingOn(2)
        `when`(episodes.read("work", "owner", 2)).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, refusedWith(spanInputs(0, 3)))
    }

    @Test
    fun `inputs without a span go through untouched and never read the draft`() {
        waitingOn(2)
        val draft = mapper.readTree("""{"writing_editing":{"draft":{"episodeNumber":2,"plan":"선장이 도착한다."}}}""")
        assertEquals(draft, resumedWith(draft)["inputs"])
        val fix = mapper.readTree("""{"writing_editing":{"fix":1}}""")
        assertEquals(fix, resumedWith(fix)["inputs"])
        verifyNoInteractions(episodes)
    }

    @Test
    fun `direct patch input is a 422 because only a checked span becomes a patch`() {
        waitingOn(2)
        val patch = mapper.readTree("""{"writing_editing":{"patch":{"selection":"$picked","instruction":"더 차갑게"}}}""")
        assertEquals(422, refusedWith(patch))
        verifyNoInteractions(episodes)
    }

    @Test
    fun `direct draft input is accepted only for the waiting episode and without its own context`() {
        fun draft(number: String, more: String = "") =
            mapper.readTree("""{"writing_editing":{"draft":{"episodeNumber":$number,"plan":"선장이 도착한다."$more}}}""")
        waitingOn(2)
        for (bad in listOf(draft("10"), draft("\"2\""), draft("2.0"), draft("null"),
            draft("2", ""","context":"10화까지의 줄거리""""), mapper.readTree("""{"writing_editing":{"draft":"2화"}}"""))) {
            assertEquals(422, refusedWith(bad), bad.toString())
        }
        waitingOn(null)  // 반영 회차를 알 수 없으면 통과시키지 않는다
        assertEquals(422, refusedWith(draft("2")))
        assertEquals(422, refusedWith(draft("0")))
    }

    @Test
    fun `resume takes only the inputs the stopped step asked for and never story context`() {
        fun refused(missing: String, inputs: String) {
            `when`(client.history("thread", "user:owner/work:work")).thenReturn(mapper.readTree(
                """{"turns":[{"reply":{"missingInputs":$missing,"approvalEpisode":2,"basis":{"episode":2,"episodeVersionId":"r2"}}}]}"""))
            assertEquals(422, refusedWith(mapper.readTree(inputs)), "$missing $inputs")
        }
        val research = """"research":{"question":"길"}"""
        val excerpts = """"story_context":{"question":"결말은?","excerpts":[{"id":"x","episode":10,"quote":"선장은 배신자였다."}]}"""
        refused("""["research"]""", "{$research,$excerpts}")  // 2화 근거의 대기에 10화 발췌(#677)
        refused("""["story_context"]""", "{$excerpts}")  // 물어봤어도 발췌는 공개 API로 받지 않는다
        refused("""["research"]""", """{$research,"review":{"check":"both"}}""")  // 다른 단계, AI가 읽는 옛 이름
        refused("""["research"]""", """{$research,"manuscript_review":{"check":"both"}}""")
        refused("""["research"]""", """{$research,"writing_editing":{"fix":1}}""")
        refused("""["writing_editing"]""", """{"writing_editing":{"fix":1},$research}""")
        refused("[]", "{$research}")  // 승인·장면 대기
        `when`(client.history("thread", "user:owner/work:work")).thenReturn(mapper.readTree("""{"turns":[]}"""))
        assertEquals(422, refusedWith(mapper.readTree("{$research}")))  // 멈춘 턴을 알 수 없다
        assertEquals(mapper.readTree("{}"), resumedWith(mapper.readTree("{}"))["inputs"])  // 빈 입력은 그대로
        verifyNoInteractions(episodes)
    }

    // 시뮬레이션 무대의 장면 조작(resume.scene): 형식·길이만 확인해 AI로 그대로 넘긴다. 조작별 필수 필드는 AI가 다시 확인한다.
    private fun resumed(scene: WritingAiScene?) = service.message("work", "owner", "thread",
        ask.copy(request = null, resume = WritingAiResume(true, scene = scene)))["resume"] as Map<*, *>

    @Test
    fun `resume forwards the scene action of the stage with only the fields that were sent`() {
        assertEquals(mapOf("action" to "next"), resumed(WritingAiScene("next"))["scene"])
        assertEquals(mapOf("action" to "next", "note" to "갑자기 정전이 된다"), resumed(WritingAiScene("next", note = "갑자기 정전이 된다"))["scene"])
        assertEquals(mapOf("action" to "edit", "turn" to 2, "text" to "고친 글"), resumed(WritingAiScene("edit", turn = 2, text = "고친 글"))["scene"])
        assertEquals(mapOf("action" to "redo", "turn" to 0, "note" to "더 차갑게"), resumed(WritingAiScene("redo", turn = 0, note = "더 차갑게"))["scene"])
        assertEquals(mapOf("action" to "stop"), resumed(WritingAiScene("stop"))["scene"])
        assertEquals(true, resumed(WritingAiScene("stop"))["approved"])  // approved는 그대로 함께 간다(AI가 scene을 먼저 처리한다)
        assertFalse("scene" in resumed(null))
    }

    @Test
    fun `request validation bounds the scene action and its fields`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            fun problems(scene: WritingAiScene) = validator.validate(ask.copy(request = null, resume = WritingAiResume(true, scene = scene)))
                .map { it.propertyPath.toString() }
            assertTrue(problems(WritingAiScene("edit", turn = 0, text = "가".repeat(2000))).isEmpty())
            assertTrue(problems(WritingAiScene("next", note = "가".repeat(300))).isEmpty())
            assertEquals(listOf("resume.scene.action"), problems(WritingAiScene("jump")))
            assertEquals(listOf("resume.scene.turn"), problems(WritingAiScene("redo", turn = -1)))
            assertEquals(listOf("resume.scene.text"), problems(WritingAiScene("edit", turn = 1, text = "가".repeat(2001))))
            assertEquals(listOf("resume.scene.note"), problems(WritingAiScene("next", note = "가".repeat(301))))
        }
    }

    // [시뮬레이션] 버튼의 시작 양식(simulation): operation이 character_simulation인 새 요청에서만 받아 AI로 그대로 넘긴다.
    private val button = ask.copy(request = "흐름 모드 시뮬레이션: 장면 계획 3개", operation = "character_simulation",
        simulation = WritingAiSimulation("flow", beats = listOf("성문 대면", "숨긴 정체"), characterIds = listOf("k", "l")))

    private fun scopeResolves() = `when`(scopes.resolve("work", "owner", QaScopeRequest(2, "r2"))).thenReturn(
        QaScope("work", null, 2, "r2", emptyList()))

    @Test
    fun `the simulation form of the button reaches the AI as it is with the operation`() {
        scopeResolves()
        val body = service.message("work", "owner", "thread", button)
        assertEquals("character_simulation", body["operation"])
        assertEquals(mapOf("mode" to "flow", "beats" to listOf("성문 대면", "숨긴 정체"), "characterIds" to listOf("k", "l")), body["simulation"])
        val premise = WritingAiSimulation("if", premise = "만약 북문이 열려 있었다면?", characterIds = listOf("k"))
        assertEquals(mapOf("mode" to "if", "premise" to "만약 북문이 열려 있었다면?", "characterIds" to listOf("k")),
            service.message("work", "owner", "thread", button.copy(simulation = premise))["simulation"])
        assertFalse("simulation" in service.message("work", "owner", "thread", ask))
    }

    @Test
    fun `a simulation form is refused unless the request is a new character_simulation operation`() {
        for (bad in listOf(button.copy(operation = null), button.copy(operation = "writing_editing"),
            button.copy(request = null, resume = WritingAiResume(true), threadId = "thread"))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", bad) }.status)
        }
        verifyNoInteractions(scopes)  // 권한 확인 전에 형식부터 막는다
    }

    @Test
    fun `simulation form items over their limits never get past the service`() {
        scopeResolves()
        val form = button.simulation!!
        for (bad in listOf(form.copy(beats = listOf("")), form.copy(beats = listOf("가".repeat(201))), form.copy(characterIds = listOf("")),
            form.copy(characterIds = listOf("i".repeat(101))))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", button.copy(simulation = bad)) }.status)
        }
        val edge = form.copy(beats = listOf("가".repeat(200)), characterIds = listOf("i".repeat(100)))
        assertEquals(listOf("가".repeat(200)), (service.message("work", "owner", "thread", button.copy(simulation = edge))["simulation"] as Map<*, *>)["beats"])
    }

    @Test
    fun `a blank premise or edit text is refused here as a 422 instead of becoming an AI error shown as a 502`() {
        scopeResolves()
        val form = WritingAiSimulation("if", premise = "만약 북문이 열려 있었다면?", characterIds = listOf("k"))
        for (bad in listOf("", "   ", "\n\t ")) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", button.copy(simulation = form.copy(premise = bad))) }.status)
            val edit = ask.copy(request = null, threadId = "thread", resume = WritingAiResume(true, scene = WritingAiScene("edit", turn = 0, text = bad)))
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", edit) }.status)
        }
        // 값이 있으면 그대로 통과하고, 선택 필드의 생략(흐름 모드의 전제, edit가 아닌 조작의 글)도 막지 않는다.
        service.message("work", "owner", "thread", button.copy(simulation = form))
        service.message("work", "owner", "thread", button)
        val edited = ask.copy(request = null, threadId = "thread", resume = WritingAiResume(true, scene = WritingAiScene("edit", turn = 0, text = "고친 줄")))
        assertEquals("고친 줄", ((service.message("work", "owner", "thread", edited)["resume"] as Map<*, *>)["scene"] as Map<*, *>)["text"])
        service.message("work", "owner", "thread", edited.copy(resume = WritingAiResume(true, scene = WritingAiScene("next", note = "끼어들기"))))
    }

    @Test
    fun `request validation bounds the mode and the sizes of the simulation form`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            val form = button.simulation!!
            fun problems(simulation: WritingAiSimulation) = validator.validate(button.copy(simulation = simulation)).map { it.propertyPath.toString() }
            assertTrue(validator.validate(button).isEmpty())
            assertTrue(validator.validate(button.copy(simulation = form.copy(beats = List(8) { "비트" }, characterIds = List(6) { "id$it" }))).isEmpty())
            assertEquals(listOf("simulation.mode"), problems(form.copy(mode = "story")))
            assertEquals(listOf("simulation.premise"), problems(form.copy(premise = "가".repeat(501))))
            assertEquals(listOf("simulation.beats"), problems(form.copy(beats = List(9) { "비트" })))
            assertEquals(listOf("simulation.characterIds"), problems(form.copy(characterIds = emptyList())))
            assertEquals(listOf("simulation.characterIds"), problems(form.copy(characterIds = List(7) { "id$it" })))
        }
    }

    @Test
    fun `resume forwards a proposal refresh and never lets it approve`() {
        fun body(resume: WritingAiResume) = service.message("work", "owner", "thread", ask.copy(request = null, resume = resume))["resume"] as Map<*, *>
        val refreshed = body(WritingAiResume(false, refresh = true))
        assertEquals(false, refreshed["approved"])
        assertEquals(true, refreshed["refresh"])
        assertFalse("refresh" in body(WritingAiResume(false)))  // 보낸 요청에만 싣는다
        assertEquals(422, assertThrows(ContentFailure::class.java) { body(WritingAiResume(true, refresh = true)) }.status)
    }

    @Test
    fun `an edit is always a new request, never a resume`() {
        val failure = assertThrows(ContentFailure::class.java) {
            service.message("work", "owner", "thread", ask.copy(request = null, resume = WritingAiResume(true)), fromTurn = 1)
        }
        assertEquals(422, failure.status)
    }

    // 첨부(#617): 새 요청에서만 받아 AI에 그대로 싣는다. 개수·형식·Base64 길이는 DTO가, 디코딩·정확한 크기·UTF-8은 AI가 확인한다.
    private val note = WritingAiAttachment("메모.md", "text/markdown", "IyDshqTsoJU=")
    private val map = WritingAiAttachment("지도.png", "image/png", "iVBORw0KGgo=")

    @Test
    fun `attachments of a new request reach the AI body as they are`() {
        scopeResolves()
        val body = service.message("work", "owner", "thread", ask.copy(attachments = listOf(note, map)))
        assertEquals(listOf(
            mapOf("name" to "메모.md", "mediaType" to "text/markdown", "data" to note.data),
            mapOf("name" to "지도.png", "mediaType" to "image/png", "data" to map.data),
        ), body["attachments"])
    }

    @Test
    fun `a request without attachments sends no attachments key as before`() {
        scopeResolves()
        assertFalse("attachments" in service.message("work", "owner", "thread", ask))
        assertFalse("attachments" in service.message("work", "owner", "thread", ask.copy(attachments = emptyList())))
    }

    @Test
    fun `attachments with a resume are a 422 before anything is resolved or sent`() {
        val resumed = ask.copy(request = null, threadId = "thread", resume = WritingAiResume(true), attachments = listOf(note))
        val failure = assertThrows(ContentFailure::class.java) { service.message("work", "owner", "thread", resumed) }
        assertEquals(422, failure.status)
        assertEquals("첨부는 새 요청에만 보낼 수 있어요.", failure.message)
        verifyNoInteractions(scopes, client)
        scopeResolves()
        assertTrue("resume" in service.message("work", "owner", "thread", resumed.copy(attachments = emptyList())))  // 빈 목록은 이어가기를 막지 않는다
    }

    @Test
    fun `request validation bounds the attachment count name media type and data length`() {
        jakarta.validation.Validation.buildDefaultValidatorFactory().use { factory ->
            val validator = factory.validator
            fun problems(vararg items: WritingAiAttachment) = validator.validate(ask.copy(attachments = items.toList())).map { it.propertyPath.toString() }
            assertTrue(problems().isEmpty() && problems(note, map, note).isEmpty())
            for (type in listOf("image/png", "image/jpeg", "image/webp", "text/plain", "text/markdown")) assertTrue(problems(note.copy(mediaType = type)).isEmpty())
            assertTrue(problems(note.copy(name = "가".repeat(200)), note.copy(data = "A".repeat(6_990_508))).isEmpty())
            assertEquals(listOf("attachments"), problems(note, map, note, map))
            assertEquals(listOf("attachments[0].name"), problems(note.copy(name = "")))
            assertEquals(listOf("attachments[0].name"), problems(note.copy(name = "가".repeat(201))))
            for (type in listOf("image/gif", "application/pdf", "text/html", "image/png2")) assertEquals(listOf("attachments[0].mediaType"), problems(note.copy(mediaType = type)))
            assertEquals(listOf("attachments[0].data"), problems(note.copy(data = "")))
            assertEquals(listOf("attachments[0].data"), problems(note.copy(data = "A".repeat(6_990_509))))
        }
    }

    // 화면 맥락(#554): 길이는 DTO가, 권한은 사용자 기준으로 Service가 다시 확인하고 통과한 값만 AI에 싣는다.
    private val owner = "5b1e3f0a-1111-4222-8333-444455556666"
    private val worldId = java.util.UUID.fromString("0a0a0a0a-1111-4222-8333-444455556666")
    private val cardId = java.util.UUID.fromString("0b0b0b0b-1111-4222-8333-444455556666")

    private fun pageAsk(page: WritingAiPage) = ask.copy(page = page)
    private fun worldPage(world: String? = worldId.toString(), card: String? = cardId.toString()) =
        WritingAiPage("/worldstudio/$world?card=$card", "world", worldId = world, cardId = card, view = "cards",
            content = WritingAiPageContent("카엘", "북문을 지키는 기사", true))

    private fun groundedFor(who: String) = `when`(scopes.resolve("work", who, QaScopeRequest(2, "r2"))).thenReturn(QaScope("work", null, 2, "r2", emptyList()))

    @Test
    fun `a world page of this authors linked world and card goes to the AI with only the given fields`() {
        groundedFor(owner)
        `when`(workWorlds.linkedWorldId("work", owner)).thenReturn(worldId)
        `when`(worlds.hasCard(worldId, java.util.UUID.fromString(owner), cardId)).thenReturn(true)
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", owner, "Bearer user", pageAsk(worldPage()))
        assertEquals(mapOf("path" to "/worldstudio/$worldId?card=$cardId", "kind" to "world", "worldId" to worldId.toString(), "cardId" to cardId.toString(),
            "view" to "cards", "content" to mapOf("title" to "카엘", "body" to "북문을 지키는 기사", "unsaved" to true)), sent()["page"])
    }

    @Test
    fun `a studio page checks the episode and sends the selection`() {
        groundedFor(owner)
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", owner, "Bearer user", pageAsk(WritingAiPage("/studio/work?ep=2", "studio", episode = 2, selection = "그는 웃었다.")))
        verify(episodes).read("work", owner, 2)
        assertEquals(mapOf("path" to "/studio/work?ep=2", "kind" to "studio", "episode" to 2, "selection" to "그는 웃었다."), sent()["page"])
    }

    @Test
    fun `a studio episode the work does not have is a 422 and nothing reaches the AI`() {
        groundedFor(owner)
        `when`(episodes.read("work", owner, 9)).thenThrow(ContentFailure(404, "회차를 찾을 수 없어요."))
        assertEquals(422, assertThrows(ContentFailure::class.java) {
            service.run("work", owner, "Bearer user", pageAsk(WritingAiPage("/studio/work?ep=9", "studio", episode = 9)))
        }.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `a studio page on another episode than the reflect episode is a 422 and nothing reaches the AI`() {
        groundedFor(owner)
        val selected = "그는 웃었다."
        for (request in listOf(
            pageAsk(WritingAiPage("/studio/work?ep=2", "studio", episode = 2, selection = selected)).copy(targetEpisode = 3),
            pageAsk(WritingAiPage("/studio/work?ep=3", "studio", episode = 3, selection = selected)),  // 반영 회차가 없으면 근거 회차(2화)에 쓴다
            pageAsk(WritingAiPage("/studio/work?ep=2", "studio", episode = 2)).copy(targetEpisode = 3),  // 선택 글이 없어도 화면 원고가 섞인다
        )) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", request) }.status)
        }
        verifyNoInteractions(client)
    }

    @Test
    fun `a studio page on the unpublished reflect episode goes to the AI as it is`() {
        groundedFor(owner)
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        val page = WritingAiPage("/studio/work?ep=3", "studio", episode = 3, selection = "그는 웃었다.")
        service.run("work", owner, "Bearer user", pageAsk(page).copy(targetEpisode = 3))
        val body = sent()
        assertEquals(mapOf("workId" to "work", "episode" to 3, "baseEpisode" to 2, "episodeVersionId" to "r2"), body["target"])
        assertEquals(mapOf("path" to page.path, "kind" to "studio", "episode" to 3, "selection" to "그는 웃었다."), body["page"])
    }

    @Test
    fun `a selection without its episode is a 422 on either screen`() {
        groundedFor(owner)
        for (page in listOf(WritingAiPage("/studio/work", "studio", selection = "그는 웃었다."),
            WritingAiPage("/worldstudio", "world", selection = "그는 웃었다."))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(page)) }.status)
        }
        verifyNoInteractions(client)
    }

    @Test
    fun `a world that is not the one linked to this work is refused`() {
        groundedFor(owner)
        `when`(workWorlds.linkedWorldId("work", owner)).thenReturn(null)
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(worldPage())) }.status)
        `when`(workWorlds.linkedWorldId("work", owner)).thenReturn(java.util.UUID.randomUUID())
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(worldPage())) }.status)
        assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(worldPage(world = "not-a-uuid"))) }.status)
        verifyNoInteractions(client, worlds)
    }

    @Test
    fun `a card that is not in the linked world or was removed is refused and another authors world keeps its 404`() {
        groundedFor(owner)
        `when`(workWorlds.linkedWorldId("work", owner)).thenReturn(worldId)
        `when`(worlds.hasCard(worldId, java.util.UUID.fromString(owner), cardId)).thenReturn(false)
        for (page in listOf(worldPage(), worldPage(card = java.util.UUID.randomUUID().toString()), worldPage(card = "not-a-uuid"))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(page)) }.status)
        }
        `when`(worlds.hasCard(worldId, java.util.UUID.fromString(owner), cardId)).thenThrow(ContentFailure(404, "세계관을 찾을 수 없어요."))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(worldPage())) }.status)
        verifyNoInteractions(client)
    }

    @Test
    fun `mixed page kinds are refused`() {
        groundedFor(owner)
        for (page in listOf(WritingAiPage("/studio/work", "studio", worldId = worldId.toString()), WritingAiPage("/worldstudio", "world", episode = 2),
            WritingAiPage("/worldstudio", "world", cardId = cardId.toString()))) {
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.run("work", owner, "Bearer user", pageAsk(page)) }.status)
        }
    }

    @Test
    fun `resume ignores the page`() {
        `when`(client.orchestrate(anyMap(), anyString())).thenReturn(result)
        service.run("work", owner, "Bearer user", ask.copy(request = null, resume = WritingAiResume(true), threadId = "thread", page = worldPage()))
        assertFalse("page" in sent())
        verifyNoInteractions(workWorlds, worlds, episodes)
    }

    @Test
    fun `a page over the limits is a validation failure`() {
        val validator = jakarta.validation.Validation.buildDefaultValidatorFactory().validator
        fun violations(page: WritingAiPage) = validator.validate(pageAsk(page)).map { it.propertyPath.toString() }
        assertTrue(violations(WritingAiPage("/studio/work", "studio")).isEmpty())
        assertEquals(listOf("page.path"), violations(WritingAiPage("x".repeat(301), "studio")))
        assertEquals(listOf("page.selection"), violations(WritingAiPage("/studio/work", "studio", selection = "가".repeat(5001))))
        assertEquals(listOf("page.content.body"), violations(WritingAiPage("/studio/work", "studio", content = WritingAiPageContent(null, "가".repeat(10001), true))))
        assertEquals(listOf("page.content.unsaved"), violations(WritingAiPage("/studio/work", "studio", content = WritingAiPageContent(null, "본문", false))))
        assertEquals(listOf("page.kind"), violations(WritingAiPage("/studio/work", "library")))
    }
}
