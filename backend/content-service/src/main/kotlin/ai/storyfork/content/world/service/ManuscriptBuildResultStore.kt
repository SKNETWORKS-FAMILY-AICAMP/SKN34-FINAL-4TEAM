package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import ai.storyfork.content.world.studio.entity.ManuscriptBuildResult
import ai.storyfork.content.world.studio.repository.*
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

/** 검증된 회차 추출의 원문 기준·근거를 보존한다. 후보 승인/세계관 반영은 수행하지 않는다. */
@Service
class ManuscriptBuildResultStore(
    private val jobs:ManuscriptBuildJobRepository,private val results:ManuscriptBuildResultRepository,
    private val worlds:StudioWorldRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,private val mapper:JsonMapper,
) {
    private val transaction=TransactionTemplate(manager)

    // WorldStudio 편집과 같은 world → job 잠금 순서를 유지한다.
    private fun owned(id:UUID,actor:UUID)=jobs.owned(id,actor,worlds)

    private fun input(job:ManuscriptBuildJob):ManuscriptBuildInput {
        val rows=job.manifest["episodes"] as? List<*> ?: throw WorldConflict()
        return ManuscriptBuildInput(rows.map { raw ->
            val row=raw as? Map<*,*> ?: throw WorldConflict()
            val source=mapper.convertValue(row.filterKeys { it!="sourceHash" },ManuscriptBuildSource::class.java)
            if(row["sourceHash"]!=source.hash) throw WorldConflict()
            source
        })
    }

    private fun ordered(value:Any?):Any?=when(value) {
        is Map<*,*> -> value.entries.associate { (key,item) -> (key as String) to ordered(item) }.toSortedMap()
        is List<*> -> value.map(::ordered)
        else -> value
    }

    /** 응답 유실 재전송은 기존 결과를 반환한다. 다른 결과나 늦은 worker의 신규 쓰기는 거절한다. */
    fun record(id:UUID,actor:UUID,token:UUID,result:ManuscriptEpisodeResult):ManuscriptBuildResult =
        checkNotNull(transaction.execute {
            val job=owned(id,actor)
            input(job).missing(listOf(result))
            @Suppress("UNCHECKED_CAST")
            val content=mapper.readValue(mapper.writeValueAsBytes(result),Map::class.java) as Map<String,Any?>
            val hash=MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(ordered(content)))
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            val previous=results.findByJobIdAndKindAndEpisode(id,"extraction",result.basis.number)
            if(previous!=null) {
                if(previous.contentHash!=hash) throw WorldConflict()
                return@execute previous
            }
            if(job.status!="running" || job.executionToken!=token || job.deadline?.isAfter(Instant.now())!=true) throw WorldConflict()
            results.saveAndFlush(ManuscriptBuildResult(jobId=id,kind="extraction",episode=result.basis.number,content=content,contentHash=hash))
        })

    /** 완료 회차는 영속 결과로만 계산하며 조회 때도 원문 기준을 검증한다. */
    fun read(id:UUID,actor:UUID):List<ManuscriptEpisodeResult> = checkNotNull(transaction.execute {
        val job=owned(id,actor)
        val saved=results.findAllByJobIdOrderByEpisode(id).filter { it.kind=="extraction" }
            .map { mapper.convertValue(it.content,ManuscriptEpisodeResult::class.java) }
        input(job).missing(saved)
        saved
    })
}
