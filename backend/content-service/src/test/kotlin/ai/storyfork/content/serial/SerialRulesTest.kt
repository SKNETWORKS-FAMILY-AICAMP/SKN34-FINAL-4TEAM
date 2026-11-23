package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.serial.domain.*
import ai.storyfork.content.serial.entity.SerialChoiceEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.entity.SerialProposalLikeEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.service.dto.SerialProposalRequest
import ai.storyfork.content.serial.service.dto.SerialSimulationRequest
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper

/** AI 자율 연재의 순수 규칙(일정 도래·1위 선택지와 추천 상위 제안 선정·입력 검증·문맥 크기)을 DB·HTTP 없이 고정한다. */
class SerialRulesTest {
    private fun kst(date: String, time: String) = ZonedDateTime.of(LocalDate.parse(date), LocalTime.parse(time), KST)
    private fun status(block: () -> Unit) = assertThrows(ContentFailure::class.java, block).status

    // 2026-11-23은 월요일이다(아래 테스트가 요일을 먼저 확인한다).
    private val monday = "2026-11-23"

    @Test fun `the dates used below are the weekdays the tests claim`() {
        assertEquals(DayOfWeek.MONDAY, LocalDate.parse(monday).dayOfWeek)
        assertEquals(DayOfWeek.TUESDAY, LocalDate.parse("2026-11-24").dayOfWeek)
        assertEquals(DayOfWeek.WEDNESDAY, LocalDate.parse("2026-11-25").dayOfWeek)
    }

    // ---- 일정 도래

    @Test fun `a schedule is due from the set time until one hour later on a chosen weekday`() {
        val at = LocalTime.of(21, 0)
        assertTrue(isSerialDue("MON,WED", at, null, kst(monday, "21:00")))
        assertTrue(isSerialDue("MON,WED", at, null, kst(monday, "21:59")))
        assertTrue(isSerialDue("MON,WED", at, null, kst("2026-11-25", "21:10")))
    }

    @Test fun `before the time and from exactly one hour later the schedule is skipped`() {
        val at = LocalTime.of(21, 0)
        assertFalse(isSerialDue("MON", at, null, kst(monday, "20:59")))
        // 1시간을 넘긴 일정은 건너뛴다. 정확히 1시간째부터는 제외다.
        assertFalse(isSerialDue("MON", at, null, kst(monday, "22:00")))
        assertFalse(isSerialDue("MON", at, null, kst(monday, "23:30")))
    }

    @Test fun `a weekday that was not chosen is never due`() {
        assertFalse(isSerialDue("MON,WED", LocalTime.of(21, 0), null, kst("2026-11-24", "21:10")))
        assertFalse(isSerialDue("", LocalTime.of(21, 0), null, kst(monday, "21:10")))
    }

    @Test fun `a schedule that already ran today is not due again but yesterday's run does not block`() {
        val at = LocalTime.of(21, 0)
        val now = kst(monday, "21:10")
        assertFalse(isSerialDue("MON", at, LocalDate.parse(monday), now))
        assertTrue(isSerialDue("MON", at, LocalDate.parse("2026-11-22"), now))
        assertTrue(isSerialDue("MON", at, LocalDate.parse("2026-11-16"), now))
    }

    @Test fun `the due check uses Korean time even when the clock is in another zone`() {
        // 2026-11-23 12:10 UTC = 21:10 KST(월요일). UTC로 보면 아직 21시 전이다.
        val utc = ZonedDateTime.parse("2026-11-23T12:10:00Z")
        assertTrue(isSerialDue("MON", LocalTime.of(21, 0), null, utc.withZoneSameInstant(KST)))
        assertEquals(LocalDate.parse(monday), utc.withZoneSameInstant(KST).toLocalDate())
    }

    @Test fun `a window that would cross midnight is cut at midnight because today must be the chosen weekday`() {
        val at = LocalTime.of(23, 30)
        assertTrue(isSerialDue("MON", at, null, kst(monday, "23:45")))
        // 화요일 00:10은 화요일이므로 월요일만 고른 일정은 제외다.
        assertFalse(isSerialDue("MON", at, null, kst("2026-11-24", "00:10")))
    }

    // ---- 요일·시각 검증

    @Test fun `days are validated and stored in Monday-first order`() {
        assertEquals("MON,WED", serialDays(listOf("MON", "WED")))
        assertEquals("MON,WED,SUN", serialDays(listOf("SUN", "WED", "MON")))
        assertEquals("MON,TUE,WED,THU,FRI,SAT,SUN", serialDays(listOf("SUN", "SAT", "FRI", "THU", "WED", "TUE", "MON")))
        assertEquals(setOf(DayOfWeek.MONDAY, DayOfWeek.SUNDAY), serialDaySet("MON,SUN"))
        assertEquals(emptySet<DayOfWeek>(), serialDaySet(""))
    }

    @Test fun `days must be distinct known codes and at least one`() {
        for (bad in listOf(listOf("MON", "MON"), listOf("mon"), listOf("MONDAY"), listOf(""), listOf("MON", "XXX"))) {
            assertEquals(422, status { serialDays(bad) }, bad.toString())
        }
        // 일정 저장은 켜기·끄기와 무관하게(켜기는 집필 방식이 한다) 요일이 하나 이상이어야 한다.
        assertEquals(422, status { serialDays(emptyList()) })
    }

    @Test fun `time is a strict 24-hour HH-mm`() {
        assertEquals(LocalTime.of(21, 0), serialTime("21:00"))
        assertEquals(LocalTime.of(0, 5), serialTime("00:05"))
        assertEquals(LocalTime.of(23, 59), serialTime("23:59"))
        for (bad in listOf("", "9:05", "24:00", "12:60", "21:00:00", "2100", "21-00", " 21:00", "21:00 ", "ab:cd")) {
            assertEquals(422, status { serialTime(bad) }, bad)
        }
    }

    // ---- 선택지 순위

    private fun choice(position: Int) = SerialChoiceEntity(id = "c$position", boardId = "b", position = position, text = "선택지 $position")
    private fun choices() = (1..4).map { choice(it) }
    private fun vote(member: String, choiceId: String) = SerialVoteEntity("b", member, choiceId)

    @Test fun `the top choice has the most votes and each choice carries its count in position order`() {
        val votes = listOf(vote("m1", "c3"), vote("m2", "c3"), vote("m3", "c2"))

        assertEquals("c3", topChoice(choices(), votes)!!.choice.id)
        assertEquals(2, topChoice(choices(), votes)!!.votes)
        // 화면 순서는 번호 순이다: 득표가 많아도 자리를 옮기지 않는다.
        assertEquals(listOf("c1", "c2", "c3", "c4"), rankChoices(choices(), votes).map { it.choice.id })
        assertEquals(listOf(0, 1, 2, 0), rankChoices(choices(), votes).map { it.votes })
    }

    @Test fun `equal votes go to the smaller position and no votes at all means choice one`() {
        assertEquals("c1", topChoice(choices(), emptyList())!!.choice.id)
        assertEquals("c2", topChoice(choices(), listOf(vote("m1", "c4"), vote("m2", "c2"), vote("m3", "c4"), vote("m4", "c2")))!!.choice.id)
        // 입력 순서와 상관없이 번호가 작은 쪽이다.
        assertEquals("c1", topChoice(choices().reversed(), listOf(vote("m1", "c3"), vote("m2", "c1"), vote("m3", "c3"), vote("m4", "c1")))!!.choice.id)
    }

    @Test fun `there is no top choice without choices and votes for unknown choices change nothing`() {
        assertNull(topChoice(emptyList(), listOf(vote("m1", "c1"))))
        assertEquals("c1", topChoice(choices(), listOf(vote("m1", "elsewhere"), vote("m2", "elsewhere")))!!.choice.id)
        assertEquals(listOf(0, 0, 0, 0), rankChoices(choices(), listOf(vote("m1", "elsewhere"))).map { it.votes })
    }

    @Test fun `AI choices must be exactly four trimmed texts of one to three hundred characters`() {
        assertEquals(listOf("가", "나", "다", "라"), cleanChoices(listOf(" 가 ", "나", "다", "라 ")))
        assertEquals(300, cleanChoices(listOf("가".repeat(300), "나", "다", "라"))!![0].length)
        for (bad in listOf(
            emptyList<String>(), listOf("가", "나", "다"), listOf("가", "나", "다", "라", "마"), listOf("가", "나", "다", ""), listOf("가", "나", "다", "  "),
            listOf("가".repeat(301), "나", "다", "라"), listOf("가", "나", "다", "라" + Char(0)),
        )) {
            assertNull(cleanChoices(bad), bad.toString().take(40))
        }
    }

    @Test fun `an AI summary must be one to four hundred trimmed characters without NUL`() {
        assertEquals("두 사람은 폐교에서 재회했다.", cleanSummary("  두 사람은 폐교에서 재회했다.  "))
        assertEquals(400, cleanSummary("가".repeat(400))!!.length)
        for (bad in listOf("", "   ", "가".repeat(401), "요약" + Char(0))) {
            assertNull(cleanSummary(bad), bad.take(20))
        }
    }

    @Test fun `a credit limit overrun a failed related search and a missing world have their own fixed reasons apart from the other failures`() {
        assertEquals("크레딧 상한을 넘었습니다.", SerialReason.LIMIT)
        assertEquals("관련 장면 검색에 실패했습니다.", SerialReason.SEARCH)
        assertEquals("연결된 세계관이 없어 시뮬레이션으로 집필할 수 없습니다.", SerialReason.NO_WORLD)
        val all = listOf(SerialReason.CREDIT, SerialReason.REVIEW, SerialReason.AI, SerialReason.PUBLISH, SerialReason.DRAFT, SerialReason.LIMIT, SerialReason.SEARCH, SerialReason.NO_WORLD)
        assertEquals(all.size, all.toSet().size)
    }

    // ---- 실패 사유

    @Test fun `an AI sentence becomes a failure reason with its spaces tidied`() {
        val sentence = "인물 문서가 비어 있어요: 카엘(SOUL.md). 세계관 관리 화면에서 채워 주세요."
        assertEquals(sentence, cleanReason(sentence))
        assertEquals("한 줄로 정리돼요.", cleanReason("  한\n줄로\t\t정리돼요.\r\n "))
        assertEquals("가 나 다", cleanReason("가\u00A0나\u3000다"))
        // 제어 문자(NUL은 PostgreSQL 글 칸에 들어가지 못한다)도 빈칸 한 칸으로 줄인다.
        assertEquals("가 나 다", cleanReason("가" + Char(0) + "나" + Char(7) + "다"))
    }

    @Test fun `a failure reason is cut at three hundred characters without splitting a surrogate pair or leaving a trailing space`() {
        assertEquals("가".repeat(300), cleanReason("가".repeat(300)))
        assertEquals("가".repeat(300), cleanReason("가".repeat(301)))
        assertEquals("가".repeat(299), cleanReason("가".repeat(299) + "😀" + "나"))
        assertEquals("가".repeat(299), cleanReason("가".repeat(299) + " " + "나".repeat(10)))
    }

    @Test fun `nothing left after tidying is no reason at all`() {
        for (blank in listOf("", "   ", "\n\t\r", "\u00A0\u3000", Char(0).toString())) assertNull(cleanReason(blank), blank.length.toString())
    }

    // ---- 실행 시간 한도

    @Test fun `the run time limits are the thirty-five minute AI wait and the forty-five minute stale cleanup`() {
        // 회차 실행은 인물 시뮬레이션을 거쳐 AI 최악이 1,810초(약 30분)다(계약 '회차 집필은 반드시 인물 시뮬레이션으로').
        // AI의 단위 테스트가 그 합 ≤ 2,100−240초를 고정하고, 이쪽은 읽기 한도 35분(2,100초)과 정체 정리 45분을 고정한다.
        assertEquals(35L, EPISODE_READ_TIMEOUT_MINUTES)
        assertEquals(45L, STALE_RUNNING_MINUTES)
    }

    @Test fun `a running board is never called stale while its AI call can still be waiting`() {
        // 불변식: 정체 정리 기준이 AI 읽기 한도(와 AI 호출 앞뒤의 짧은 일: Core 확인·세계관 읽기·검색·예약, 저장·발행·정산)보다 길어야 정상 실행을 정리 점검이 먼저 실패로 닫지 않는다.
        val read = Duration.ofMinutes(EPISODE_READ_TIMEOUT_MINUTES)
        val stale = Duration.ofMinutes(STALE_RUNNING_MINUTES)
        assertTrue(read < stale, "읽기 한도 $read 는 정체 정리 기준 $stale 보다 짧아야 한다")
        assertTrue(read + Duration.ofMinutes(5) <= stale, "AI 호출 앞뒤의 일을 위한 여유가 5분보다 적다: 읽기 한도 $read, 정체 정리 기준 $stale")
    }

    // ---- 제안 글 순위

    private fun proposal(id: String, at: Long, hidden: Boolean = false, kind: String = "general") =
        SerialProposalEntity(id = id, boardId = "b", authorId = "author-$id", kind = kind, title = "제목 $id", body = "본문 $id", hidden = hidden, createdAt = Instant.ofEpochSecond(at))
    private fun like(member: String, proposalId: String) = SerialProposalLikeEntity(proposalId, member)
    private fun ids(ranked: List<RankedProposal>) = ranked.map { it.proposal.id }

    @Test fun `the top proposals are ordered by likes and counted`() {
        val proposals = listOf(proposal("a", 1), proposal("b", 2), proposal("c", 3))
        val likes = listOf(like("m1", "c"), like("m2", "c"), like("m3", "b"))

        val top = topProposals(proposals, likes)

        assertEquals(listOf("c", "b", "a"), ids(top))
        assertEquals(listOf(2, 1, 0), top.map { it.likes })
    }

    @Test fun `equal likes go to the proposal written first and then to the smaller id`() {
        val tie = listOf(proposal("late", 30), proposal("early", 10), proposal("mid", 20))
        assertEquals(listOf("early", "mid", "late"), ids(topProposals(tie, emptyList())))

        val sameTime = listOf(proposal("z", 5), proposal("a", 5))
        assertEquals(listOf("a", "z"), ids(topProposals(sameTime, emptyList())))

        // 추천이 많으면 늦게 쓴 글이 먼저다.
        assertEquals("late", ids(topProposals(tie, listOf(like("m1", "late")))).first())
    }

    @Test fun `hidden proposals never count even with the most likes`() {
        val proposals = listOf(proposal("bad", 1, hidden = true), proposal("good", 2), proposal("fine", 3))
        val likes = listOf(like("m1", "bad"), like("m2", "bad"), like("m3", "bad"), like("m4", "good"))

        assertEquals(listOf("good", "fine"), ids(topProposals(proposals, likes)))
        assertEquals(listOf("good", "fine"), ids(rankProposals(proposals, likes)))
    }

    @Test fun `only the top three are chosen and zero-like proposals fill in when few have likes`() {
        val proposals = (1..5).map { proposal("p$it", it.toLong()) }
        val likes = listOf(like("m1", "p5"), like("m2", "p5"), like("m3", "p4"))

        assertEquals(listOf("p5", "p4", "p1"), ids(topProposals(proposals, likes)))
        assertEquals(5, rankProposals(proposals, likes).size)
        assertEquals(emptyList<RankedProposal>(), topProposals(emptyList(), emptyList()))
    }

    @Test fun `likes for other proposals or unknown ids do not change the order`() {
        val proposals = listOf(proposal("a", 1), proposal("b", 2))
        val likes = listOf(like("m1", "elsewhere"), like("m2", "b"))

        assertEquals(listOf("b", "a"), ids(topProposals(proposals, likes)))
    }

    // ---- 제안 글 입력 검증

    private fun general(title: String = "다음 전개 제안", body: String = "다음에는 두 사람이 만나면 좋겠어요") = SerialProposalRequest("general", title, body)
    private fun simulation(title: String = "폐교 장면", premise: String = "두 사람이 폐교에서 마주친다", beats: List<String> = listOf("문이 열린다"), body: String = "") =
        SerialProposalRequest("simulation", title, body, SerialSimulationRequest(premise, beats))

    @Test fun `a general proposal keeps trimmed title and text`() {
        val clean = cleanProposal(general("  다음 전개 제안  ", "  두 사람이 만나면 좋겠어요  "))

        assertEquals(CleanProposal("general", "다음 전개 제안", "두 사람이 만나면 좋겠어요", null, emptyList()), clean)
    }

    @Test fun `a general proposal needs a title up to 100 and a text up to 2000 visible characters and no NUL`() {
        assertEquals(100, cleanProposal(general(title = "가".repeat(100))).title.length)
        assertEquals(2000, cleanProposal(general(body = "가".repeat(2000))).body.length)
        for (bad in listOf("", "   ", "가".repeat(101), "제목" + Char(0), Char(0xA0).toString())) assertEquals(422, status { cleanProposal(general(title = bad)) }, "title " + bad.take(20))
        for (bad in listOf("", "   ", "가".repeat(2001), "본문" + Char(0), Char(0xA0).toString())) assertEquals(422, status { cleanProposal(general(body = bad)) }, "body " + bad.take(20))
    }

    @Test fun `an unknown kind or a kind with the wrong block is rejected`() {
        assertEquals(422, status { cleanProposal(SerialProposalRequest("setting", "제목", "x")) })
        assertEquals(422, status { cleanProposal(SerialProposalRequest("", "제목", "x")) })
        assertEquals(422, status { cleanProposal(SerialProposalRequest("GENERAL", "제목", "x")) })
        // 일반 글에 시뮬레이션 입력을 섞지 않는다. 시뮬레이션 글에는 시뮬레이션 입력이 있어야 한다.
        assertEquals(422, status { cleanProposal(SerialProposalRequest("general", "제목", "x", SerialSimulationRequest("전제", emptyList()))) })
        assertEquals(422, status { cleanProposal(SerialProposalRequest("simulation", "제목", "x")) })
    }

    @Test fun `a simulation proposal takes a premise up to 500 and up to five beats of 200`() {
        val limit = simulation(premise = "가".repeat(500), beats = List(5) { "나".repeat(200) })
        val clean = cleanProposal(limit)

        assertEquals(500, clean.premise!!.length)
        assertEquals(List(5) { "나".repeat(200) }, clean.beats)
        assertEquals(emptyList<String>(), cleanProposal(simulation(beats = emptyList())).beats)
    }

    @Test fun `bad simulation input is rejected`() {
        for (bad in listOf(
            simulation(premise = ""), simulation(premise = "  "), simulation(premise = "가".repeat(501)), simulation(premise = "전제" + Char(0)),
            simulation(beats = List(6) { "비트" }), simulation(beats = listOf("")), simulation(beats = listOf("  ")), simulation(beats = listOf("가".repeat(201))),
            simulation(body = "가".repeat(2001)), simulation(title = ""), simulation(title = "가".repeat(101)),
        )) {
            assertEquals(422, status { cleanProposal(bad) }, bad.toString().take(60))
        }
    }

    @Test fun `a simulation proposal without a comment shows its premise as the body`() {
        assertEquals("두 사람이 폐교에서 마주친다", cleanProposal(simulation()).body)
        assertEquals("제 글은 이래요", cleanProposal(simulation(body = " 제 글은 이래요 ")).body)
        assertEquals(listOf("문이 열린다"), cleanProposal(simulation(beats = listOf(" 문이 열린다 "))).beats)
        assertEquals("폐교 장면", cleanProposal(simulation(title = " 폐교 장면 ")).title)
    }

    // ---- AI에 보낼 문맥

    private val mapper = JsonMapper.builder().build()
    private fun episode(number: Int, body: String) = SerialEpisode(number, "제 ${number}화", body)
    private fun card(i: Int, text: String = "설명") = SerialCard("카드 $i", "character", text, listOf("별칭 $i"))

    @Test fun `a small context keeps every field and the three latest episodes in order`() {
        val json = serialContext(mapper, "작품", "소개", (1..5).map { episode(it, "본문 $it") }, listOf(card(1), card(2)))

        val tree = mapper.readTree(json)
        assertEquals("작품", tree.path("title").asString())
        assertEquals("소개", tree.path("summary").asString())
        assertEquals(listOf(3, 4, 5), tree.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(listOf("본문 3", "본문 4", "본문 5"), tree.path("episodes").values().map { it.path("body").asString() })
        assertEquals(listOf("카드 1", "카드 2"), tree.path("cards").values().map { it.path("title").asString() })
        assertEquals("character", tree.path("cards")[0].path("type").asString())
        assertEquals("별칭 1", tree.path("cards")[0].path("aliases")[0].asString())
    }

    @Test fun `a context never exceeds sixty thousand characters even with escaping`() {
        // 줄바꿈과 따옴표는 JSON에서 두 글자가 되므로 글자 수로만 자르면 한도를 넘는다.
        val heavy = "\"줄\n".repeat(13_000)
        val json = serialContext(mapper, "작품", "소개", (1..3).map { episode(it, heavy) }, (1..40).map { card(it, "카드 본문 ".repeat(300)) })

        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT, "length=" + json.length)
        val tree = mapper.readTree(json)
        // 가장 최근 회차가 먼저 채워지고 더 오래된 회차가 줄어든다. 본문은 앞부분이다.
        val bodies = tree.path("episodes").values().map { it.path("body").asString() }
        assertTrue(bodies.last().length >= bodies.first().length)
        assertTrue(bodies.last().startsWith("\"줄\n"))
        assertTrue(bodies.isNotEmpty())
    }

    @Test fun `a context with more cards than fit keeps the first cards and still fits`() {
        val json = serialContext(mapper, "작품", "소개", listOf(episode(1, "본문")), (1..200).map { card(it, "가".repeat(3000)) })

        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT)
        val cards = mapper.readTree(json).path("cards").values().map { it.path("title").asString() }
        assertTrue(cards.isNotEmpty() && cards.size < 200)
        assertEquals((1..cards.size).map { "카드 $it" }, cards)
        assertEquals("본문", mapper.readTree(json).path("episodes")[0].path("body").asString())
    }

    @Test fun `no episodes and no cards still make a valid context`() {
        val tree = mapper.readTree(serialContext(mapper, "작품", "", emptyList(), emptyList()))

        assertEquals(0, tree.path("episodes").size())
        assertEquals(0, tree.path("cards").size())
    }

    @Test fun `a truncated body does not end in half a surrogate pair`() {
        val emoji = "😀"
        val json = serialContext(mapper, "작품", "소개", listOf(episode(1, emoji.repeat(40_000))), emptyList())

        val body = mapper.readTree(json).path("episodes")[0].path("body").asString()
        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT)
        assertFalse(body.last().isHighSurrogate())
        assertTrue(body.isNotEmpty())
    }

    // ---- 이전 회차 요약·관련 장면

    private fun summary(number: Int, text: String = "요약 $number") = SerialSummary(number, "제 ${number}화", text)
    private fun summaryNumbers(json: String) = mapper.readTree(json).path("summaries").values().map { it.path("number").asInt() }

    @Test fun `summaries cover only the episodes before the three recent ones and come oldest first`() {
        val episodes = (1..6).map { episode(it, "본문 $it") }

        // 요약은 어떤 순서로 넘어와도 번호순으로 싣고, 최근 3화(4·5·6)는 원문이 있으므로 요약을 싣지 않는다.
        val json = serialContext(mapper, "작품", "소개", episodes, emptyList(), (1..6).reversed().map { summary(it) })

        val tree = mapper.readTree(json)
        assertEquals(listOf(4, 5, 6), tree.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(listOf(1, 2, 3), summaryNumbers(json))
        assertEquals(listOf("number", "summary", "title"), tree.path("summaries")[0].propertyNames().toList().sorted())
        assertEquals(listOf("제 1화", "요약 1"), listOf(tree.path("summaries")[0].path("title").asString(), tree.path("summaries")[0].path("summary").asString()))
    }

    @Test fun `an episode without a summary is just absent and no summaries at all is an empty list`() {
        val episodes = (1..5).map { episode(it, "본문") }

        assertEquals(listOf(1), summaryNumbers(serialContext(mapper, "작품", "소개", episodes, emptyList(), listOf(summary(1)))))
        val none = mapper.readTree(serialContext(mapper, "작품", "소개", episodes, emptyList()))
        assertTrue(none.has("summaries"))
        assertEquals(0, none.path("summaries").size())
    }

    @Test fun `with three or fewer episodes there is nothing older to summarize`() {
        val json = serialContext(mapper, "작품", "소개", (1..3).map { episode(it, "본문") }, emptyList(), (1..3).map { summary(it) })

        assertEquals(emptyList<Int>(), summaryNumbers(json))
    }

    @Test fun `when summaries do not fit the oldest go first and every kept summary is whole`() {
        val episodes = (1..203).map { episode(it, "본문 $it") }
        // 원문 400자지만 줄바꿈·따옴표가 JSON에서 두 글자가 되어 한도를 넘기 쉽다.
        val long = "\"요약\n".repeat(100)

        val json = serialContext(mapper, "작품", "소개", episodes, emptyList(), (1..200).map { summary(it, long) })

        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT, "length=" + json.length)
        val numbers = summaryNumbers(json)
        assertTrue(numbers.isNotEmpty() && numbers.size < 200, "kept=" + numbers.size)
        // 가장 최근 쪽(200)에서부터 이어서 남고 오래된 번호가 빠진다.
        assertEquals((200 - numbers.size + 1..200).toList(), numbers)
        assertTrue(mapper.readTree(json).path("summaries").values().all { it.path("summary").asString() == long })
    }

    @Test fun `recent episode bodies outrank summaries when the context is full`() {
        val heavy = "가".repeat(30_000)

        val json = serialContext(mapper, "작품", "소개", (1..5).map { episode(it, heavy) }, emptyList(), listOf(summary(1), summary(2)))

        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT)
        assertEquals(emptyList<Int>(), summaryNumbers(json))
        assertTrue(mapper.readTree(json).path("episodes").size() > 0)
    }

    @Test fun `related quotes are added only when given and keep their order`() {
        val episodes = (1..5).map { episode(it, "본문") }
        assertFalse(mapper.readTree(serialContext(mapper, "작품", "소개", episodes, emptyList())).has("related"))

        val tree = mapper.readTree(serialContext(mapper, "작품", "소개", episodes, emptyList(), emptyList(), listOf(SerialRelated(2, "옛 장면 하나"), SerialRelated(1, "옛 장면 둘"))))

        assertEquals(listOf(2, 1), tree.path("related").values().map { it.path("episode").asInt() })
        assertEquals(listOf("옛 장면 하나", "옛 장면 둘"), tree.path("related").values().map { it.path("quote").asString() })
        assertEquals(listOf("episode", "quote"), tree.path("related")[0].propertyNames().toList().sorted())
        // 검색을 했지만 찾은 것이 없으면 빈 목록이다(실패가 아니다).
        val empty = mapper.readTree(serialContext(mapper, "작품", "소개", episodes, emptyList(), emptyList(), emptyList()))
        assertTrue(empty.has("related"))
        assertEquals(0, empty.path("related").size())
    }

    @Test fun `related quotes keep their place and the context still fits when bodies and cards are huge`() {
        val heavy = "가".repeat(30_000)
        val related = (1..6).map { SerialRelated(it, "인용 $it " + "나".repeat(240)) }

        val json = serialContext(mapper, "작품", "소개", (1..9).map { episode(it, heavy) }, (1..40).map { card(it, "카드 본문 ".repeat(300)) }, emptyList(), related)

        assertTrue(json.length <= SERIAL_CONTEXT_LIMIT, "length=" + json.length)
        assertEquals(related.map { it.quote }, mapper.readTree(json).path("related").values().map { it.path("quote").asString() })
    }

    @Test fun `the related query joins the choice and the proposal titles and drops blanks`() {
        assertEquals("두 사람이 다시 만난다\n폐교 장면\n재회", relatedQuery("두 사람이 다시 만난다", listOf("폐교 장면", "  ", "재회")))
        assertEquals("폐교 장면", relatedQuery(null, listOf(" 폐교 장면 ")))
        assertEquals("선택지만", relatedQuery("선택지만", emptyList()))
        assertNull(relatedQuery(null, emptyList()))
        assertNull(relatedQuery("  ", listOf("")))
    }

    @Test fun `the related query is cut to five hundred characters without splitting a surrogate pair`() {
        val query = relatedQuery("가".repeat(300), listOf("😀".repeat(100), "나".repeat(100)))!!

        assertTrue(query.length <= 500, "length=" + query.length)
        assertFalse(query.last().isHighSurrogate())
        assertTrue(query.startsWith("가".repeat(300) + "\n"))
    }
}
