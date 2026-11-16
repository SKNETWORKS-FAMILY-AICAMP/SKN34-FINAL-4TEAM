package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.service.dto.WorldCoverImage
import ai.storyfork.content.world.service.dto.WorldCoverResponse
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 소유자가 올린 세계관 표지의 저장·삭제·조회다. 이미지 바이트는 첨부와 같은 객체 저장소에 두고 `worldstudio.world`(V7)에는 키와 형식만 둔다.
 * 객체 저장소 호출은 DB 트랜잭션 밖이며, 그 실패는 [coverStorage]가 세계관 API의 공개 실패(503 등)로 바꾼다. 공개 읽기는 [PublicWorldService.cover]다.
 */
@Service
class WorldCoverService(
    private val worlds: StudioWorldRepository, private val storage: AttachmentStorageClient,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val transaction = TransactionTemplate(manager)
    private fun <T : Any> tx(action: () -> T): T = transaction.execute { action() }
    private fun owned(id: UUID, subject: UUID) = worlds.lockOwned(id, subject) ?: throw WorldNotFound()

    /**
     * 표지를 저장하거나 교체한다. 소유 세계관인지 먼저 확인하고(잠금은 짧은 트랜잭션뿐) 새 객체를 저장한 **뒤에** DB가 그 객체를 가리키게 하며,
     * 이전 객체는 그 다음에 지운다. 이전 객체를 못 지워도 응답은 성공이고 로그만 남긴다.
     * ponytail: DB 갱신이 실패하면 새 객체가, 이전 객체 삭제가 실패하면 이전 객체가 객체 저장소에 남는다. 정리는 운영자 몫이고 보상 트랜잭션은 두지 않는다.
     */
    fun put(worldId: UUID, subject: UUID, cover: WorldCoverFile): WorldCoverResponse {
        tx { owned(worldId, subject) }
        val key = "world-covers/${UUID.randomUUID()}"
        coverStorage { storage.upload(key, AttachmentObjectPayload(cover.bytes, cover.contentType)) }
        point(worldId, subject, key, cover.contentType)?.let(::discard)
        return WorldCoverResponse(worldId, true)
    }

    /** 표지 참조를 먼저 지우고 객체를 그 다음에 지운다(객체 삭제 실패는 로그만). 표지가 없어도 성공이다(멱등). */
    fun delete(worldId: UUID, subject: UUID) {
        point(worldId, subject, null, null)?.let(::discard)
    }

    /** 세계관의 표지 참조를 바꾸고(지우려면 null) 바뀌기 전 객체 키를 돌려준다. */
    private fun point(worldId: UUID, subject: UUID, key: String?, type: String?): String? {
        var previous: String? = null
        tx {
            val world = owned(worldId, subject)
            previous = world.coverObjectKey
            world.coverObjectKey = key
            world.coverContentType = type
        }
        return previous
    }

    /** 소유자에게 저장된 표지를 돌려준다. 남의 세계관은 404(WorldNotFound), 표지가 없으면 404(ContentFailure)다. */
    fun read(worldId: UUID, subject: UUID): WorldCoverImage {
        val world = tx { worlds.findById(worldId).orElse(null)?.takeIf { it.ownerSubject == subject } ?: throw WorldNotFound() }
        val key = world.coverObjectKey
        val type = world.coverContentType
        if (key == null || type == null) throw ContentFailure(404, "세계관 표지를 찾을 수 없습니다.")
        return WorldCoverImage(coverStorage { storage.read(key).bytes }, type)
    }

    private fun discard(key: String) {
        try { storage.delete(key) } catch (e: RuntimeException) { log.warn("세계관 표지 객체를 지우지 못해 남겨 둡니다: {} ({})", key, e.message) }
    }
}
