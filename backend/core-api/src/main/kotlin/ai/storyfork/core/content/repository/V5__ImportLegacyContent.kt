package ai.storyfork.core.content.repository

import ai.storyfork.core.content.domain.ContentWork
import ai.storyfork.core.content.domain.Policy
import org.flywaydb.core.api.migration.BaseJavaMigration
import org.flywaydb.core.api.migration.Context
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.SingleConnectionDataSource
import org.springframework.jdbc.support.JdbcTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** Flyway owns the transaction: a failed import leaves the legacy rows intact. */
class V5__ImportLegacyContent(private val mapper: JsonMapper) : BaseJavaMigration() {
    override fun migrate(context: Context) {
        val dataSource=SingleConnectionDataSource(context.connection,true)
        val jdbc=JdbcTemplate(dataSource)
        val repository=ContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(dataSource)),mapper)
        val works=jdbc.query("SELECT payload FROM content_work ORDER BY created_at",{ r,_ -> mapper.readValue(r.getString(1),ContentWork::class.java) })
        works.forEach { work ->
            work.proposals.replaceAll { proposal ->
                val result = if(proposal.status=="accepted") work.versions.singleOrNull {
                    it.revision==proposal.revision+1 && it.body==(proposal.baseBody+"\n\n"+proposal.text).trim() &&
                        (proposal.targetEpisode==null || it.episode==proposal.targetEpisode) &&
                        (proposal.appliedVersionId==null || it.id==proposal.appliedVersionId)
                } ?: error("Legacy proposal result is ambiguous") else null
                val candidates = work.versions.filter { it.revision==proposal.revision && it.body==proposal.baseBody }.map { it.episode } +
                    if(work.draft.revision==proposal.revision && work.draft.body==proposal.baseBody) listOf(work.episodes.size+1) else emptyList()
                val target=proposal.targetEpisode ?: result?.episode ?: candidates.distinct().singleOrNull()
                    ?: error("Legacy proposal target is ambiguous")
                proposal.copy(targetEpisode=target,appliedVersionId=result?.id)
            }
        }
        works.filter { it.source==null }.forEach { work ->
            if(work.policyHistory.lastOrNull()?.let { it.allowFork==work.allowFork && it.allowForkPublication==work.allowForkPublication }!=true)
                work.policyHistory.add(Policy(work.allowFork,work.allowForkPublication))
            repository.save(work)
        }
        works.filter { it.source!=null }.forEach(repository::save)
        works.forEach { old ->
            val restored=repository.find(old.id) ?: error("Legacy work was not imported")
            check(restored.draft==old.draft && restored.episodes==old.episodes && restored.world.history.map { it.copy(tags=it.tags.sorted(),knownBy=it.knownBy.sorted()) }==old.world.history.map { it.copy(tags=it.tags.sorted(),knownBy=it.knownBy.sorted()) }) { "Legacy content import mismatch" }
        }
    }
}
