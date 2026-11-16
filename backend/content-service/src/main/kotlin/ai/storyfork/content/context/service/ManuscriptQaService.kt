package ai.storyfork.content.context.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.context.domain.sourceExcerpts
import ai.storyfork.content.context.service.dto.*
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.manuscript.client.*
import ai.storyfork.content.manuscript.client.dto.*
import ai.storyfork.content.manuscript.service.manuscriptHash
import ai.storyfork.content.world.service.WorldService
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import kotlin.time.measureTimedValue

internal class ManuscriptQaService(
    private val scopes: QaScopeService,
    private val index: ManuscriptElasticsearch,
    private val embeddings: ManuscriptEmbeddingClient,
    private val episodes: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val answers: ManuscriptQaClient,
    private val worlds: WorldService,
    private val grants: QaScopeGrants,
) {
    fun ask(workId: String, owner: String?, request: ManuscriptQaRequest): ManuscriptQaResponse {
        checkContent(request.consent, message="OpenAI 전송과 API 비용에 동의해 주세요.")
        val question = request.question.trim()
        val found = retrieve(workId, owner, question, request.target, request.episode, request.episodeVersionId)
        if (found.sources.isEmpty()) return ManuscriptQaResponse("insufficient", emptyList(), emptyList(), found.gaps, found.coverage)
        return answer(question, found.sources, found.gaps, found.coverage, found.recheck)
    }

    /**
     * AI 오케스트레이션의 Retrieval 도구(`/internal/v1/ai/qa/retrieval`)가 쓰는 검색·재대조 결과.
     * 조회 키는 Content가 서명해 발급한 scopeToken에서만 읽고, 범위·권한은 그 값으로 다시 확정한다. 모델은 호출하지 않는다.
     */
    fun retrieveForAi(request: QaRetrievalRequest): QaRetrievalResponse {
        val grant = grants.read(request.scopeToken) ?: throw ContentFailure(403, "조회 범위를 확인할 수 없어요.")
        val found = retrieve(grant.workId, grant.owner, request.question.trim(), grant.target, grant.episode, grant.episodeVersionId)
        return QaRetrievalResponse(if (found.sources.isEmpty()) "insufficient" else "found", found.sources,
            found.sources.map { QaExcerpt(it.id, it.episode, it.quote, it.kind, it.title()) }, found.gaps, found.coverage, found.steps)
    }

    private class Retrieved(val sources: List<QaCitation>, val gaps: List<QaGap>, val coverage: QaCoverage,
                            val steps: List<QaRetrievalStep>, val recheck: () -> Unit)

    private fun retrieve(workId: String, owner: String?, question: String, target: String, episode: Int,
                         episodeVersionId: String): Retrieved {
        val relationship = target == "relationship"
        if (relationship) checkContent(owner != null, 403, "현재 관계 질문은 작가만 사용할 수 있어요.")
        val input = QaScopeRequest(episode, episodeVersionId, if (relationship) "manuscript" else target)
        val scope = scopes.resolve(workId, owner, input)
        fun requireCurrent() = checkContent(scopes.resolve(workId, owner, input) == scope, 409,
            "공개 원고 범위가 변경됐어요. 최신 회차에서 다시 질문해 주세요.")
        val steps = mutableListOf<QaRetrievalStep>()
        fun <T> step(provider: String, hits: (T) -> Int, block: () -> T): T {
            val (value, took) = measureTimedValue(block)
            steps += QaRetrievalStep(provider, took.inWholeMilliseconds, hits(value))
            return value
        }

        if (target != "manuscript") {
            fun evidence() = if (relationship) relationships(scope, checkNotNull(owner)) else settings(scope, owner, question)
            val sources = step(if (relationship) "neo4j" else "postgres_settings", { it.size }) { evidence() }.rankedFor(question)
            val coverage = QaCoverage(emptyList(), emptyList(), emptyList())
            val missing = if (relationship) "연결된 내 세계관에서 확인할 수 있는 현재 관계가 없어요."
                else "이 회차의 열람 범위에서 확인할 수 있는 설정이 없어요."
            if (sources.isEmpty()) return Retrieved(emptyList(), listOf(QaGap("NO_EVIDENCE", missing)), coverage, steps) {}
            requireCurrent()
            return Retrieved(sources, emptyList(), coverage, steps) {
                requireCurrent()
                checkContent(evidence().rankedFor(question) == sources, 409, "설정 또는 현재 관계가 변경됐어요. 다시 질문해 주세요.")
            }
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
        requireCurrent()
        val verified = step("postgres_verify", { it.size }) { verify(scope, hits) }
        val covered = verified.map { QaEpisodeRef(it.episode, it.versionId) }.toSet()
        val coverage = QaCoverage(scope.episodes, scope.episodes.filter { it in covered }, scope.episodes.filterNot { it in covered })
        val gaps = buildList {
            if (verified.size < hits.size) add(QaGap("UNVERIFIED_HIT", "최신 발행 원문과 일치하지 않는 검색 결과가 있어 제외했어요."))
            if (coverage.withoutVerifiedExcerpt.isNotEmpty()) add(QaGap("LIMITED_COVERAGE", "일부 회차에서는 확인된 검색 근거를 찾지 못했어요."))
            if (verified.isEmpty()) add(QaGap("NO_EVIDENCE", "질문에 답할 수 있는 원고 근거를 확인하지 못했어요."))
        }
        if (verified.isEmpty()) return Retrieved(emptyList(), gaps, coverage, steps) {}

        return Retrieved(verified, gaps, coverage, steps) {
            requireCurrent()
            checkContent(verify(scope, hits) == verified, 409, "공개 원고가 변경됐어요. 최신 회차에서 다시 질문해 주세요.")
        }
    }

    private fun answer(question: String, sources: List<QaCitation>, gaps: List<QaGap>, coverage: QaCoverage,
                       recheck: () -> Unit): ManuscriptQaResponse {
        val draft = answers.answer(question, sources.map { QaExcerpt(it.id, it.episode, it.quote, it.kind, it.title()) })
        recheck()
        val sourceIds = sources.map { it.id }.toSet()
        checkContent(draft.claims.all { claim ->
            claim.text.isNotBlank() && claim.kind in setOf("confirmed", "inferred") &&
                claim.sourceIds.isNotEmpty() && claim.sourceIds.all { it in sourceIds }
        }, 502, "Q&A 답변의 출처를 확인할 수 없어요.")
        val unknowns = draft.gaps.filter { it.isNotBlank() }.map { QaGap("INSUFFICIENT_EVIDENCE", it) }
            .ifEmpty { if (draft.claims.isEmpty()) listOf(QaGap("NO_ANSWER", "확인한 발췌만으로는 질문에 답하기 어려워요.")) else emptyList() }
        val allGaps = gaps + unknowns
        val cited = draft.claims.flatMap { it.sourceIds }.toSet()
        val status = when {
            draft.claims.isEmpty() -> "insufficient"
            allGaps.isNotEmpty() -> "partial"
            else -> "answered"
        }
        return ManuscriptQaResponse(status, draft.claims, sources.filter { it.id in cited }, allGaps, coverage)
    }

    private fun settings(scope: QaScope, owner: String?, question: String): List<QaSettingSource> =
        worlds.settingsForQa(scope.workId, owner, scope.episode).mapNotNull { setting ->
            val text = (listOf(setting.body) + setting.properties.map { "${it.name}: ${it.value}" } +
                setting.knowledge.map { it.text }).filter { it.isNotBlank() }.joinToString("\n")
            val quote = sourceExcerpts(text, 256, question).joinToString("\n") { it.text }.evidenceText()
            if (quote.isBlank()) return@mapNotNull null
            val id = if (setting.id.length <= 92) setting.id else manuscriptHash(setting.id)
            QaSettingSource("setting:${id}", scope.workId, scope.sourceWorkId, scope.episode, quote,
                setting.id, setting.versionId, setting.name.evidenceText())
        }

    private fun relationships(scope: QaScope, owner: String): List<QaRelationshipSource> {
        val world = scopes.currentRelationships(scope, owner) ?: return emptyList()
        val cards = world.cards.filter { it.lifecycle == "active" }.associateBy { it.id }
        return world.relationships.filter { it.lifecycle == "active" }.mapNotNull { relation ->
            val from = cards[relation.sourceCardId] ?: return@mapNotNull null
            val to = cards[relation.targetCardId] ?: return@mapNotNull null
            val direction = when (relation.direction) {
                "directed" -> "→"
                "symmetric" -> "↔"
                else -> "—"
            }
            val title = "${from.title} $direction ${to.title}".evidenceText()
            val quote = listOfNotNull(relation.label, relation.body, relation.category, relation.polarity)
                .filter { it.isNotBlank() }.joinToString("\n").evidenceText()
            if (quote.isBlank()) return@mapNotNull null
            QaRelationshipSource("relationship:${relation.id}", scope.workId, scope.sourceWorkId, scope.episode,
                quote, world.worldId, world.relationshipVersion, relation.id, title)
        }
    }

    private fun QaCitation.title() = when (this) {
        is QaSettingSource -> title
        is QaRelationshipSource -> title
        is QaSource -> ""
    }

    private fun List<QaCitation>.rankedFor(question: String): List<QaCitation> {
        // shortcut: 시연 규모의 설정·관계는 제목과 근거의 문자 일치로 정렬한다. 품질 평가에서 누락이 반복되면 검색을 교체한다.
        val terms = Regex("[가-힣A-Za-z0-9]{2,}").findAll(question).map { it.value }.distinct().toList()
        return sortedWith(compareByDescending<QaCitation> { source ->
            terms.count { source.title().contains(it, ignoreCase = true) } * 2 +
                terms.count { source.quote.contains(it, ignoreCase = true) }
        }.thenBy { it.id }).take(8)
    }

    private fun String.evidenceText() = take(256).dropLastWhile { Character.isHighSurrogate(it) }

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
