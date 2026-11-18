package ai.storyfork.content.search

import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.service.SearchIndexChanges
import ai.storyfork.content.search.service.SearchIndexJob
import ai.storyfork.content.search.service.SearchIndexSync
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.PublicWorldService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.argThat
import org.mockito.Mockito.*
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/** 주기 대조 작업(#505): 트랜잭션 단위 advisory lock을 쥔 한 트랜잭션 안에서 읽고 대조한다. JDBC·트랜잭션 매니저·서비스·색인은 대역이다. */
class SearchIndexJobTest {
    private val db = mock(JdbcClient::class.java, RETURNS_DEEP_STUBS)
    private val status = SimpleTransactionStatus()
    private val manager = mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenReturn(status) }
    private val works = mock(WorkService::class.java)
    private val worlds = mock(PublicWorldService::class.java)
    private val sync = mock(SearchIndexSync::class.java)
    private val job = SearchIndexJob(db, TransactionTemplate(manager), works, worlds, sync)
    private val work = WorkResponse(id = "w1", title = "작품", summary = "", visibility = "public", allowFork = false, allowForkPublication = false, source = null,
        episodes = emptyList(), draft = null, authorName = "작가")

    private fun lock(acquired: Boolean) {
        `when`(db.sql(anyString()).query(Boolean::class.javaObjectType).single()).thenReturn(acquired)
    }

    @Test fun `the run takes a transaction-level advisory lock and reads and syncs inside that one transaction`() {
        lock(true)
        `when`(works.searchable()).thenReturn(listOf(work))
        `when`(worlds.searchEntries()).thenReturn(emptyList())
        val wanted = listOf(workDocument("w1", "작품", "작가", emptyList(), emptyList()))
        `when`(sync.reconcile(wanted)).thenReturn(SearchIndexChanges(put = 1, removed = 0))

        job.reconcile()

        // 트랜잭션 단위 잠금이라 커밋·롤백이 곧 해제다(세션 잠금처럼 풀 연결에 남지 않는다).
        val ordered = inOrder(manager, db, works, worlds, sync)
        ordered.verify(manager).getTransaction(any())
        ordered.verify(db).sql(argThat<String> { it.contains("pg_try_advisory_xact_lock(1398031947, 57)") } ?: "")
        ordered.verify(works).searchable()
        ordered.verify(worlds).searchEntries()
        ordered.verify(sync).reconcile(wanted)
        ordered.verify(manager).commit(status)
    }

    @Test fun `a lock held elsewhere reads and syncs nothing`() {
        lock(false)

        job.reconcile()

        verifyNoInteractions(works, worlds, sync)
        verify(manager).commit(status)
    }

    @Test fun `a failure inside the run rolls the transaction back, which releases the lock, and is retried next cycle`() {
        lock(true)
        `when`(works.searchable()).thenThrow(IllegalStateException("Core down"))

        job.reconcile()

        verify(manager).rollback(status)
        verify(manager, never()).commit(status)
        verifyNoInteractions(sync)
    }
}
