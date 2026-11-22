package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.serial.domain.*
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.service.dto.SerialOpinionRequest
import ai.storyfork.content.serial.service.dto.SerialSimulationRequest
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper

/** AI 자율 연재의 순수 규칙(일정 도래·상위 의견 선정·입력 검증·문맥 크기)을 DB·HTTP 없이 고정한다. */
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

    // ---- 상위 의견

    private fun opinion(id: String, at: Long, hidden: Boolean = false, kind: String = "general") =
        SerialOpinionEntity(id = id, boardId = "b", authorId = "author-$id", kind = kind, body = "의견 $id", hidden = hidden, createdAt = Instant.ofEpochSecond(at))
    private fun vote(member: String, opinionId: String) = SerialVoteEntity("b", member, opinionId)
    private fun ids(ranked: List<RankedOpinion>) = ranked.map { it.opinion.id }

    @Test fun `the top opinions are ordered by votes and counted`() {
        val opinions = listOf(opinion("a", 1), opinion("b", 2), opinion("c", 3))
        val votes = listOf(vote("m1", "c"), vote("m2", "c"), vote("m3", "b"))

        val top = topOpinions(opinions, votes)

        assertEquals(listOf("c", "b", "a"), ids(top))
        assertEquals(listOf(2, 1, 0), top.map { it.votes })
    }

    @Test fun `equal votes go to the opinion written first and then to the smaller id`() {
        val tie = listOf(opinion("late", 30), opinion("early", 10), opinion("mid", 20))
        assertEquals(listOf("early", "mid", "late"), ids(topOpinions(tie, emptyList())))

        val sameTime = listOf(opinion("z", 5), opinion("a", 5))
        assertEquals(listOf("a", "z"), ids(topOpinions(sameTime, emptyList())))

        // 득표가 많으면 늦게 쓴 의견이 먼저다.
        assertEquals("late", ids(topOpinions(tie, listOf(vote("m1", "late")))).first())
    }

    @Test fun `hidden opinions never count even with the most votes`() {
        val opinions = listOf(opinion("bad", 1, hidden = true), opinion("good", 2), opinion("fine", 3))
        val votes = listOf(vote("m1", "bad"), vote("m2", "bad"), vote("m3", "bad"), vote("m4", "good"))

        assertEquals(listOf("good", "fine"), ids(topOpinions(opinions, votes)))
        assertEquals(listOf("good", "fine"), ids(rankOpinions(opinions, votes)))
    }

    @Test fun `only the top three are chosen and zero-vote opinions fill in when few have votes`() {
        val opinions = (1..5).map { opinion("o$it", it.toLong()) }
        val votes = listOf(vote("m1", "o5"), vote("m2", "o5"), vote("m3", "o4"))

        assertEquals(listOf("o5", "o4", "o1"), ids(topOpinions(opinions, votes)))
        assertEquals(5, rankOpinions(opinions, votes).size)
        assertEquals(emptyList<RankedOpinion>(), topOpinions(emptyList(), emptyList()))
    }

    @Test fun `votes for other opinions or unknown ids do not change the order`() {
        val opinions = listOf(opinion("a", 1), opinion("b", 2))
        val votes = listOf(vote("m1", "elsewhere"), vote("m2", "b"))

        assertEquals(listOf("b", "a"), ids(topOpinions(opinions, votes)))
    }

    // ---- 의견 입력 검증

    private fun general(body: String = "다음에는 두 사람이 만나면 좋겠어요") = SerialOpinionRequest("general", body)
    private fun simulation(premise: String = "두 사람이 폐교에서 마주친다", beats: List<String> = listOf("문이 열린다"), body: String = "") =
        SerialOpinionRequest("simulation", body, SerialSimulationRequest(premise, beats))

    @Test fun `a general opinion keeps trimmed text`() {
        val clean = cleanOpinion(general("  두 사람이 만나면 좋겠어요  "))

        assertEquals(CleanOpinion("general", "두 사람이 만나면 좋겠어요", null, emptyList()), clean)
    }

    @Test fun `a general opinion needs one to one thousand visible characters and no NUL`() {
        assertEquals(1000, cleanOpinion(general("가".repeat(1000))).body.length)
        for (bad in listOf("", "   ", "가".repeat(1001), "본문" + Char(0), Char(0xA0).toString())) {
            assertEquals(422, status { cleanOpinion(general(bad)) }, bad.take(20))
        }
    }

    @Test fun `an unknown kind or a kind with the wrong block is rejected`() {
        assertEquals(422, status { cleanOpinion(SerialOpinionRequest("setting", "x")) })
        assertEquals(422, status { cleanOpinion(SerialOpinionRequest("", "x")) })
        assertEquals(422, status { cleanOpinion(SerialOpinionRequest("GENERAL", "x")) })
        // 일반 의견에 시뮬레이션 입력을 섞지 않는다. 시뮬레이션 의견에는 시뮬레이션 입력이 있어야 한다.
        assertEquals(422, status { cleanOpinion(SerialOpinionRequest("general", "x", SerialSimulationRequest("전제", emptyList()))) })
        assertEquals(422, status { cleanOpinion(SerialOpinionRequest("simulation", "x")) })
    }

    @Test fun `a simulation opinion takes a premise up to 500 and up to five beats of 200`() {
        val limit = simulation("가".repeat(500), List(5) { "나".repeat(200) })
        val clean = cleanOpinion(limit)

        assertEquals(500, clean.premise!!.length)
        assertEquals(List(5) { "나".repeat(200) }, clean.beats)
        assertEquals(emptyList<String>(), cleanOpinion(simulation(beats = emptyList())).beats)
    }

    @Test fun `bad simulation input is rejected`() {
        for (bad in listOf(
            simulation(premise = ""), simulation(premise = "  "), simulation(premise = "가".repeat(501)), simulation(premise = "전제" + Char(0)),
            simulation(beats = List(6) { "비트" }), simulation(beats = listOf("")), simulation(beats = listOf("  ")), simulation(beats = listOf("가".repeat(201))),
            simulation(body = "가".repeat(1001)),
        )) {
            assertEquals(422, status { cleanOpinion(bad) }, bad.toString().take(60))
        }
    }

    @Test fun `a simulation opinion without a comment shows its premise as the body`() {
        assertEquals("두 사람이 폐교에서 마주친다", cleanOpinion(simulation()).body)
        assertEquals("제 의견은 이래요", cleanOpinion(simulation(body = " 제 의견은 이래요 ")).body)
        assertEquals(listOf("문이 열린다"), cleanOpinion(simulation(beats = listOf(" 문이 열린다 "))).beats)
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
}
