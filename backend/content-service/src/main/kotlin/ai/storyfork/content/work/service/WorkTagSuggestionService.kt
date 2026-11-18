package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.client.WorkTagSuggestionCallFailure
import ai.storyfork.content.work.client.WorkTagSuggestionClient
import ai.storyfork.content.work.client.dto.WorkTagEpisode
import ai.storyfork.content.work.client.dto.WorkTagSuggestionInput
import ai.storyfork.content.work.domain.MAX_WORK_GENRES
import ai.storyfork.content.work.domain.MAX_WORK_HASHTAGS
import ai.storyfork.content.work.domain.WORK_GENRES
import ai.storyfork.content.work.domain.validateWorkGenres
import ai.storyfork.content.work.domain.validateWorkHashtags
import ai.storyfork.content.work.service.dto.WorkTagSuggestionResponse
import org.springframework.stereotype.Service

/**
 * 작가 본인 작품의 장르·키워드 후보를 AI 서비스에 받아 그대로 돌려준다(#372). 결과를 저장하지 않고 작품 revision도 바꾸지 않는다.
 * AI 호출 동안 DB 트랜잭션을 열어 두지 않도록 클래스에 트랜잭션을 걸지 않는다.
 */
@Service
class WorkTagSuggestionService(
    private val access: WorkAccessService,
    private val publications: PublicationService,
    private val client: WorkTagSuggestionClient,
) {
    fun suggest(id: String, owner: String): WorkTagSuggestionResponse {
        // 후보만 만들고 작품을 바꾸지 않으므로 own()처럼 작품 행에 쓰기 잠금을 걸지 않고 읽기만 한다.
        checkContent(owner.isNotBlank() && owner.length <= 200, 401, "서버 인증이 필요합니다.")
        val work = access.get(id).also { checkContent(it.ownerId == owner && !it.deleted, 404, "작품을 찾을 수 없어요.") }
        // Fork가 이어받은 원작 회차는 작가 본인 원고가 아니라 빼고, 앞에서부터 최대 3개만 보낸다.
        val episodes = publications.publishedEpisodes(id).items.filter { !it.inherited && it.body.isNotBlank() }.take(MAX_EPISODES)
        checkContent(episodes.isNotEmpty(), 409, "발행한 회차가 있어야 장르·키워드를 추천할 수 있어요.")
        val input = WorkTagSuggestionInput("work-tags.v1", work.title, work.summary,
            episodes.map { WorkTagEpisode(it.number, it.title, head(it.body)) },
            WORK_GENRES, MAX_WORK_GENRES, MAX_WORK_HASHTAGS)
        val output = try { client.suggest(input) } catch (e: WorkTagSuggestionCallFailure) { throw failure(e.code) }
        // AI 서비스가 검증한 결과지만 Content 규칙(작품 등록·수정과 같은 검증)을 벗어나면 일부만 고치지 않고 실패로 알린다.
        val hashtags = try {
            validateWorkGenres(output.genres)
            validateWorkHashtags(output.hashtags)
        } catch (e: ContentFailure) { throw failure("AI_OUTPUT_INVALID") }
        if (hashtags != output.hashtags || hashtags.toSet().size != hashtags.size || hashtags.any { it in WORK_GENRES })
            throw failure("AI_OUTPUT_INVALID")
        return WorkTagSuggestionResponse(output.genres, output.hashtags)
    }

    /** AI 서비스가 글자 수를 코드 포인트로 세므로 이모지 같은 서로게이트 쌍을 자르지 않고 앞부분만 보낸다. */
    private fun head(body: String) =
        if (body.codePointCount(0, body.length) <= MAX_EPISODE_CHARS) body else body.substring(0, body.offsetByCodePoints(0, MAX_EPISODE_CHARS))

    private fun failure(code: String) = when (code) {
        "AI_TIMEOUT" -> ContentFailure(504, "추천이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요.", code)
        "AI_REQUEST_REJECTED" -> ContentFailure(502, "추천 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.", code)
        "AI_OUTPUT_INVALID" -> ContentFailure(502, "추천 결과를 확인하지 못했어요. 다시 시도해 주세요.", code)
        else -> ContentFailure(503, "지금은 장르·키워드를 추천할 수 없어요. 잠시 뒤 다시 시도해 주세요.", code)
    }

    companion object {
        const val MAX_EPISODES = 3
        const val MAX_EPISODE_CHARS = 8000
    }
}
