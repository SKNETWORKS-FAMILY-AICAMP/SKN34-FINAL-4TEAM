package ai.storyfork.content.search.service

import ai.storyfork.content.search.domain.SearchDocument
import ai.storyfork.content.search.domain.cardDocument
import ai.storyfork.content.search.domain.workDocument
import ai.storyfork.content.search.domain.worldDocument
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.WorkResponse
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.PublicWorldSearchEntry
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.transaction.support.TransactionTemplate

/** 지금 공개 대상(공개 작품, 공개 세계관과 그 세계관의 보이는 카드)을 색인 문서로 바꾼다. 카드는 세계관 문서 뒤에 붙는다. */
internal fun searchDocuments(works: List<WorkResponse>, worlds: List<PublicWorldSearchEntry>): List<SearchDocument> =
    works.map { workDocument(it.id, it.title, it.authorName, it.hashtags, it.genres) } +
        worlds.flatMap { world ->
            listOf(worldDocument(world.worldId, world.name, world.description, world.author)) +
                world.cards.map { cardDocument(it.cardId, world.worldId, it.title, it.aliases, it.tags) }
        }

/**
 * 주기마다 지금 공개 대상과 색인을 맞춘다(추가·갱신·삭제, #505). 새로 공개된 것은 최대 한 주기 늦게 검색되고, 비공개 노출은 검색 때 DB 재확인이 막는다.
 * 대상은 검색이 읽는 것과 같은 서비스 읽기([WorkService.searchable]·[PublicWorldService.searchEntries])로 정하며 **트랜잭션 밖에서 먼저** 읽는다.
 * advisory lock 트랜잭션은 잠금과 색인 쓰기(HTTP)만 감싼다.
 */
internal class SearchIndexJob(
    private val db: JdbcClient,
    private val transactions: TransactionTemplate,
    private val works: WorkService,
    private val worlds: PublicWorldService,
    private val sync: SearchIndexSync,
) {
    private val log = LoggerFactory.getLogger(SearchIndexJob::class.java)

    @Scheduled(fixedDelayString = "\${app.search-index.interval-ms}", scheduler = "searchIndexScheduler")
    fun reconcile() {
        try {
            // 읽기는 트랜잭션 밖에서 먼저 한다. 세계관(WorldStudio) 읽기는 같은 DataSource 위에서 다른 JpaTransactionManager가 시작하는 것이라, 이미 열린 Content 트랜잭션 안에서는 연결이 묶여 있어 IllegalTransactionStateException이 난다.
            // ponytail: 주기마다 공개 작품·세계관·카드 전체를 읽어 색인과 대조한다(시연 규모). 느려지면 변경 행 기반으로 바꾼다.
            val wanted = searchDocuments(works.searchable(), worlds.searchEntries())
            transactions.executeWithoutResult {
                // 트랜잭션 단위 advisory lock이다(원고 색인과 같은 방식): 커밋·롤백이 곧 해제라 해제에 실패해 풀 연결이 잠금을 쥔 채 남는 일이 없다. 다른 Content 인스턴스는 건너뛴다.
                if (!db.sql("SELECT pg_try_advisory_xact_lock(1398031947, 57)").query(Boolean::class.javaObjectType).single()) return@executeWithoutResult
                val changes = sync.reconcile(wanted)
                if (changes.put != 0 || changes.removed != 0) log.info("search index reconciled: put={} removed={}", changes.put, changes.removed)
            }
        } catch (error: RuntimeException) {
            // 원인 추적을 위해 클래스뿐 아니라 메시지도 남긴다(색인·Core·DB 오류 메시지에 비밀 값은 없다).
            log.warn("search index reconciliation failed; retrying next cycle: {}", error.toString())
        }
    }
}
