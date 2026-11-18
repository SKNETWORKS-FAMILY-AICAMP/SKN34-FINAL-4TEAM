package ai.storyfork.content.search.service

import ai.storyfork.content.search.domain.SearchDocument
import ai.storyfork.content.search.domain.cardDocument
import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.domain.worldDocument
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldSearchEntry
import javax.sql.DataSource
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled

/** 지금 공개 대상(공개 작품, 공개 세계관과 그 세계관의 보이는 카드)을 색인 문서로 바꾼다. 카드는 세계관 문서 뒤에 붙는다. */
internal fun searchDocuments(works: List<WorkResponse>, worlds: List<PublicWorldSearchEntry>): List<SearchDocument> =
    works.map { workDocument(it.id, it.title, it.authorName, it.hashtags, it.genres) } +
        worlds.flatMap { world ->
            listOf(worldDocument(world.worldId, world.name, world.description, world.author)) +
                world.cards.map { cardDocument(it.cardId, world.worldId, it.title, it.aliases, it.tags) }
        }

/**
 * 주기마다 지금 공개 대상과 색인을 맞춘다(추가·갱신·삭제, #505). 새로 공개된 것은 최대 한 주기 늦게 검색되고, 비공개 노출은 검색 때 DB 재확인이 막는다.
 * 대상은 검색이 읽는 것과 같은 서비스 읽기([WorkService.searchable]·[PublicWorldService.searchEntries])로 정한다.
 */
internal class SearchIndexJob(
    private val dataSource: DataSource,
    private val works: WorkService,
    private val worlds: PublicWorldService,
    private val sync: SearchIndexSync,
) {
    private val log = LoggerFactory.getLogger(SearchIndexJob::class.java)

    @Scheduled(fixedDelayString = "\${app.search-index.interval-ms}", scheduler = "searchIndexScheduler")
    fun reconcile() {
        try {
            // 세션 단위 advisory lock이다: 대조하는 동안 이 연결 하나만 쥐고(다른 Content 인스턴스는 건너뛴다), 트랜잭션을 열지 않아 작품(Content)·세계관(WorldStudio) 읽기와 겹치지 않는다.
            dataSource.connection.use { lock ->
                if (!lock.createStatement().use { st -> st.executeQuery("SELECT pg_try_advisory_lock(1398031947, 57)").use { it.next() && it.getBoolean(1) } }) return
                try {
                    // ponytail: 주기마다 공개 작품·세계관·카드 전체를 읽어 색인과 대조한다(시연 규모). 느려지면 변경 행 기반으로 바꾼다.
                    val changes = sync.reconcile(searchDocuments(works.searchable(), worlds.searchEntries()))
                    if (changes.put != 0 || changes.removed != 0) log.info("search index reconciled: put={} removed={}", changes.put, changes.removed)
                } finally {
                    lock.createStatement().use { it.execute("SELECT pg_advisory_unlock(1398031947, 57)") }
                }
            }
        } catch (error: RuntimeException) {
            log.warn("search index reconciliation failed; retrying next cycle: {}", error.javaClass.simpleName)
        }
    }
}
