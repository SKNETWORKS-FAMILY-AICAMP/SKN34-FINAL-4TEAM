package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.studio.entity.ManuscriptBuildJob
import ai.storyfork.content.world.studio.repository.ManuscriptBuildJobRepository
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.owned
import java.time.Instant
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/** 최초 구축 실행권만 짧은 transaction으로 획득한다. 외부 호출·재시도 스케줄링은 하지 않는다. */
@Service
class ManuscriptBuildExecution(
    private val jobs:ManuscriptBuildJobRepository,private val worlds:StudioWorldRepository,
    @Qualifier("worldStudioTransactionManager") manager:PlatformTransactionManager,
) {
    private val transaction=TransactionTemplate(manager)

    private fun owned(id:UUID,owner:UUID)=jobs.owned(id,owner,worlds)

    /** 시간은 서버 호출자가 제공한다. 이전 token 없는 중복 배달·자동 재실행은 거절한다. */
    fun claim(id:UUID,owner:UUID,now:Instant,deadline:Instant,previousToken:UUID?=null):UUID {
        require(deadline.isAfter(now))
        return checkNotNull(transaction.execute {
            val job=owned(id,owner)
            val initial=job.status=="queued" && job.executionToken==null && previousToken==null
            val retry=previousToken!=null && previousToken==job.executionToken &&
                (job.status=="failed" || (job.status=="running" && job.deadline?.isAfter(now)==false))
            if(!initial && !retry) throw WorldConflict()
            val token=UUID.randomUUID()
            job.status="running";job.executionToken=token;job.deadline=deadline;job.failureCode=null
            jobs.flush()
            token
        })
    }

    /** 이전 worker의 실패 응답으로 재개한 실행이나 적재 결과를 덮어쓰지 않는다. */
    fun fail(id:UUID,owner:UUID,token:UUID,code:String) {
        require(code.matches(Regex("[A-Z][A-Z0-9_]{0,99}")))
        transaction.executeWithoutResult {
            val job=owned(id,owner)
            if(job.status!="running" || job.executionToken!=token) throw WorldConflict()
            job.status="failed";job.failureCode=code
            jobs.flush()
        }
    }
}
