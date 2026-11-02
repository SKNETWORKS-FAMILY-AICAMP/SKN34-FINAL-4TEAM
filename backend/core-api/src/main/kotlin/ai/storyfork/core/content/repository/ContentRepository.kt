package ai.storyfork.core.content.repository

import ai.storyfork.core.content.domain.ContentWork
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** PostgreSQL owns the content aggregate, including immutable versions and Fork checkpoints. */
class ContentRepository(private val jdbc: JdbcTemplate, private val transactions: TransactionTemplate, private val mapper: JsonMapper) {
    fun <T: Any> transaction(action: () -> T): T = transactions.execute {
        // shortcut: serialize content commands for this initial writer workload; replace with ordered row locks when contention is measured.
        jdbc.execute("SELECT pg_advisory_xact_lock(34710261)")
        action()
    }
    fun find(id: String): ContentWork? = jdbc.query("SELECT payload FROM content_work WHERE id=?", { rs,_ -> mapper.readValue(rs.getString(1),ContentWork::class.java) },id).firstOrNull()
    fun list(ownerId: String? = null): List<ContentWork> = if(ownerId==null)
        jdbc.query("SELECT payload FROM content_work WHERE visibility='public' ORDER BY created_at DESC", { rs,_ -> mapper.readValue(rs.getString(1),ContentWork::class.java) })
        else jdbc.query("SELECT payload FROM content_work WHERE owner_id=? ORDER BY created_at DESC", { rs,_ -> mapper.readValue(rs.getString(1),ContentWork::class.java) },ownerId)
    fun save(w: ContentWork) {
        jdbc.update("INSERT INTO content_work(id,owner_id,source_id,visibility,payload) VALUES (?,?,?,?,CAST(? AS jsonb)) ON CONFLICT(id) DO UPDATE SET visibility=EXCLUDED.visibility,payload=EXCLUDED.payload",w.id,w.ownerId,w.source?.workId,w.visibility,mapper.writeValueAsString(w))
    }
}
