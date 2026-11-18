package ai.storyfork.content.search

import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.service.SearchIndexChanges
import ai.storyfork.content.search.service.SearchIndexJob
import ai.storyfork.content.search.service.SearchIndexSync
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldSearchEntry
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.argThat
import org.mockito.Mockito.*
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * 주기 대조 작업(#505): 공개 대상 읽기는 트랜잭션 밖에서 먼저 하고, 트랜잭션 단위 advisory lock 트랜잭션은 잠금과 색인 쓰기만 감싼다.
 * JDBC·서비스·색인은 대역이고, 트랜잭션 매니저 대역이 시작~커밋·롤백 사이에만 [inTransaction]을 true로 두어 호출 때의 상태를 기록한다.
 */
class SearchIndexJobTest {
    private val db = mock(JdbcClient::class.java, RETURNS_DEEP_STUBS)
    private var inTransaction = false
    private val status = SimpleTransactionStatus()
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { inTransaction = true; status }
        doAnswer { inTransaction = false; null }.`when`(it).commit(status)
        doAnswer { inTransaction = false; null }.`when`(it).rollback(status)
    }
    private val works = mock(WorkService::class.java)
    private val worlds = mock(PublicWorldService::class.java)
    private val sync = mock(SearchIndexSync::class.java)
    private val job = SearchIndexJob(db, TransactionTemplate(manager), works, worlds, sync)
    private val seen = mutableListOf<String>()
    private val work = WorkResponse(id = "w1", title = "작품", summary = "", visibility = "public", allowFork = false, allowForkPublication = false, source = null,
        episodes = emptyList(), draft = null, authorName = "작가")
    private val logger = LoggerFactory.getLogger(SearchIndexJob::class.java) as Logger
    private val logs = ListAppender<ILoggingEvent>().also { it.start(); logger.addAppender(it) }

    @AfterEach fun detachLogs() {
        logger.detachAppender(logs)
    }

    private fun lock(acquired: Boolean) {
        `when`(db.sql(anyString()).query(Boolean::class.javaObjectType).single()).thenReturn(acquired)
    }

    @Test fun `the public targets are read before and outside the transaction, which holds only the lock and the index writes`() {
        lock(true)
        val wanted = listOf(workDocument("w1", "작품", "작가", emptyList(), emptyList()))
        `when`(works.searchable()).thenAnswer { seen += "works:$inTransaction"; listOf(work) }
        `when`(worlds.searchEntries()).thenAnswer { seen += "worlds:$inTransaction"; emptyList<PublicWorldSearchEntry>() }
        `when`(sync.reconcile(wanted)).thenAnswer { seen += "sync:$inTransaction"; SearchIndexChanges(put = 1, removed = 0) }

        job.reconcile()

        // 세계관(WorldStudio) 읽기는 같은 DataSource 위에서 다른 JpaTransactionManager가 시작하는 것이라 이미 열린 Content 트랜잭션 안에서는 열 수 없다(IllegalTransactionStateException).
        assertEquals(listOf("works:false", "worlds:false", "sync:true"), seen)
        // 잠금은 트랜잭션 안에서 얻고, 커밋(또는 롤백)이 곧 해제다.
        val ordered = inOrder(manager, db, sync)
        ordered.verify(manager).getTransaction(any())
        ordered.verify(db).sql(argThat<String> { it.contains("pg_try_advisory_xact_lock(1398031947, 57)") } ?: "")
        ordered.verify(sync).reconcile(wanted)
        ordered.verify(manager).commit(status)
    }

    @Test fun `a lock held elsewhere skips the index writes after the reads`() {
        lock(false)

        job.reconcile()

        verify(works).searchable()
        verify(worlds).searchEntries()
        verifyNoInteractions(sync)
        verify(manager).commit(status)
    }

    @Test fun `a failed read never opens the transaction or touches the index and is retried next cycle`() {
        `when`(worlds.searchEntries()).thenThrow(IllegalStateException("Core down"))

        job.reconcile()

        verify(manager, never()).getTransaction(any())
        verifyNoInteractions(db, sync)
    }

    @Test fun `a failure while writing the index rolls the transaction back, which releases the lock, and is retried next cycle`() {
        lock(true)
        `when`(sync.reconcile(emptyList())).thenThrow(IllegalStateException("bulk failed"))

        job.reconcile()

        verify(manager).rollback(status)
        verify(manager, never()).commit(status)
    }

    @Test fun `a failure is logged with its message, not only its class, so the cause can be traced`() {
        `when`(works.searchable()).thenThrow(IllegalStateException("Core down"))

        job.reconcile()

        val warning = logs.list.single { it.level == Level.WARN }.formattedMessage
        assertTrue(warning.contains("IllegalStateException") && warning.contains("Core down"), warning)
    }
}
