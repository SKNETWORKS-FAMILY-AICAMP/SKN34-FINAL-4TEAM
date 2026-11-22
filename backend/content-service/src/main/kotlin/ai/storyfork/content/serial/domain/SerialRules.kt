package ai.storyfork.content.serial.domain

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.service.dto.SerialOpinionRequest
import ai.storyfork.content.serial.service.dto.SerialSettingsRequest
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import tools.jackson.databind.json.JsonMapper

/** 일정은 한국 시간(KST)이다. */
val KST: ZoneId = ZoneId.of("Asia/Seoul")

/** AI에 보내는 context(JSON 문자열)의 글자 수 한도다. AI 서비스가 이 값을 넘는 요청을 거절한다. */
const val SERIAL_CONTEXT_LIMIT = 60_000

/** 게시판 실행에 쓰는 득표 상위 의견 수와 running이 이만큼 지나면 낡은 것으로 보는 시간(분)이다. */
const val TOP_OPINIONS = 3
const val STALE_RUNNING_MINUTES = 30L

/** 실행이 실패한 게시판에 남기는 고정 사유다. 원문·예외 메시지를 싣지 않는다. */
object SerialReason {
    const val CREDIT = "크레딧이 부족합니다."
    const val REVIEW = "검수를 통과하지 못했습니다."
    const val AI = "AI 생성에 실패했습니다."
    const val PUBLISH = "발행에 실패했습니다."
}

private val DAY_CODES = DayOfWeek.entries.map { it.name.take(3) }
private val TIME = Regex("([01]\\d|2[0-3]):[0-5]\\d")
private val NUL = Char(0)

private fun clean(text: String) = text.none { it == NUL }

// ---- 설정

data class CleanSettings(val enabled: Boolean, val days: String, val runTime: LocalTime, val direction: String)

/** 설정 요청을 검증해 저장 형태로 바꾼다. 어긋나면 422다. */
fun cleanSettings(request: SerialSettingsRequest): CleanSettings {
    val direction = request.direction.trim()
    checkContent(direction.length <= 2000 && clean(direction), message = "연재 방향은 2,000자 이내로 입력해 주세요.")
    return CleanSettings(request.enabled, serialDays(request.days, request.enabled), serialTime(request.time), direction)
}

/** 요일 코드(MON~SUN)를 중복 없이 검증해 월요일부터의 순서로 'MON,WED'처럼 저장한다. 켜는 저장은 하나 이상이 필요하고 끄는 저장은 비어도 된다. */
fun serialDays(codes: List<String>, enabled: Boolean): String {
    checkContent(codes.all { it in DAY_CODES } && codes.distinct().size == codes.size, message = "요일은 MON~SUN 중에서 중복 없이 골라 주세요.")
    checkContent(!enabled || codes.isNotEmpty(), message = "연재 요일을 하나 이상 골라 주세요.")
    return DAY_CODES.filter { it in codes }.joinToString(",")
}

fun serialDaySet(days: String): Set<DayOfWeek> = days.split(',').filter { it.isNotEmpty() }.mapNotNull { code -> DayOfWeek.entries.firstOrNull { it.name.take(3) == code } }.toSet()

fun serialTime(text: String): LocalTime {
    checkContent(TIME.matches(text), message = "시각은 HH:mm(24시간)으로 보내 주세요.")
    return LocalTime.parse(text)
}

/**
 * 일정이 도래했는가: 오늘(KST)이 고른 요일이고, 정한 시각부터 1시간 안이며, 오늘 아직 실행하지 않았다. 1시간을 넘긴 일정은 건너뛴다.
 * ponytail: 자정을 넘는 창(23:30 일정의 00:10)은 그날이 고른 요일이 아니면 건너뛴다. 필요해지면 어제 날짜 기준 창도 본다.
 */
fun isSerialDue(days: String, runTime: LocalTime, lastRunDate: LocalDate?, now: ZonedDateTime): Boolean {
    val kst = now.withZoneSameInstant(KST)
    val today = kst.toLocalDate()
    if (lastRunDate == today || kst.dayOfWeek !in serialDaySet(days)) return false
    val start = today.atTime(runTime).atZone(KST)
    return !kst.isBefore(start) && kst.isBefore(start.plusHours(1))
}

// ---- 의견

/** 득표 수를 붙인 의견이다. */
data class RankedOpinion(val opinion: SerialOpinionEntity, val votes: Int)

/** 숨기지 않은 의견을 득표 많은 순, 같으면 먼저 쓴 순(같은 시각이면 id 순)으로 줄 세운다. */
fun rankOpinions(opinions: List<SerialOpinionEntity>, votes: List<SerialVoteEntity>): List<RankedOpinion> {
    val counts = votes.groupingBy { it.opinionId }.eachCount()
    return opinions.filter { !it.hidden }.map { RankedOpinion(it, counts[it.id] ?: 0) }
        .sortedWith(compareByDescending<RankedOpinion> { it.votes }.thenBy { it.opinion.createdAt }.thenBy { it.opinion.id })
}

/** 회차 실행에 쓰는 득표 상위 의견이다. 표가 없는 의견도 자리가 남으면 들어간다. */
fun topOpinions(opinions: List<SerialOpinionEntity>, votes: List<SerialVoteEntity>, limit: Int = TOP_OPINIONS): List<RankedOpinion> = rankOpinions(opinions, votes).take(limit)

data class CleanOpinion(val kind: String, val body: String, val premise: String?, val beats: List<String>)

/** 의견 제출을 검증해 저장 형태로 바꾼다(앞뒤 공백 제거). 시뮬레이션 의견에 설명이 없으면 전제를 본문으로 보인다. 어긋나면 422다. */
fun cleanOpinion(request: SerialOpinionRequest): CleanOpinion {
    val body = request.body.trim()
    val simulation = request.simulation
    return when (request.kind) {
        "general" -> {
            checkContent(simulation == null, message = "일반 의견에는 시뮬레이션 입력을 보낼 수 없어요.")
            checkContent(body.isNotBlank() && body.length <= 1000 && clean(body), message = "의견은 1~1,000자로 입력해 주세요.")
            CleanOpinion("general", body, null, emptyList())
        }
        "simulation" -> {
            checkContent(simulation != null, message = "시뮬레이션 의견에는 전제와 장면 비트가 필요해요.")
            val premise = simulation!!.premise.trim()
            val beats = simulation.beats.map { it.trim() }
            checkContent(premise.isNotBlank() && premise.length <= 500 && clean(premise), message = "전제는 1~500자로 입력해 주세요.")
            checkContent(beats.size <= 5 && beats.all { it.isNotBlank() && it.length <= 200 && clean(it) }, message = "장면 비트는 200자 이내로 5개까지 입력해 주세요.")
            checkContent(body.length <= 1000 && clean(body), message = "의견은 1,000자 이내로 입력해 주세요.")
            CleanOpinion("simulation", body.ifBlank { premise }, premise, beats)
        }
        else -> throw ContentFailure(422, "의견 유형은 일반(general)·시뮬레이션(simulation) 중 하나로 보내 주세요.")
    }
}

// ---- AI에 보낼 문맥

data class SerialEpisode(val number: Int, val title: String, val body: String)
data class SerialCard(val title: String, val type: String, val text: String, val aliases: List<String>)

private const val CARD_SHARE = 3
private const val RECENT_EPISODES = 3

private fun truncated(text: String, size: Int) = text.take(size).dropLastWhile { it.isHighSurrogate() }
private fun size(card: SerialCard) = card.title.length + card.text.length + card.aliases.sumOf { it.length }

/**
 * AI에 보낼 문맥 JSON 문자열이다(작품 제목·소개, 가장 최근 회차 3개, 설정 카드). 글자 수는 [SERIAL_CONTEXT_LIMIT] 이내이며 줄바꿈·따옴표처럼 JSON에서 길어지는 글자도 센다.
 * 카드는 글자 예산의 1/3까지 앞에서부터 담고, 나머지를 가장 최근 회차부터 채운다: 본문은 앞부분만 남기고 예산이 바닥나면 더 오래된 회차가 줄거나 빠진다.
 * ponytail: 긴 회차는 뒷부분(가장 최근 장면)이 잘린다. 이어 쓰기 품질이 문제면 회차의 끝부분을 남기는 쪽으로 바꾼다.
 */
fun serialContext(mapper: JsonMapper, title: String, summary: String, episodes: List<SerialEpisode>, cards: List<SerialCard>): String {
    var budget = SERIAL_CONTEXT_LIMIT
    while (true) {
        val json = mapper.writeValueAsString(assemble(title, summary, episodes, cards, budget))
        if (json.length <= SERIAL_CONTEXT_LIMIT || budget <= 0) return json
        // JSON이 원문보다 길어진 만큼(이스케이프·키 이름)을 글자 예산에서 덜어 다시 만든다.
        budget -= json.length - SERIAL_CONTEXT_LIMIT + 8
    }
}

private fun assemble(title: String, summary: String, episodes: List<SerialEpisode>, cards: List<SerialCard>, budget: Int): Map<String, Any> {
    val room = maxOf(0, budget - title.length - summary.length)
    var cardRoom = room / CARD_SHARE
    val pickedCards = cards.takeWhile { card -> (size(card) <= cardRoom).also { fits -> if (fits) cardRoom -= size(card) } }
    var left = room - pickedCards.sumOf { size(it) }
    val pickedEpisodes = ArrayDeque<SerialEpisode>()
    for (episode in episodes.takeLast(RECENT_EPISODES).asReversed()) {
        if (left <= 0) break
        val body = truncated(episode.body, left)
        pickedEpisodes.addFirst(episode.copy(body = body))
        left -= body.length
    }
    return mapOf(
        "title" to title,
        "summary" to summary,
        "episodes" to pickedEpisodes.map { mapOf("number" to it.number, "title" to it.title, "body" to it.body) },
        "cards" to pickedCards.map { mapOf("title" to it.title, "type" to it.type, "text" to it.text, "aliases" to it.aliases) },
    )
}
