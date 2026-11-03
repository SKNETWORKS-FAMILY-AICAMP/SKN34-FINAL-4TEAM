package ai.storyfork.core.content.repository

import ai.storyfork.core.content.domain.*
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** ERD tables own content; JSON is used only for immutable AI evidence. */
class ContentRepository(private val jdbc: JdbcTemplate, private val transactions: TransactionTemplate, private val mapper: JsonMapper) {
    fun <T: Any> transaction(action: () -> T): T = transactions.execute {
        // shortcut: initial writer workload is serialized; use ordered row locks when contention is measured.
        jdbc.execute("SELECT pg_advisory_xact_lock(34710261)")
        action()
    }
    private fun key(vararg parts: String) = UUID.nameUUIDFromBytes(parts.joinToString("\u0000").toByteArray(Charsets.UTF_8)).toString()
    private fun episodeId(work: String, number: Int) = key("episode",work,number.toString())
    private fun versionId(work: String, number: Int, version: String) = key("episode-version",episodeId(work,number),version)
    private fun documentId(world: String, id: String) = key("setting",world,id)
    private fun settingVersionId(world: String, s: Setting) = key("setting-version",documentId(world,s.id),s.versionId)
    private fun timestamp(value: String) = Timestamp.from(Instant.parse(value))
    private fun ResultSet.strings(name: String) = (getArray(name).array as Array<*>).map { it.toString() }
    private fun ResultSet.time(name: String) = getTimestamp(name).toInstant().toString()
    private fun <T> rows(sql: String, vararg args: Any?, read: (ResultSet) -> T): List<T> = jdbc.query(sql,{ r,_ -> read(r) },*args)
    private fun update(sql: String,vararg args: Any?) = jdbc.update(sql,*args)

    fun list(ownerId: String? = null): List<ContentWork> {
        val ids=if(ownerId==null) rows("SELECT id FROM work_current WHERE visibility_status='public' ORDER BY created_at DESC") { it.getString(1) }
            else rows("SELECT id FROM work_current WHERE owner_id=? ORDER BY created_at DESC",ownerId) { it.getString(1) }
        return ids.mapNotNull(::find)
    }
    fun find(id: String): ContentWork? {
        val work=rows("SELECT * FROM work_current WHERE id=?",id) { r ->
            ContentWork(id=r.getString("id"),ownerId=r.getString("owner_id"),title=r.getString("title"),summary=r.getString("description"),
                visibility=r.getString("visibility_status"),allowFork=r.getBoolean("allow_fork_creation"),allowForkPublication=r.getBoolean("allow_fork_publication"),
                worldId=r.getString("world_id"),genre=r.getString("genre"),draft=Draft(revision=r.getInt("revision")))
        }.firstOrNull() ?: return null
        val source=rows("""SELECT f.*,fp.revision_no AS confirmed_policy_revision,fr.reference_status AS world_mode,e.sequence,v.revision_no FROM fork f LEFT JOIN fork_policy_history fp ON fp.id=f.confirmed_policy_history_id JOIN fork_world_reference fr ON fr.fork_work_id=f.work_id JOIN checkpoint c ON c.id=f.source_checkpoint_id
            JOIN episode e ON e.id=c.episode_id JOIN episode_version v ON v.id=c.basis_episode_version_id WHERE f.work_id=?""",id) { r ->
            work.world.mode=r.getString("world_mode"); work.world.revision=r.getInt("world_revision")
            Source(r.getString("source_work_id"),r.getString("source_title"),r.getInt("sequence"),r.getInt("revision_no"),r.getString("direction"),
                (r.getObject("confirmed_policy_revision") as Number?)?.toInt(),r.getTimestamp("conditions_confirmed_at")?.toInstant()?.toString())
        }.firstOrNull()
        val w=work.copy(source=source,worldId=if(source==null) work.worldId else id)
        rows("""SELECT e.sequence,e.inherited,v.* FROM episode_current e JOIN episode_version v ON v.id=e.published_version_id
            WHERE e.work_id=? ORDER BY e.sequence""",id) { r ->
            Episode(r.getInt("sequence"),r.getInt("revision_no"),r.getString("content_version_id"),r.getString("title"),r.getString("content"),r.getBoolean("inherited"))
        }.also(w.episodes::addAll)
        rows("SELECT d.* FROM episode_draft d JOIN episode e ON e.id=d.episode_id WHERE e.work_id=? AND e.sequence=?",id,w.episodes.size+1) { r ->
            Draft(r.getString("title"),r.getString("content"),work.draft.revision)
        }.firstOrNull()?.let { w.draft=it }
        rows("SELECT v.*,e.sequence FROM episode_version v JOIN episode e ON e.id=v.episode_id WHERE e.work_id=? AND v.is_saved ORDER BY v.created_at,v.revision_no",id) { r ->
            Version(r.getString("content_version_id"),r.getString("title"),r.getString("content"),r.getInt("revision_no"),r.getInt("sequence"),r.time("created_at"))
        }.also(w.versions::addAll)
        if(w.world.mode!="following") {
            w.world.revision=jdbc.queryForObject("SELECT revision FROM world WHERE id=?",Int::class.java,w.worldId)!!
            w.world.history=readSettings("WHERE d.world_id=? ORDER BY v.revision_no",w.worldId).toMutableList()
            rows("SELECT s.*,d.logical_id,'' AS content_version_id,s.name AS name_snapshot FROM setting_draft s JOIN setting_document d ON d.id=s.setting_document_id WHERE d.world_id=? ORDER BY s.edit_order",w.worldId,read=::setting).forEach { w.world.drafts[it.id]=it }
            w.world.draft=w.world.drafts.values.lastOrNull()
        }
        if(source!=null) {
            w.world.basis=Basis(source.episode,source.version,readSettings("JOIN checkpoint_setting cs ON cs.setting_version_id=v.id JOIN fork f ON f.source_checkpoint_id=cs.checkpoint_id WHERE f.work_id=? ORDER BY v.revision_no",id))
            w.world.sourceSnapshot=readSettings("JOIN fork_source_setting fs ON fs.setting_version_id=v.id WHERE fs.fork_work_id=? ORDER BY v.revision_no",id)
            rows("SELECT c.source_change_ref,d.decision FROM fork_source_change c JOIN LATERAL (SELECT decision FROM fork_change_decision WHERE source_change_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1) d ON true WHERE c.fork_work_id=?",id) { it.getString(1) to it.getString(2) }.forEach { w.world.decisions[it.first]=it.second }
        }
        rows("SELECT * FROM fork_policy_history WHERE work_id=? ORDER BY revision_no",id) { r -> Policy(r.getBoolean("allow_creation"),r.getBoolean("allow_publication"),r.time("changed_at")) }.also(w.policyHistory::addAll)
        rows("SELECT e.sequence,v.content_version_id,p.occurred_at AS published_at FROM publication_event p JOIN episode_version v ON v.id=p.episode_version_id JOIN episode e ON e.id=v.episode_id WHERE e.work_id=? AND p.action='publish' AND p.outcome='applied' ORDER BY p.occurred_at",id) { r -> Publication(r.getInt(1),r.getString(2),r.time("published_at")) }.also(w.publicationHistory::addAll)
        rows("""SELECT p.*,j.request_text,c.model,c.trace_ref,c.input_tokens,c.output_tokens,i.content_snapshot,i.draft_revision,
            e.excerpt_snapshot,EXISTS(SELECT 1 FROM proposal_decision d JOIN proposal_application a ON a.decision_id=d.id
              WHERE d.proposal_id=p.id AND a.outcome='applied') applied
            FROM ai_proposal p JOIN ai_job j ON j.id=p.job_id JOIN ai_model_call c ON c.job_id=j.id AND c.sequence=1
            JOIN ai_input_snapshot i ON i.id=p.input_snapshot_id JOIN proposal_evidence pe ON pe.proposal_id=p.id
            JOIN ai_evidence e ON e.id=pe.evidence_id AND e.kind='context'
            WHERE j.work_id=? ORDER BY p.created_at""",id) { r ->
            Proposal(id=r.getString("id"),text=r.getString("content"),model=r.getString("model"),revision=r.getInt("draft_revision"),
                status=if(r.getBoolean("applied")) "accepted" else "pending",prompt=r.getString("request_text"),baseBody=r.getString("content_snapshot"),
                context=mapper.readValue(r.getString("excerpt_snapshot"),StoryContext::class.java),providerResponseId=r.getString("trace_ref"),
                usage=if(r.getObject("input_tokens")==null) null else Usage(r.getInt("input_tokens"),r.getInt("output_tokens")),createdAt=r.time("created_at"))
        }.also(w.proposals::addAll)
        return w
    }
    fun writingNumbers(work: String): List<Int> = rows("""SELECT e.sequence FROM episode_current e
        WHERE e.work_id=? AND (e.published_version_id IS NOT NULL OR EXISTS(SELECT 1 FROM episode_draft d WHERE d.episode_id=e.id)
        OR EXISTS(SELECT 1 FROM episode_version v WHERE v.episode_id=e.id AND v.is_saved)) ORDER BY e.sequence""",work) { it.getInt(1) }
    fun writing(work: String,number: Int): WritingEpisode? {
        val versions=rows("SELECT * FROM episode_version WHERE episode_id=? AND is_saved ORDER BY created_at,id",episodeId(work,number)) { r ->
            Version(r.getString("content_version_id"),r.getString("title"),r.getString("content"),r.getInt("revision_no"),number,r.time("created_at"))
        }
        return rows("""SELECT e.inherited,p.content_version_id,COALESCE(d.title,p.title) title,COALESCE(d.content,p.content) content,
            COALESCE(d.edit_revision,0) edit_revision,d.updated_at FROM episode_current e
            LEFT JOIN episode_draft d ON d.episode_id=e.id LEFT JOIN episode_version p ON p.id=e.published_version_id
            WHERE e.work_id=? AND e.sequence=? AND (d.episode_id IS NOT NULL OR p.id IS NOT NULL)""",work,number) { r ->
            WritingEpisode(number,Draft(r.getString("title"),r.getString("content"),r.getInt("edit_revision")),versions,
                r.getString("content_version_id"),r.getBoolean("inherited"),r.getTimestamp("updated_at")?.toInstant()?.toString())
        }.firstOrNull()
    }
    fun writeDraft(work: String,number: Int,draft: Draft) {
        ensureEpisode(work,number)
        update("""INSERT INTO episode_draft(episode_id,title,content,edit_revision) VALUES (?,?,?,?) ON CONFLICT(episode_id)
            DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,edit_revision=EXCLUDED.edit_revision,updated_at=now()""",
            episodeId(work,number),draft.title,draft.body,draft.revision)
        update("UPDATE work SET revision=revision+1 WHERE id=?",work)
    }
    fun saveWritingVersion(w: ContentWork,number: Int,draft: Draft,settingsWorld: String,settings: List<Setting>) {
        val v=Version(title=draft.title,body=draft.body,revision=draft.revision,episode=number)
        val history=jdbc.queryForObject("SELECT id FROM work_world_history WHERE work_id=? ORDER BY revision_no DESC LIMIT 1",String::class.java,w.id)!!
        update("""INSERT INTO episode_version(id,episode_id,content_version_id,revision_no,title,content,created_at,is_saved,work_world_history_id)
            VALUES (?,?,?,?,?,?,?,true,?)""",versionId(w.id,number,v.id),episodeId(w.id,number),v.id,v.revision,v.title,v.body,timestamp(v.savedAt),history)
        val episodes=w.episodes.filter { it.number<number }+Episode(number,v.revision,v.id,v.title,v.body)
        checkpoint(key("writing-checkpoint",v.id),w.id,Source(w.id,w.title,number,v.revision,""),episodes,settingsWorld,settings)
    }
    fun publishWriting(w: ContentWork,number: Int,v: Version) {
        update("""INSERT INTO publication_event(id,episode_version_id,actor_id,action,outcome,trigger_kind,occurred_at)
            VALUES (?,?,?,'publish','applied','manual',now())""",contentId(),versionId(w.id,number,v.id),w.ownerId)
        if(w.visibility!="public") {
            val next=jdbc.queryForObject("SELECT COALESCE(max(revision_no),-1)+1 FROM work_publication_history WHERE work_id=?",Int::class.java,w.id)!!
            update("INSERT INTO work_publication_history(id,work_id,revision_no,visibility) VALUES (?,?,?,'public')",contentId(),w.id,next)
        }
        recordPublicationRights(w.id,w.ownerId)
        update("UPDATE episode_draft SET edit_revision=edit_revision+1 WHERE episode_id=?",episodeId(w.id,number))
        update("UPDATE work SET revision=revision+1 WHERE id=?",w.id)
    }

    private fun setting(r: ResultSet) = Setting(id=r.getString("logical_id"),versionId=r.getString("content_version_id"),name=r.getString("name_snapshot"),content=r.getString("content"),category=r.getString("category_id"),tags=r.strings("tags"),visibility=r.getString("visibility_status"),fromEpisode=r.getInt("from_episode"),toEpisode=(r.getObject("to_episode") as Number?)?.toInt(),knownBy=r.strings("known_by"),evidence=r.getString("evidence"))
    private fun readSettings(clause: String,vararg args: Any?) = rows("SELECT v.* FROM setting_version_read v JOIN setting_document d ON d.id=v.setting_document_id $clause",*args,read=::setting)

    fun save(w: ContentWork) {
        update("INSERT INTO member(id) VALUES (?) ON CONFLICT DO NOTHING",w.ownerId)
        val sourceWorld=w.source?.let { jdbc.queryForObject("SELECT world_id FROM work_current WHERE id=?",String::class.java,it.workId)!! }
        if(w.world.mode!="following") update("""INSERT INTO world(id,owner_id,name,revision) VALUES (?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision""",w.worldId,w.ownerId,w.title+" 설정집",w.world.revision)
        update("""INSERT INTO work(id,owner_id,title,description,origin_kind,revision) VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,revision=EXCLUDED.revision""",
            w.id,w.ownerId,w.title,w.summary,if(w.source==null) "original" else "fork",w.draft.revision)
        val targetWorld=if(w.world.mode=="following") sourceWorld!! else w.worldId
        val currentWorld=rows("SELECT world_id FROM work_world_history WHERE work_id=? ORDER BY revision_no DESC LIMIT 1",w.id) { it.getString(1) }.firstOrNull()
        if(currentWorld!=targetWorld) {
            val next=jdbc.queryForObject("SELECT COALESCE(max(revision_no),-1)+1 FROM work_world_history WHERE work_id=?",Int::class.java,w.id)!!
            update("INSERT INTO work_world_history(id,work_id,world_id,revision_no) VALUES (?,?,?,?)",key("work-world",w.id,next.toString()),w.id,targetWorld,next)
        }
        val visibility=rows("SELECT visibility FROM work_publication_history WHERE work_id=? ORDER BY revision_no DESC LIMIT 1",w.id) { it.getString(1) }.firstOrNull()
        if(visibility!=w.visibility) {
            val next=jdbc.queryForObject("SELECT COALESCE(max(revision_no),-1)+1 FROM work_publication_history WHERE work_id=?",Int::class.java,w.id)!!
            update("INSERT INTO work_publication_history(id,work_id,revision_no,visibility) VALUES (?,?,?,?)",key("work-publication",w.id,next.toString()),w.id,next,w.visibility)
        }
        saveEpisodes(w)
        if(w.world.mode!="following") saveWorld(w,sourceWorld)
        w.policyHistory.forEachIndexed { index,p ->
            update("INSERT INTO fork_policy_history(id,work_id,allow_creation,allow_publication,changed_at,revision_no) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",key("policy",w.id,index.toString()),w.id,p.allowFork,p.allowForkPublication,timestamp(p.changedAt),index)
        }
        if(w.source!=null) saveFork(w,sourceWorld!!)
        w.proposals.forEach { saveProposal(w,it) }
    }
    private fun ensureEpisode(work: String,number: Int) {
        update("INSERT INTO episode(id,work_id,sequence) VALUES (?,?,?) ON CONFLICT DO NOTHING",episodeId(work,number),work,number)
    }
    private fun saveEpisodes(w: ContentWork) {
        for(number in 1..w.episodes.size+1) ensureEpisode(w.id,number)
        val worldHistory=jdbc.queryForObject("SELECT id FROM work_world_history WHERE work_id=? ORDER BY revision_no DESC LIMIT 1",String::class.java,w.id)!!
        fun version(number: Int, id: String, revision: Int,title: String,body: String,savedAt: String,saved: Boolean) {
            update("""INSERT INTO episode_version(id,episode_id,content_version_id,revision_no,title,content,created_at,is_saved,work_world_history_id)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",versionId(w.id,number,id),episodeId(w.id,number),id,revision,title,body,timestamp(savedAt),saved,worldHistory)
        }
        w.versions.forEach { version(it.episode,it.id,it.revision,it.title,it.body,it.savedAt,true) }
        w.episodes.forEach { e -> version(e.number,e.versionId,e.version,e.title,e.body,Instant.EPOCH.toString(),false) }
        update("""INSERT INTO episode_draft(episode_id,title,content,edit_revision) VALUES (?,?,?,?)
            ON CONFLICT(episode_id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,edit_revision=EXCLUDED.edit_revision,updated_at=now()""",episodeId(w.id,w.episodes.size+1),w.draft.title,w.draft.body,w.draft.revision)
        w.publicationHistory.forEach { p ->
            val version=versionId(w.id,p.episode,p.versionId)
            val at=timestamp(p.publishedAt)
            update("""INSERT INTO publication_event(id,episode_version_id,actor_id,action,outcome,occurred_at,trigger_kind)
                SELECT ?,?,?,'publish','applied',?,'manual' WHERE NOT EXISTS (
                    SELECT 1 FROM publication_event WHERE episode_version_id=? AND action='publish' AND outcome='applied' AND occurred_at=?)
                ON CONFLICT DO NOTHING""",key("publication",w.id,p.episode.toString(),p.versionId),version,w.ownerId,at,version,at)
        }
    }
    private fun saveWorld(w: ContentWork, sourceWorld: String?) {
        val all=(w.world.history+w.world.drafts.values).associateBy { it.id }
        all.values.forEach { s ->
            update("INSERT INTO setting_document(id,world_id,logical_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",documentId(w.worldId,s.id),w.worldId,s.id)
        }
        w.world.history.forEachIndexed { index,s ->
            val id=settingVersionId(w.worldId,s); val doc=documentId(w.worldId,s.id); val visibility=key("visibility",id)
            ensureEpisode(w.id,s.fromEpisode); s.toEpisode?.let { ensureEpisode(w.id,it) }
            update("""INSERT INTO setting_visibility_history(id,setting_document_id,revision_no,default_visibility)
                VALUES (?,?,?,'private') ON CONFLICT DO NOTHING""",visibility,doc,index)
            update("INSERT INTO setting_visibility_range VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",key("range",id),visibility,episodeId(w.id,s.fromEpisode),s.toEpisode?.let { episodeId(w.id,it) },s.visibility)
            update("""INSERT INTO setting_version(id,setting_document_id,content_version_id,revision_no,name,category_id,content,evidence,visibility_history_id)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",id,doc,s.versionId,index,s.name,s.category,s.content,s.evidence,visibility)
            s.knownBy.forEachIndexed { position,name -> update("INSERT INTO setting_knowledge_scope VALUES (?,?,?) ON CONFLICT DO NOTHING",id,name,position) }
            s.tags.forEachIndexed { position,tag ->
                val tagId=key("tag",w.ownerId,tag)
                update("INSERT INTO setting_tag(id,owner_id,name) VALUES (?,?,?) ON CONFLICT DO NOTHING",tagId,w.ownerId,tag)
                update("INSERT INTO setting_version_tag VALUES (?,?,?) ON CONFLICT DO NOTHING",id,tagId,position)
            }
        }
        w.world.history.associateBy { it.id }.values.forEach { s ->
            val doc=documentId(w.worldId,s.id)
            update("DELETE FROM setting_document_tag WHERE setting_document_id=?",doc)
            s.tags.forEach { tag -> update("INSERT INTO setting_document_tag VALUES (?,?) ON CONFLICT DO NOTHING",doc,key("tag",w.ownerId,tag)) }
            if(sourceWorld!=null) {
                val origin=rows("SELECT v.id FROM setting_version v JOIN setting_document d ON d.id=v.setting_document_id WHERE d.world_id=? AND d.logical_id=? AND v.content_version_id=?",sourceWorld,s.id,s.versionId) { it.getString(1) }.firstOrNull()
                if(origin!=null) update("INSERT INTO setting_origin(setting_document_id,source_setting_version_id) VALUES (?,?) ON CONFLICT DO NOTHING",doc,origin)
            }
        }
        update("DELETE FROM setting_draft WHERE setting_document_id IN (SELECT id FROM setting_document WHERE world_id=?)",w.worldId)
        w.world.drafts.values.forEachIndexed { index,s ->
            update("""INSERT INTO setting_draft(setting_document_id,name,category_id,content,from_episode,to_episode,visibility_status,known_by,tags,evidence,edit_order,edit_revision)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",documentId(w.worldId,s.id),s.name,s.category,s.content,s.fromEpisode,s.toEpisode,s.visibility,s.knownBy.toTypedArray(),s.tags.toTypedArray(),s.evidence,index,w.world.revision)
        }
    }
    private fun checkpoint(id: String, ownerWork: String, source: Source, episodes: List<Episode>, settingsWorld: String, settings: List<Setting>) {
        val basis=episodes.first { it.number==source.episode }
        update("INSERT INTO checkpoint(id,work_id,episode_id,basis_episode_version_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING",id,ownerWork,episodeId(source.workId,source.episode),versionId(source.workId,source.episode,basis.versionId))
        episodes.filter { it.number<=source.episode }.forEach { e ->
            update("INSERT INTO checkpoint_episode VALUES (?,?,?,?) ON CONFLICT DO NOTHING",id,source.workId,episodeId(source.workId,e.number),versionId(source.workId,e.number,e.versionId))
        }
        settings.forEach { setting ->
            update("INSERT INTO checkpoint_setting VALUES (?,?,?) ON CONFLICT DO NOTHING",id,documentId(settingsWorld,setting.id),settingVersionId(settingsWorld,setting))
        }
    }
    private fun saveFork(w: ContentWork, sourceWorld: String) {
        val source=w.source!!; val cp=key("checkpoint",w.id)
        checkpoint(cp,source.workId,source,w.episodes,sourceWorld,w.world.basis?.settings.orEmpty())
        update("""INSERT INTO fork(work_id,source_work_id,owner_id,source_checkpoint_id,source_title,direction,world_revision,confirmed_policy_history_id,conditions_confirmed_at)
            VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET world_revision=EXCLUDED.world_revision""",
            w.id,source.workId,w.ownerId,cp,source.title,source.direction,w.world.revision,
            source.confirmedPolicyRevision?.let { key("policy",source.workId,it.toString()) },source.conditionsConfirmedAt?.let(::timestamp))
        update("""INSERT INTO fork_world_reference(fork_work_id,source_world_id,reference_status,last_followed_checkpoint_id,detached_at)
            VALUES (?,?,?,?,?) ON CONFLICT(fork_work_id) DO UPDATE SET reference_status=EXCLUDED.reference_status,
            detached_at=COALESCE(fork_world_reference.detached_at,EXCLUDED.detached_at)""",
            w.id,sourceWorld,w.world.mode,cp,if(w.world.mode=="independent") Timestamp.from(Instant.now()) else null)
        w.world.sourceSnapshot.forEach { setting -> update("INSERT INTO fork_source_setting VALUES (?,?,?) ON CONFLICT DO NOTHING",w.id,documentId(sourceWorld,setting.id),settingVersionId(sourceWorld,setting)) }
        val original=find(source.workId)!!
        w.world.decisions.forEach { (ref,decision) ->
            val change=key("source-change",w.id,ref)
            val previous=rows("SELECT decision FROM fork_change_decision WHERE source_change_id=? ORDER BY decided_at DESC,id DESC LIMIT 1",change) { it.getString(1) }.firstOrNull()
            if(previous!=decision) {
                val before=key("change-before",change); val after=key("change-after",change)
                checkpoint(before,source.workId,source,w.episodes,sourceWorld,w.world.sourceSnapshot)
                checkpoint(after,source.workId,source,w.episodes,sourceWorld,inheritedSettings(w,original))
                update("INSERT INTO fork_source_change(id,fork_work_id,source_change_ref,before_checkpoint_id,after_checkpoint_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",change,w.id,ref,before,after)
                val event=contentId()
                update("INSERT INTO fork_change_decision(id,source_change_id,actor_id,decision) VALUES (?,?,?,?)",event,change,w.ownerId,decision)
                if(decision=="apply") {
                    val result=key("change-result",event)
                    checkpoint(result,w.id,source,w.episodes,w.worldId,selectSettings(w.world.history,source.episode))
                    update("INSERT INTO fork_change_application(id,decision_id,result_checkpoint_id,outcome) VALUES (?,?,?,'applied')",contentId(),event,result)
                }
            }
        }
    }
    fun startJob(id: String,w: ContentWork,prompt: String) {
        update("INSERT INTO ai_job(id,requester_id,work_id,kind,status,request_text,started_at) VALUES (?,?,?,'continuation','running',?,now())",id,w.ownerId,w.id,prompt)
        update("INSERT INTO ai_model_call(id,job_id,sequence,role,provider,status,usage_status,started_at) VALUES (?,?,1,'writer','openai','running','unreported',now())",id,id)
    }
    fun recordPublicationRights(work: String,owner: String) {
        update("INSERT INTO work_rights_declaration(id,work_id,member_id,notice_version,response,confirmed_at) VALUES (?,?,?,'publication-rights-v1','confirmed',now())",contentId(),work,owner)
    }
    fun failJob(id: String,code: String) {
        update("UPDATE ai_job SET status='failed',failure_reason=?,finished_at=now() WHERE id=?",code,id)
        update("UPDATE ai_model_call SET status='failed',failure_code=?,finished_at=now() WHERE job_id=? AND status='running'",code,id)
    }
    fun completeCall(id: String,model: String,responseId: String?,usage: Usage?) {
        update("UPDATE ai_model_call SET status='completed',model=?,trace_ref=?,usage_status=?,input_tokens=?,output_tokens=?,finished_at=now() WHERE job_id=?",
            model,responseId,if(usage==null) "unreported" else "reported",usage?.inputTokens,usage?.outputTokens,id)
    }
    private fun saveProposal(w: ContentWork,p: Proposal) {
        update("""INSERT INTO ai_job(id,requester_id,work_id,kind,status,request_text,created_at,finished_at)
            VALUES (?,?,?,'continuation','completed',?,?,?) ON CONFLICT(id) DO UPDATE SET status='completed',finished_at=COALESCE(ai_job.finished_at,EXCLUDED.finished_at)""",
            p.id,w.ownerId,w.id,p.prompt,timestamp(p.createdAt),timestamp(p.createdAt))
        update("""INSERT INTO ai_model_call(id,job_id,sequence,role,provider,model,trace_ref,status,usage_status,input_tokens,output_tokens,finished_at)
            VALUES (?,?,1,'writer','openai',?,?,'completed',?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=EXCLUDED.model,trace_ref=EXCLUDED.trace_ref,
            status='completed',usage_status=EXCLUDED.usage_status,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,finished_at=COALESCE(ai_model_call.finished_at,EXCLUDED.finished_at)""",
            p.id,p.id,p.model,p.providerResponseId,if(p.usage==null) "unreported" else "reported",p.usage?.inputTokens,p.usage?.outputTokens,timestamp(p.createdAt))
        val episode=w.versions.find { it.revision==p.revision }?.episode
            ?: w.versions.find { it.revision==p.revision+1 }?.episode ?: w.episodes.size+1
        val input=key("input",p.id); val evidence=key("evidence",p.id)
        update("""INSERT INTO ai_input_snapshot(id,job_id,episode_id,source_kind,content_snapshot,draft_revision,captured_at)
            VALUES (?,?,?,'draft',?,?,?) ON CONFLICT DO NOTHING""",input,p.id,episodeId(w.id,episode),p.baseBody,p.revision,timestamp(p.createdAt))
        update("INSERT INTO ai_proposal(id,job_id,kind,content,created_at,input_snapshot_id) VALUES (?,?,'continuation',?,?,?) ON CONFLICT DO NOTHING",p.id,p.id,p.text,timestamp(p.createdAt),input)
        update("INSERT INTO ai_evidence(id,kind,excerpt_snapshot,captured_at) VALUES (?,'context',?,?) ON CONFLICT DO NOTHING",evidence,mapper.writeValueAsString(p.context),timestamp(p.createdAt))
        update("INSERT INTO proposal_evidence VALUES (?,?) ON CONFLICT DO NOTHING",p.id,evidence)
        if(p.status=="accepted") {
            val applied=w.versions.first { it.revision==p.revision+1 }
            val decision=key("proposal-decision",p.id); val application=key("proposal-application",p.id)
            update("INSERT INTO proposal_decision(id,proposal_id,sequence,actor_id,decision,approved_content,decided_at) VALUES (?,?,1,?,'accept',?,?) ON CONFLICT DO NOTHING",decision,p.id,w.ownerId,p.text,timestamp(applied.savedAt))
            update("INSERT INTO proposal_application(id,decision_id,attempt_no,outcome,attempted_at) VALUES (?,?,1,'applied',?) ON CONFLICT DO NOTHING",application,decision,timestamp(applied.savedAt))
            update("""INSERT INTO proposal_episode_change(id,application_id,episode_id,result_version_id,before_content,after_content,base_draft_revision,result_draft_revision)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING""",key("proposal-result",p.id),application,episodeId(w.id,applied.episode),versionId(w.id,applied.episode,applied.id),p.baseBody,applied.body,p.revision,applied.revision)
        }
    }
}
