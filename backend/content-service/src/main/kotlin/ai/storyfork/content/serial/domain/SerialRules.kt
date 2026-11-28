package ai.storyfork.content.serial.domain

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.serial.entity.SerialChoiceEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.entity.SerialProposalLikeEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.service.dto.SerialProposalRequest
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

/** 게시판 실행에 쓰는 추천 상위 제안 글 수다. */
const val TOP_PROPOSALS = 3

/**
 * 회차 실행의 AI 읽기 한도(분)와, running이 이만큼 지나면 낡은 것으로 보는 시간(분)이다. 회차 실행은 인물 시뮬레이션을 거쳐 AI 최악이 1,810초(약 30분)라 읽기 한도는 35분이고(계약 '회차 집필은 반드시 인물 시뮬레이션으로'),
 * 정체 정리 기준은 읽기 한도(와 AI 호출 앞뒤의 짧은 일)보다 길어야 정상 실행을 정리 점검이 먼저 실패로 닫지 않으므로 45분이다. 둘의 관계는 SerialRulesTest가 고정한다.
 */
const val EPISODE_READ_TIMEOUT_MINUTES = 35L
const val STALE_RUNNING_MINUTES = 45L

/** 선택지(AI가 게시판마다 4개, 각 300자 이내)와 선택지 생성이 실패했을 때 다시 시도하기까지의 시간(분), 제안 글의 제목·본문 한도(글자 수)다. */
const val CHOICE_COUNT = 4
const val CHOICE_MAX = 300
const val CHOICES_RETRY_MINUTES = 10L
const val PROPOSAL_TITLE_MAX = 100
const val PROPOSAL_BODY_MAX = 2000

/** 회차 요약(AI가 회차마다 300자 안팎)의 글자 수 한도, 점검 한 번에 만드는 요약 수, 회차 실행에 붙이는 관련 장면 인용의 최대 수와 그 검색 질의의 글자 수 한도다. */
const val SUMMARY_MAX = 400
const val SUMMARIES_PER_TICK = 3
const val RELATED_MAX = 6
const val RELATED_QUERY_MAX = 500

/** 회차 실행 실패 사유 한 줄의 글자 수 한도다(AI가 설명한 시뮬레이션 실패 문구를 사유로 남길 때 자른다). */
const val REASON_MAX = 300

/**
 * 실행이 실패한 게시판에 남기는 사유의 고정 문구다. 원문·예외 메시지를 싣지 않는다.
 * 인물 시뮬레이션이 막거나 끝내지 못한 실패(AI 409·422·502·504)만 예외로, AI가 설명한 문구를 [cleanReason]으로 다듬어 그대로 남긴다.
 */
object SerialReason {
    const val CREDIT = "크레딧이 부족합니다."
    const val LIMIT = "크레딧 상한을 넘었습니다."
    const val REVIEW = "검수를 통과하지 못했습니다."
    const val AI = "AI 생성에 실패했습니다."
    const val PUBLISH = "발행에 실패했습니다."
    const val DRAFT = "작성 중인 원고가 있어 발행하지 않았습니다."
    const val SEARCH = "관련 장면 검색에 실패했습니다."
    const val NO_WORLD = "연결된 세계관이 없어 시뮬레이션으로 집필할 수 없습니다."
}

/** AI 집필이 켜져 있는 동안 소유자가 원고를 바꾸려 하면 409로 거절하는 코드와 고정 문구다(서버 판정, 화면 잠금은 보조). */
const val SERIAL_LOCKED = "SERIAL_LOCKED"
const val SERIAL_LOCKED_MESSAGE = "AI 자율 집필 중에는 1화만 직접 쓸 수 있어요. 운영 설정 > 집필 방식을 바꾸면 모든 회차를 쓸 수 있어요."

private val DAY_CODES = DayOfWeek.entries.map { it.name.take(3) }
private val TIME = Regex("([01]\\d|2[0-3]):[0-5]\\d")
private val NUL = Char(0)

private fun clean(text: String) = text.none { it == NUL }

// ---- 설정

data class CleanSettings(val days: String, val runTime: LocalTime, val direction: String)

/** 설정 요청을 검증해 저장 형태로 바꾼다. 어긋나면 422다. */
fun cleanSettings(request: SerialSettingsRequest): CleanSettings {
    val direction = request.direction.trim()
    checkContent(direction.length <= 2000 && clean(direction), message = "연재 방향은 2,000자 이내로 입력해 주세요.")
    return CleanSettings(serialDays(request.days), serialTime(request.time), direction)
}

/** 요일 코드(MON~SUN)를 중복 없이 검증해 월요일부터의 순서로 'MON,WED'처럼 저장한다. 일정을 저장할 때는 하나 이상이 필요하다(켜기·끄기는 집필 방식이 한다). */
fun serialDays(codes: List<String>): String {
    checkContent(codes.all { it in DAY_CODES } && codes.distinct().size == codes.size, message = "요일은 MON~SUN 중에서 중복 없이 골라 주세요.")
    checkContent(codes.isNotEmpty(), message = "연재 요일을 하나 이상 골라 주세요.")
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

// ---- 선택지

/** 득표 수를 붙인 선택지다. */
data class RankedChoice(val choice: SerialChoiceEntity, val votes: Int)

/** 선택지를 번호순(화면 순서)으로 득표 수와 함께 돌려준다. 득표가 많아도 자리를 옮기지 않는다. */
fun rankChoices(choices: List<SerialChoiceEntity>, votes: List<SerialVoteEntity>): List<RankedChoice> {
    val counts = votes.groupingBy { it.choiceId }.eachCount()
    return choices.sortedBy { it.position }.map { RankedChoice(it, counts[it.id] ?: 0) }
}

/** 이번 회차의 중심 전개가 될 1위 선택지다: 득표가 가장 많은 것, 같으면 앞 번호(표가 없으면 1번). 선택지가 없으면 null이다. */
fun topChoice(choices: List<SerialChoiceEntity>, votes: List<SerialVoteEntity>): RankedChoice? =
    rankChoices(choices, votes).minWithOrNull(compareByDescending<RankedChoice> { it.votes }.thenBy { it.choice.position })

/** AI가 만든 선택지 글을 검증한다: 정확히 [CHOICE_COUNT]개이고 각각 앞뒤 공백을 뗀 뒤 1~[CHOICE_MAX]자에 NUL이 없어야 한다. 어긋나면 null이다. */
fun cleanChoices(texts: List<String>): List<String>? {
    val trimmed = texts.map { it.trim() }
    return trimmed.takeIf { it.size == CHOICE_COUNT && it.all { text -> text.isNotEmpty() && text.length <= CHOICE_MAX && clean(text) } }
}

/** AI가 만든 회차 요약을 검증한다: 앞뒤 공백을 뗀 뒤 1~[SUMMARY_MAX]자에 NUL이 없어야 한다. 어긋나면 null이다(줄여 쓰지 않는다). */
fun cleanSummary(text: String): String? = text.trim().takeIf { it.isNotEmpty() && it.length <= SUMMARY_MAX && clean(it) }

private val REASON_SPACES = Regex("[\\p{Z}\\s\\p{Cc}]+")

/**
 * AI가 설명한 시뮬레이션 실패 문구를 게시판 실패 사유로 다듬는다: 공백·줄바꿈·제어 문자(NUL 포함)를 빈칸 한 칸으로 줄여 앞뒤를 떼고 [REASON_MAX]자까지만 남긴다(서로게이트 쌍을 가르지 않는다).
 * 남는 글이 없으면 null이다.
 */
fun cleanReason(text: String): String? = truncated(text.replace(REASON_SPACES, " ").trim(), REASON_MAX).trimEnd().ifEmpty { null }

// ---- 제안 글

/** 추천 수를 붙인 제안 글이다. */
data class RankedProposal(val proposal: SerialProposalEntity, val likes: Int)

/** 숨기지 않은 글을 추천 많은 순, 같으면 먼저 쓴 순(같은 시각이면 id 순)으로 줄 세운다. */
fun rankProposals(proposals: List<SerialProposalEntity>, likes: List<SerialProposalLikeEntity>): List<RankedProposal> {
    val counts = likes.groupingBy { it.proposalId }.eachCount()
    return proposals.filter { !it.hidden }.map { RankedProposal(it, counts[it.id] ?: 0) }
        .sortedWith(compareByDescending<RankedProposal> { it.likes }.thenBy { it.proposal.createdAt }.thenBy { it.proposal.id })
}

/** 회차 실행에 쓰는 추천 상위 제안 글이다. 추천이 없는 글도 자리가 남으면 들어간다. */
fun topProposals(proposals: List<SerialProposalEntity>, likes: List<SerialProposalLikeEntity>, limit: Int = TOP_PROPOSALS): List<RankedProposal> = rankProposals(proposals, likes).take(limit)

data class CleanProposal(val kind: String, val title: String, val body: String, val premise: String?, val beats: List<String>)

/** 제안 글을 검증해 저장 형태로 바꾼다(앞뒤 공백 제거). 시뮬레이션 글에 설명이 없으면 전제를 본문으로 보인다. 어긋나면 422다. */
fun cleanProposal(request: SerialProposalRequest): CleanProposal {
    val title = request.title.trim()
    val body = request.body.trim()
    val simulation = request.simulation
    checkContent(title.isNotBlank() && title.length <= PROPOSAL_TITLE_MAX && clean(title), message = "제목은 1~100자로 입력해 주세요.")
    return when (request.kind) {
        "general" -> {
            checkContent(simulation == null, message = "일반 글에는 시뮬레이션 입력을 보낼 수 없어요.")
            checkContent(body.isNotBlank() && body.length <= PROPOSAL_BODY_MAX && clean(body), message = "본문은 1~2,000자로 입력해 주세요.")
            CleanProposal("general", title, body, null, emptyList())
        }
        "simulation" -> {
            checkContent(simulation != null, message = "시뮬레이션 글에는 전제와 장면 비트가 필요해요.")
            val premise = simulation!!.premise.trim()
            val beats = simulation.beats.map { it.trim() }
            checkContent(premise.isNotBlank() && premise.length <= 500 && clean(premise), message = "전제는 1~500자로 입력해 주세요.")
            checkContent(beats.size <= 5 && beats.all { it.isNotBlank() && it.length <= 200 && clean(it) }, message = "장면 비트는 200자 이내로 5개까지 입력해 주세요.")
            checkContent(body.length <= PROPOSAL_BODY_MAX && clean(body), message = "본문은 2,000자 이내로 입력해 주세요.")
            CleanProposal("simulation", title, body.ifBlank { premise }, premise, beats)
        }
        else -> throw ContentFailure(422, "글 유형은 일반(general)·시뮬레이션(simulation) 중 하나로 보내 주세요.")
    }
}

// ---- AI에 보낼 문맥

data class SerialEpisode(val number: Int, val title: String, val body: String)
data class SerialCard(val title: String, val type: String, val text: String, val aliases: List<String>)

/** 이전 회차 한 편의 요약이다(AI가 만들어 Content가 저장한 것). */
data class SerialSummary(val number: Int, val title: String, val summary: String)

/** 회차 실행에 붙이는 관련 장면 인용이다: 최근 3화 이전 회차에서 원고 검색이 찾아 발행 원문과 다시 대조한 구절. */
data class SerialRelated(val episode: Int, val quote: String)

private const val CARD_SHARE = 3

/** 문맥에 원문을 싣는 가장 최근 회차 수다. 이보다 오래된 회차는 요약과 관련 장면 검색으로만 닿는다. */
const val RECENT_EPISODES = 3

private fun truncated(text: String, size: Int) = text.take(size).dropLastWhile { it.isHighSurrogate() }
private fun size(card: SerialCard) = card.title.length + card.text.length + card.aliases.sumOf { it.length }

/**
 * 관련 장면 검색의 질의: 1위 선택지 글과 추천 상위 제안 글의 제목을 줄바꿈으로 이은 것이다(공백뿐인 것은 뺀다, [RELATED_QUERY_MAX]자까지).
 * 질의할 것이 없으면(선택지도 제안 글도 없음) null이다.
 */
fun relatedQuery(choice: String?, titles: List<String>): String? =
    truncated((listOfNotNull(choice) + titles).map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n"), RELATED_QUERY_MAX).trimEnd().ifEmpty { null }

/**
 * AI에 보낼 문맥 JSON 문자열이다(작품 제목·소개, 가장 최근 회차 3개, 그 이전 회차의 요약, 설정 카드, 회차 실행이면 관련 장면 인용). 글자 수는 [SERIAL_CONTEXT_LIMIT] 이내이며 줄바꿈·따옴표처럼 JSON에서 길어지는 글자도 센다.
 * 제목·소개와 관련 장면 인용(최대 6개)은 늘 싣는다. 카드는 글자 예산의 1/3까지 앞에서부터 담고, 그다음 가장 최근 회차부터 원문을 채운다: 본문은 앞부분만 남기고 예산이 바닥나면 더 오래된 회차가 줄거나 빠진다.
 * 요약은 그 뒤 남은 글자만큼 [RECENT_EPISODES]화 이전 회차의 것을 가장 최근 쪽부터 통째로 담고(번호순으로 싣는다) 넘치면 오래된 요약부터 빠진다. 요약이 없는 회차는 그냥 빠진다.
 * [related]가 null이면 related 키를 싣지 않고(선택지·시뮬레이션), 빈 목록이면 검색했지만 찾은 것이 없다는 뜻이다.
 * ponytail: 긴 회차는 뒷부분(가장 최근 장면)이 잘린다. 이어 쓰기 품질이 문제면 회차의 끝부분을 남기는 쪽으로 바꾼다.
 */
fun serialContext(
    mapper: JsonMapper, title: String, summary: String, episodes: List<SerialEpisode>, cards: List<SerialCard>,
    summaries: List<SerialSummary> = emptyList(), related: List<SerialRelated>? = null,
): String {
    var budget = SERIAL_CONTEXT_LIMIT
    while (true) {
        val json = mapper.writeValueAsString(assemble(title, summary, episodes, cards, summaries, related, budget))
        if (json.length <= SERIAL_CONTEXT_LIMIT || budget <= 0) return json
        // JSON이 원문보다 길어진 만큼(이스케이프·키 이름)을 글자 예산에서 덜어 다시 만든다.
        budget -= json.length - SERIAL_CONTEXT_LIMIT + 8
    }
}

private fun assemble(
    title: String, summary: String, episodes: List<SerialEpisode>, cards: List<SerialCard>, summaries: List<SerialSummary>, related: List<SerialRelated>?, budget: Int,
): Map<String, Any> {
    val room = maxOf(0, budget - title.length - summary.length - (related?.sumOf { it.quote.length } ?: 0))
    var cardRoom = room / CARD_SHARE
    val pickedCards = cards.takeWhile { card -> (size(card) <= cardRoom).also { fits -> if (fits) cardRoom -= size(card) } }
    var left = room - pickedCards.sumOf { size(it) }
    val recent = episodes.takeLast(RECENT_EPISODES)
    val pickedEpisodes = ArrayDeque<SerialEpisode>()
    for (episode in recent.asReversed()) {
        if (left <= 0) break
        val body = truncated(episode.body, left)
        pickedEpisodes.addFirst(episode.copy(body = body))
        left -= body.length
    }
    val firstRecent = recent.firstOrNull()?.number ?: Int.MAX_VALUE
    val pickedSummaries = ArrayDeque<SerialSummary>()
    for (item in summaries.filter { it.number < firstRecent }.sortedBy { it.number }.asReversed()) {
        val cost = item.title.length + item.summary.length
        if (cost > left) break
        pickedSummaries.addFirst(item)
        left -= cost
    }
    return buildMap {
        put("title", title)
        put("summary", summary)
        put("episodes", pickedEpisodes.map { mapOf("number" to it.number, "title" to it.title, "body" to it.body) })
        put("summaries", pickedSummaries.map { mapOf("number" to it.number, "title" to it.title, "summary" to it.summary) })
        put("cards", pickedCards.map { mapOf("title" to it.title, "type" to it.type, "text" to it.text, "aliases" to it.aliases) })
        related?.let { found -> put("related", found.map { mapOf("episode" to it.episode, "quote" to it.quote) }) }
    }
}
