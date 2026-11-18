package ai.storyfork.content.world.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.world.domain.WorldCoverFile
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.coverStorage
import ai.storyfork.content.world.service.dto.WorldCardImageResponse
import ai.storyfork.content.world.service.dto.WorldCoverImage
import ai.storyfork.content.world.studio.entity.SettingCardImage
import ai.storyfork.content.world.studio.repository.SettingCardImageRepository
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 소유자가 올린 설정 카드 대표 이미지의 저장·읽기다(#401). 바이트는 세계관 표지와 같은 객체 저장소의 `world-card-images/<id>` 키에, [SettingCardImage](V8)에는 키와 형식만 둔다.
 * 올린 이미지는 바뀌거나 지워지지 않는다(교체는 새 이미지를 올리고 카드가 새 ID를 가리킴). 객체 저장소 실패는 [coverStorage]가 공개 실패(503 등)로 바꾼다. 공개 읽기는 [PublicWorldService]다.
 */
@Service
class WorldCardImageService(
    private val worlds: StudioWorldRepository, private val images: SettingCardImageRepository, private val storage: AttachmentStorageClient,
    @Qualifier("worldStudioTransactionManager") manager: PlatformTransactionManager,
) {
    private val transaction = TransactionTemplate(manager)
    private fun <T : Any> tx(action: () -> T): T = transaction.execute { action() }

    /**
     * 이미지를 저장하고 새 ID를 돌려준다. 소유 세계관인지 먼저 확인하고(잠금은 짧은 트랜잭션뿐) 객체를 저장한 **뒤에** DB 행을 만든다.
     * 행이 먼저면 카드가 가리킬 수 있는데 바이트가 없는 이미지가 생길 수 있다.
     * ponytail: DB 기록이 실패하면 객체가 객체 저장소에 남는다(어떤 행도 가리키지 않는다). 정리는 운영자 몫이고 보상 트랜잭션은 두지 않는다.
     */
    fun put(worldId: UUID, subject: UUID, image: WorldCoverFile): WorldCardImageResponse {
        tx { worlds.lockOwned(worldId, subject) ?: throw WorldNotFound() }
        val id = UUID.randomUUID()
        val key = "world-card-images/$id"
        coverStorage { storage.upload(key, AttachmentObjectPayload(image.bytes, image.contentType)) }
        transaction.executeWithoutResult { images.save(SettingCardImage(id, worldId, key, image.contentType)) }
        return WorldCardImageResponse(id, image.contentType)
    }

    /** 소유자에게 저장된 이미지를 돌려준다. 남의·지운 세계관은 404(WorldNotFound), 없는 ID·다른 세계관의 ID는 404(ContentFailure)다. */
    fun read(worldId: UUID, subject: UUID, imageId: UUID): WorldCoverImage {
        val row = tx {
            worlds.findById(worldId).orElse(null)?.takeIf { it.ownerSubject == subject && it.deletedAt == null } ?: throw WorldNotFound()
            images.findById(imageId).orElse(null)?.takeIf { it.worldId == worldId } ?: throw ContentFailure(404, "카드 이미지를 찾을 수 없습니다.")
        }
        return WorldCoverImage(coverStorage { storage.read(row.objectKey).bytes }, row.contentType)
    }
}
