package ai.storyfork.content.episode

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import java.util.UUID
import java.util.concurrent.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest(properties=["DATABASE_URL=\${TEST_CONTENT_DATABASE_URL}","DATABASE_USER=content_test","DATABASE_PASSWORD="])
class EpisodeConcurrencyPostgresTest {
    @Autowired lateinit var works: WorkService
    @Autowired lateinit var episodes: EpisodeService
    @Autowired lateinit var access: ai.storyfork.content.work.service.WorkAccessService
    @Autowired lateinit var repository: ai.storyfork.content.work.repository.WorkRepository
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("contentTransactions")
    lateinit var transaction: org.springframework.transaction.support.TransactionTemplate

    @Test fun `locking refreshes a work loaded before another editor committed`() {
        val owner=UUID.randomUUID().toString()
        val work=works.create(owner,CreateWorkRequest("잠금 전 조회"))
        transaction.executeWithoutResult {
            assertEquals(0,repository.findById(work.id).orElseThrow().revision)
            CompletableFuture.runAsync {episodes.update(work.id,owner,1,DraftRequest("새 제목","새 원고",0))}.get(20,TimeUnit.SECONDS)
            assertEquals(1,access.own(work.id,owner).revision)
        }
    }
    private fun <T> race(action: (Int)->T): List<T> {
        val start=CountDownLatch(1)
        val pool=Executors.newFixedThreadPool(2)
        try {
            val tasks=(1..2).map {i -> pool.submit<T> {start.await();action(i)}}
            start.countDown()
            return tasks.map {it.get(20,TimeUnit.SECONDS)}
        } finally {pool.shutdownNow();assertTrue(pool.awaitTermination(5,TimeUnit.SECONDS))}
    }
    @Test fun `concurrent creation reserves distinct episode sequences`() {
        val owner=UUID.randomUUID().toString();val work=works.create(owner,CreateWorkRequest("동시 생성"))
        val created=race {episodes.create(work.id,owner,CreateEpisodeRequest("$it 회차"))}
        assertEquals(setOf(2,3),created.map {it.number}.toSet())
        assertEquals(listOf(1,2,3),episodes.list(work.id,owner).items.map {it.number})
    }
    @Test fun `concurrent edits have one winner and stale text never overwrites it`() {
        val owner=UUID.randomUUID().toString();val work=works.create(owner,CreateWorkRequest("동시 편집"))
        val result=race {i ->
            try {episodes.update(work.id,owner,1,DraftRequest("제목","원고 $i",0));200}
            catch(error: ContentFailure) {error.status}
        }
        assertEquals(listOf(200,409),result.sorted())
        val after=episodes.read(work.id,owner,1)
        assertEquals(1,after.draft.revision)
        assertTrue(after.draft.body in listOf("원고 1","원고 2"))
        assertTrue(after.versions.isEmpty())
    }
    @Test fun `first concurrent works share a credential-free member reference`() {
        val owner=UUID.randomUUID().toString()
        val created=race {works.create(owner,CreateWorkRequest("동시 작품 $it"))}
        assertEquals(2,created.map {it.id}.toSet().size)
        assertEquals(2,works.list(owner).items.size)
    }
}
