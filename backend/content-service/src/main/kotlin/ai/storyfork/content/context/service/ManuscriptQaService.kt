package ai.storyfork.content.context.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.*
import ai.storyfork.content.manuscript.client.dto.*
import ai.storyfork.content.manuscript.service.manuscriptHash
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import kotlin.time.measureTimedValue

internal class ManuscriptQaService(
    private val scopes: QaScopeService,
    private val index: ManuscriptElasticsearch,
    private val embeddings: ManuscriptEmbeddingClient,
    private val episodes: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val grants: QaScopeGrants,
) {
    /**
     * AI 오케스트레이션의 Retrieval 도구(`/internal/v1/ai/qa/retrieval`)가 쓰는 검색·재대조 결과.
     * 조회 키는 Content가 서명해 발급한 scopeToken에서만 읽고, 범위·권한은 그 값으로 다시 확정한다. 모델은 호출하지 않는다.
     */
    fun retrieveForAi(request: QaRetrievalRequest): QaRetrievalResponse {
        val grant = grants.read(request.scopeToken) ?: throw ContentFailure(403, "조회 범위를 확인할 수 없어요.")
        val input = QaScopeRequest(grant.episode, grant.episodeVersionId)
        val found = retrieve(grant.workId, grant.owner, request.question.trim(), input, scopes.resolve(grant.workId, grant.owner, input))
        return QaRetrievalResponse(if (found.sources.isEmpty()) "insufficient" else "found", found.sources,
            found.sources.map { QaExcerpt(it.id, it.episode, it.quote) }, found.gaps, found.coverage, found.steps)
    }

    /**
     * 자율 연재 회차 실행의 관련 장면 검색이다(이름이 …ForSerial로 끝나지 않는 이유: 그 이름은 원고 잠금을 건너뛰는 전용 진입점 전용이고 SerialManuscriptLockTest가 사용처를 고정한다): [question]으로 독자 범위(공개 작품의 발행 회차 가운데 [basis]화까지)에서 벡터 검색과 발행 원문 재대조를 한 번 하고 인용을 최대 [limit]개 돌려준다.
     * 독자 범위를 만들 수 없을 때만(비공개·제한 작품은 404, 원작이 삭제된 Fork의 상속 회차처럼 독자에게 가려진 기준 회차는 422) 색인된 것이 없어 검색할 것이 없으므로 빈 목록이다.
     * 범위를 만든 뒤 검색 단계가 실패하면(임베딩의 422 '질문이 너무 김' 포함) 예외다: 호출한 실행이 임의로 빼지 않고 실패로 끝낸다.
     */
    fun searchRelated(workId: String, question: String, basis: QaEpisodeRef, limit: Int): List<QaSource> {
        val input = QaScopeRequest(basis.number, basis.versionId)
        val scope = try {
            scopes.resolve(workId, null, input)
        } catch (error: ContentFailure) {
            if (error.status == 404 || error.status == 422) return emptyList()
            throw error
        }
        return retrieve(workId, null, question, input, scope).sources.take(limit)
    }

    private class Retrieved(val sources: List<QaSource>, val gaps: List<QaGap>, val coverage: QaCoverage,
                            val steps: List<QaRetrievalStep>)

    private fun retrieve(workId: String, owner: String?, question: String, input: QaScopeRequest, scope: QaScope): Retrieved {
        val steps = mutableListOf<QaRetrievalStep>()
        fun <T> step(provider: String, hits: (T) -> Int, block: () -> T): T {
            val (value, took) = measureTimedValue(block)
            steps += QaRetrievalStep(provider, took.inWholeMilliseconds, hits(value))
            return value
        }


        val hits = try {
            val vector = step("embedding", { 1 }) { embeddings.query(question) }
            step("elasticsearch", { it.size }) { index.search(scope, vector) }
        } catch (error: RestClientResponseException) {
            if (error.statusCode.value() == 422) throw ContentFailure(422, "질문을 더 짧게 입력해 주세요.")
            throw ContentFailure(503, "원고 검색을 완료할 수 없어요.")
        } catch (_: RestClientException) {
            throw ContentFailure(503, "원고 검색을 완료할 수 없어요.")
        } catch (_: IllegalStateException) {
            throw ContentFailure(503, "원고 검색 결과를 확인할 수 없어요.")
        }
        checkContent(scopes.resolve(workId, owner, input) == scope, 409, "공개 원고 범위가 변경됐어요. 최신 회차에서 다시 질문해 주세요.")
        val verified = step("postgres_verify", { it.size }) { verify(scope, hits) }
        val covered = verified.map { QaEpisodeRef(it.episode, it.versionId) }.toSet()
        val coverage = QaCoverage(scope.episodes, scope.episodes.filter { it in covered }, scope.episodes.filterNot { it in covered })
        val gaps = buildList {
            if (verified.size < hits.size) add(QaGap("UNVERIFIED_HIT", "최신 발행 원문과 일치하지 않는 검색 결과가 있어 제외했어요."))
            if (coverage.withoutVerifiedExcerpt.isNotEmpty()) add(QaGap("LIMITED_COVERAGE", "일부 회차에서는 확인된 검색 근거를 찾지 못했어요."))
            if (verified.isEmpty()) add(QaGap("NO_EVIDENCE", "질문에 답할 수 있는 원고 근거를 확인하지 못했어요."))
        }
        return Retrieved(verified, gaps, coverage, steps)
    }

    private fun verify(scope: QaScope, hits: List<ManuscriptHit>): List<QaSource> {
        val allowed = scope.episodes.associate { it.number to it.versionId }
        val candidates = hits.filter {
            it.id.isNotBlank() && it.workId == scope.workId && it.sourceWorkId == scope.sourceWorkId &&
                it.generation == 1 && allowed[it.episode] == it.versionId
        }
        if (candidates.isEmpty()) return emptyList()
        val episodeIds = candidates.map { it.episodeId }.toSet()
        val current = episodes.findAllByWorkIdOrderBySequence(scope.workId).filter { it.id in episodeIds }.associateBy { it.id }
        val published = versions.findAllById(current.values.mapNotNull { it.publishedVersionId }).associateBy { it.id }
        val hashes = published.mapValues { (_, version) -> manuscriptHash(version.content) }
        return candidates.mapNotNull { hit ->
            val row = current[hit.episodeId] ?: return@mapNotNull null
            val version = published[row.publishedVersionId] ?: return@mapNotNull null
            if (row.workId != scope.workId || row.sequence != hit.episode || version.episodeId != row.id ||
                version.contentVersionId != hit.versionId || hashes[version.id] != hit.sourceHash) return@mapNotNull null
            val body = version.content
            if (hit.start < 0 || hit.end <= hit.start || hit.end > body.length || hit.end - hit.start > 256 ||
                body.splitsSurrogate(hit.start) || body.splitsSurrogate(hit.end)) return@mapNotNull null
            val quote = body.substring(hit.start, hit.end)
            if (quote.isBlank()) return@mapNotNull null
            QaSource(hit.id, scope.workId, scope.sourceWorkId, row.id, row.sequence, version.contentVersionId, hit.start, hit.end, quote)
        }
    }

    private fun String.splitsSurrogate(offset: Int) =
        offset in 1 until length && Character.isSurrogatePair(this[offset - 1], this[offset])
}
