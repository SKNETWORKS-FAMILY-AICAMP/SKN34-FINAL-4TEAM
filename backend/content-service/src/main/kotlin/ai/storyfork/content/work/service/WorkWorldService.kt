package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.fork.repository.ForkWorldReferenceRepository
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.controller.WorldStudioExceptionHandler
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.forkWorldCopy
import ai.storyfork.content.world.domain.legacyWorldCopy
import ai.storyfork.content.world.domain.readerUpto
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldCoverImage
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataAccessException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.TransactionException
import org.springframework.transaction.support.TransactionTemplate

/**
 * 세계관(WorldStudio)과 소설의 1:1 연결(DEC-46)과 그 연결로 읽는 독자 설정 위키다. 연결은 `work.world_studio_id`(UNIQUE) 하나에만 저장한다.
 * 작품은 Content, 세계관은 WorldStudio 트랜잭션이라 둘을 겹치지 않고 차례로 연다([ai.storyfork.content.episode.service.EpisodeWorldBasisService]와 같은 방식).
 */
@Service
class WorkWorldService(
    private val access: WorkAccessService, private val works: WorkRepository, private val publication: PublicationService,
    private val studios: StudioWorldRepository, private val publicWorlds: PublicWorldService, private val references: ForkWorldReferenceRepository,
    private val worldStudio: WorldStudioService, private val legacyWorlds: WorldService, @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    private val log = org.slf4j.LoggerFactory.getLogger(javaClass)
    private val studioErrors = WorldStudioExceptionHandler()

    /**
     * 요청자 [owner]의 작품에 요청자의 세계관을 연결한다. [worldId]가 null이면 해제한다. 작품이든 세계관이든 없거나 남의 것이면(지운 세계관 포함) 404다.
     * 그 세계관이 이미 다른 작품에 연결돼 있으면 409 `WORLD_ALREADY_LINKED`이며, 판정은 UNIQUE 제약이 한다(동시 요청도 같은 답이다).
     * 같은 세계관을 다시 연결해도 결과가 같고 작품 revision은 올리지 않는다.
     */
    fun link(workId: String, owner: String, worldId: UUID?): WorkWorldLinkResponse {
        if (worldId != null && studios.findById(worldId).orElse(null)?.takeIf { it.deletedAt == null }?.ownerSubject?.toString() != owner) throw ContentFailure(404, "세계관을 찾을 수 없어요.")
        try {
            transaction.executeWithoutResult {
                access.own(workId, owner)
                val row = works.findById(workId).orElseThrow()
                row.worldStudioId = worldId
                works.saveAndFlush(row)
            }
        } catch (_: DataIntegrityViolationException) {
            // 이 트랜잭션이 쓰는 값은 world_studio_id 하나라, 제약 위반은 그 세계관을 다른 작품이 쥐고 있다는 뜻이다.
            throw ContentFailure(409, "이미 다른 소설에 연결된 세계관이에요.", "WORLD_ALREADY_LINKED")
        }
        return WorkWorldLinkResponse(workId, worldId)
    }

    /** 요청자 [owner]의 작품 [workId]에 연결된 세계관 id다. 연결이 없으면 null, 작품이 없거나 남의 것이면 404다. */
    fun linkedWorldId(workId: String, owner: String): UUID? = transaction.execute {
        access.own(workId, owner)
        works.findById(workId).orElseThrow().worldStudioId
    }

    /** [worldIds] 가운데 작품에 연결된 세계관과 그 작품 id다. 삭제된 작품은 삭제할 때 연결이 해제돼 나오지 않는다. */
    fun linkedWorkIds(worldIds: Collection<UUID>): Map<UUID, String> =
        if (worldIds.isEmpty()) emptyMap()
        else works.findAllByWorldStudioIdIn(worldIds).mapNotNull { work -> work.worldStudioId?.let { it to work.id } }.toMap()

    /**
     * 공개 소설의 독자에게 [upto]화 기준으로 보이는 연결 세계관의 설정 카드다. 기준은 발행된 마지막 회차를 넘지 못하고 [upto]가 없으면 그 마지막 회차다.
     * 없는(삭제된) 작품은 404, 값 오류는 어떤 조회보다 먼저 422다. 공개가 아닌 작품은 연결 여부도 알리지 않고 빈 목록을, 연결이 없는 작품도 빈 목록을 돌려준다.
     * 발행 회차 번호만 쓰므로 독자용 본문 가공([ai.storyfork.content.work.service.dto.WorkAccessResult.readerEpisodes])은 거치지 않는다.
     */
    fun readerCards(workId: String, upto: String?): ReaderWorldCardsResponse {
        val (worldId, basis) = readerBasis(workId, upto)
        return if (worldId == null) ReaderWorldCardsResponse(workId, null, basis) else publicWorlds.readerCards(workId, worldId, basis)
    }

    /**
     * Fork [workId]가 자기 세계관 없이 이어받는 원작 세계관이다(읽기 전용, DEC-32·37, #365). 요청자 [owner]의 Fork여야 하며 아니면 404, [upto] 값 오류는 어떤 조회보다 먼저 422다.
     * 이어받는 조건은 Fork에 자기 연결 세계관이 없고, 추종(`following`) 중이며, 삭제되지 않은 원작에 세계관이 연결돼 있을 때다. 하나라도 아니면 [InheritedWorldResponse.worldId]가 null이다
     * (자기 세계관이 우선이고 독립한 Fork는 이어받지 않는다). 지식 상한은 Fork 기준 회차이며 [upto]가 더 작으면 그 회차까지다(Fork의 자기 회차 내용은 원작 세계관에 없다).
     * 카드·관계는 [PublicWorldService.inheritedWorld]가 유효 공개 회차·상한 회차로 거른다.
     */
    fun inheritedWorld(workId: String, owner: String, upto: String?): InheritedWorldResponse {
        val requested = readerUpto(upto)
        val (worldId, basis) = checkNotNull(transaction.execute { inheritance(access.own(workId, owner)) })
        return if (worldId == null) InheritedWorldResponse(workId, null, 0)
        else publicWorlds.inheritedWorld(workId, worldId, minOf(requested ?: basis, basis))
    }

    /**
     * Fork [workId]가 자기 세계관 없이 원작 세계관을 이어받는지다([inheritedWorld]와 같은 판정이고 이어받는 세계관은 읽지 않는다). 요청자 [owner]의 작품이 아니면 404다.
     * 첫 발행에서 세계관이 없는 소설에 비공개 세계관을 자동으로 만들 때 이런 Fork를 뺀다(DEC-53 보완, [ai.storyfork.content.preprocessing.service.PreprocessingService.startUpdate]).
     */
    fun inheritsWorld(workId: String, owner: String): Boolean = checkNotNull(transaction.execute { inheritance(access.own(workId, owner)).first != null })

    /** Fork [work]가 따라가는 원작이다: 추종(`following`) 중이고 자기 세계관이 없으며 삭제되지 않은 원작이 있을 때만이고, 아니면 null이다. Content 트랜잭션 안에서 부른다. */
    private fun followed(work: WorkAccessResult) = work.source?.takeUnless { it.deleted }?.takeIf {
        references.findById(work.id).orElse(null)?.referenceStatus == "following" && works.findById(work.id).orElseThrow().worldStudioId == null
    }

    /** Fork [work]가 이어받는 원작 세계관(이어받을 것이 없으면 null)과 지식 상한인 Fork 기준 회차다. 읽기([inheritedWorld])와 독립([detachInheritedWorld])이 같은 판정을 쓴다. Content 트랜잭션 안에서 부른다. */
    private fun inheritance(work: WorkAccessResult): Pair<UUID?, Int> {
        val source = followed(work)
        return source?.let { works.findById(it.workId).orElseThrow().worldStudioId } to (source?.episode ?: 0)
    }

    /**
     * Fork [workId]가 이어받는 원작 세계관을 요청자 [owner]의 새 세계관으로 독립한다(DEC-37, #583). [inheritedWorld]와 같은 카드·관계([PublicWorldService.inheritedSource])를 [forkWorldCopy]로 복사해
     * 이름 `{작품 제목} 세계관`의 비공개 세계관 초안에 한 번 저장하고(저장 버전 1, 확정 버전은 만들지 않는다: 작가가 고친 뒤 남긴다) 작품에 연결하며 참조를 `independent`로 바꾼다.
     * 원작에 세계관이 연결돼 있지 않은 옛 작품 설정집 방식 Fork(추종 중이고 자기 세계관이 없음)는 따라가던 설정([WorldService.followingSettings])을 [legacyWorldCopy]로 카드로 복사하고 나머지는 같다(#737).
     * 순서: ① Content 트랜잭션에서 소유·조건 확인 → ② 원작 읽기 → ③ WorldStudio 생성·초안 편집(Content 트랜잭션과 겹치면 매니저가 달라 실패한다) → ④ Content 트랜잭션에서 참조 행을 잠그고 재확인한 뒤 연결.
     * ③ 이후의 실패(④ 재확인 실패 = 동시에 먼저 끝난 요청이 있음 포함)는 만든 세계관을 소프트 삭제하고 알린다. 남의·없는 작품 404, 이어받을 것(복사할 카드·설정)이 없으면 409 `FORK_WORLD_NOT_INHERITED`, 관계 저장소 불확실 503이며 어느 쪽도 세계관을 만들지 않는다.
     * WorldStudio 호출의 실패는 WorldStudio API와 같은 상태·code로 옮긴다([studioCall]).
     */
    fun detachInheritedWorld(workId: String, owner: String): WorkWorldLinkResponse {
        val (work, inherited, settingsBook) = checkNotNull(transaction.execute {
            val own = access.own(workId, owner)
            val inheriting = inheritance(own)
            Triple(own, inheriting, inheriting.first == null && followed(own) != null)
        })
        val (sourceWorld, basis) = inherited
        if (sourceWorld == null && !settingsBook) throw notInherited()
        val source = sourceWorld?.let { publicWorlds.inheritedSource(workId, it, basis) ?: throw notInherited() }
        if (source != null && source.world.relationshipStatus != "current") throw ContentFailure(503, "원작 세계관의 관계를 확인하지 못해 세계관을 만들지 않았어요. 잠시 뒤 다시 시도해 주세요.")
        // 원작에 세계관이 없으면 옛 작품 설정집을 따라가던 Fork다: 그 설정이 복사할 원본이고, 없으면 독립할 것이 없다.
        val settings = if (source == null) legacyWorlds.followingSettings(workId, owner).ifEmpty { throw notInherited() } else emptyList()
        val subject = UUID.fromString(owner)
        val world = UUID.randomUUID()
        try {
            // 세계관 이름은 100자까지라 작품 제목(120자까지)을 잘라 맞춘다. 서로게이트 쌍 가운데서 잘리면 짝 잃은 글자를 뺀다.
            val name = "${work.title.take(96).dropLastWhile(Char::isHighSurrogate)} 세계관"
            val created = studioCall { worldStudio.create(subject, CreateWorldRequest(name, "", world)) }
            val key = UUID.randomUUID().toString()
            val copy = if (source != null) forkWorldCopy(source, created.draftRevision, name, key) else legacyWorldCopy(settings, created.draftRevision, name, key)
            studioCall { worldStudio.edit(world, subject, copy) }
            transaction.executeWithoutResult { connect(workId, owner, sourceWorld, world) }
        } catch (error: RuntimeException) {
            discard(world, subject)
            throw error
        }
        return WorkWorldLinkResponse(workId, world)
    }

    /**
     * ④: 작품 행(기존 경로와 같은 작품 → 참조 행 순서)과 참조 행을 잠그고 조건을 다시 확인한 뒤 [world]를 연결하고 참조를 독립으로 바꾼다. [sourceWorld]는 복사한 원작 세계관이고 옛 설정집 방식이면 null이다.
     * 확인 뒤 그 사이 먼저 끝난 요청이 있으면(참조가 이미 독립이거나 자기 세계관이 생김) 또는 이어받는 세계관이 읽을 때와 달라졌으면(원작에 세계관이 새로 연결됨) 409다. Content 트랜잭션 안에서 부른다.
     */
    private fun connect(workId: String, owner: String, sourceWorld: UUID?, world: UUID) {
        val work = access.own(workId, owner)
        val reference = references.lockById(workId)
        if (followed(work) == null || inheritance(work).first != sourceWorld) throw notInherited()
        val row = works.findById(workId).orElseThrow()
        row.worldStudioId = world
        works.saveAndFlush(row)
        checkNotNull(reference).apply {
            referenceStatus = "independent"
            detachedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        }
    }

    /**
     * ③의 WorldStudio 호출이 던지는 실패를 WorldStudio API와 같은 상태·code·detail의 [ContentFailure]로 옮긴다. [WorldStudioExceptionHandler]를 그대로 써서 어긋나지 않게 한다(MCP 도구와 같은 방식).
     * WorkWorldController는 그 처리기 대상이 아니다: 컨트롤러 전체에 씌우면 기존 연결·독자 위키·이어받기의 DB 오류와 경로 값 오류 응답이 바뀐다. 그래서 독립 경로가 WorldStudio 호출만 직접 옮기고 그 밖의 실패는 그대로 둔다.
     */
    private fun <T> studioCall(call: () -> T): T = try {
        call()
    } catch (error: RuntimeException) {
        val answer = when (error) {
            is WorldStudioFailure -> studioErrors.failure(error)
            is WorldNotFound -> studioErrors.missing()
            is WorldConflict -> studioErrors.conflict()
            is IllegalArgumentException -> studioErrors.invalid()
            is DataAccessException, is TransactionException -> studioErrors.persistence()
            else -> throw error
        }
        val body = checkNotNull(answer.body)
        throw ContentFailure(answer.statusCode.value(), body.detail, body.code)
    }

    /** 독립에 실패해 연결하지 못한 새 세계관을 기존 소프트 삭제로 지운다. 지우기가 실패해도 원래 실패를 가리지 않고 기록만 남긴다. */
    private fun discard(world: UUID, subject: UUID) {
        try {
            worldStudio.delete(world, subject, false)
        } catch (_: WorldNotFound) {
            // 세계관을 만들기 전에 실패했다.
        } catch (error: RuntimeException) {
            log.warn("Fork 독립에 실패한 세계관 {}을 지우지 못했어요: {}", world, error.javaClass.simpleName)
        }
    }

    private fun notInherited() = ContentFailure(409, "이어받는 원작 세계관이 없어서 독립할 수 없어요.", "FORK_WORLD_NOT_INHERITED")

    /**
     * 독자 설정 위키 카드의 이미지다(#401). [readerCards]와 같은 기준(공개 작품·연결 세계관·기준 회차)으로 보이는 카드 중 하나가 [imageId]로 가리키는 이미지일 때만 돌려주고,
     * 그 밖(공개가 아닌 작품·연결 없음 포함)은 404다. 없는(삭제된) 작품은 404, [upto] 값 오류는 어떤 조회보다 먼저 422다.
     */
    fun readerCardImage(workId: String, imageId: UUID, upto: String?): WorldCoverImage {
        val (worldId, basis) = readerBasis(workId, upto)
        return publicWorlds.readerCardImage(worldId ?: throw ContentFailure(404, "이미지를 찾을 수 없습니다."), basis, imageId)
    }

    /** 독자 설정 위키의 기준이다: 연결된 세계관(공개가 아닌 작품·연결 없음은 null)과 기준 회차(요청 회차, 발행된 마지막 회차를 넘지 못하며 운영이 제한한 회차는 독자에게 없으므로 세지 않는다). */
    private fun readerBasis(workId: String, upto: String?): Pair<UUID?, Int> {
        val requested = readerUpto(upto)
        val (worldId, published) = checkNotNull(transaction.execute {
            val work = access.get(workId)
            checkContent(!work.deleted, 404, "작품을 찾을 수 없어요.")
            if (!work.publiclyVisible()) null to 0
            else works.findById(workId).orElseThrow().worldStudioId to (publication.publishedEpisodes(workId).items.filterNot { it.restricted }.maxOfOrNull { it.number } ?: 0)
        })
        return worldId to minOf(requested ?: published, published)
    }
}
