package ai.storyfork.content.attachment.service

import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.dto.AttachmentRenameRequest
import ai.storyfork.content.attachment.service.dto.AttachmentUploadPayload
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldStudioService
import java.util.UUID
import org.springframework.dao.DataAccessException
import org.springframework.stereotype.Service
import org.springframework.transaction.TransactionException

/**
 * 세계관 스튜디오 설정 카드의 첨부(참고 파일·설정 이미지)다(#735). 세계관 소유자(운영자는 GET·HEAD 열람만)의 지우지 않은 카드에서만 올리고 받고,
 * 그 밖(남의·삭제된 세계관, 지운 카드, 다른 세계관의 카드, 잘못된 ID)은 첨부 로직·객체 저장소에 닿기 전에 모두 같은 404다.
 * 확인은 WorldStudio 트랜잭션([WorldStudioService.hasCard])에서 먼저 끝내고(두 트랜잭션을 겹치지 않는다), 이어서 기존 설정 첨부 로직([AttachmentService], 올리기·목록·내려받기·이름 변경·교체·삭제)을 card = true로 재사용한다.
 * ponytail: 카드는 별도 스키마라 FK가 없다. 확인과 저장 사이에 카드가 지워지면 읽을 수 없는 첨부 행·객체가 남을 수 있고 정리는 운영자 몫이다(자동 정리 없음).
 */
@Service
class CardAttachmentService(private val worlds: WorldStudioService, private val attachments: AttachmentService) {
    private fun parse(value: String): UUID? = runCatching { UUID.fromString(value) }.getOrNull()
    private fun missing(): Nothing = throw AttachmentFailure(404, "ATTACHMENT_NOT_FOUND", "설정 또는 첨부를 찾을 수 없어요.")

    /** 카드를 확인한 뒤 [action]에 정규화한 세계관·카드·회원 ID를 넘긴다. 회원이 아니면 401, 카드가 없으면 404, 세계관 DB 실패는 503이다. */
    private fun <T> checked(world: String, card: String, owner: String, action: (String, String, String) -> T): T {
        val member = parse(owner) ?: throw AttachmentFailure(401, "ATTACHMENT_UNAUTHENTICATED", "인증이 필요해요.")
        val worldId = parse(world) ?: missing()
        val cardId = parse(card) ?: missing()
        val found = try { worlds.hasCard(worldId, member, cardId) }
        catch (_: WorldNotFound) { false }
        catch (_: DataAccessException) { throw databaseFailure() }
        catch (_: TransactionException) { throw databaseFailure() }
        if (!found) missing()
        return action(worldId.toString(), cardId.toString(), member.toString())
    }
    private fun databaseFailure() = AttachmentFailure(503, "ATTACHMENT_DATABASE_FAILURE", "첨부 정보를 저장하거나 조회하지 못했어요.")

    /** 파일을 읽기 전에 카드 접근을 확인한다. 저장 전 재확인은 각 업로드 메서드가 유지한다. */
    fun requireUploadAccess(world: String, card: String, owner: String) { checked(world, card, owner) { _, _, _ -> } }
    fun list(world: String, card: String, owner: String) = checked(world, card, owner) { w, c, o -> attachments.listSettingAttachments(w, c, o, card = true) }
    fun read(world: String, card: String, id: String, owner: String) = checked(world, card, owner) { w, c, o -> attachments.readSettingAttachment(w, c, id, o, card = true) }
    fun download(world: String, card: String, id: String, owner: String) = checked(world, card, owner) { w, c, o -> attachments.downloadSettingAttachment(w, c, id, o, card = true) }
    fun create(world: String, card: String, owner: String, payload: AttachmentUploadPayload) = checked(world, card, owner) { w, c, o -> attachments.createSettingAttachment(w, c, o, payload, card = true) }
    fun replace(world: String, card: String, id: String, owner: String, payload: AttachmentUploadPayload) = checked(world, card, owner) { w, c, o -> attachments.replaceSettingAttachment(w, c, id, o, payload, card = true) }
    fun rename(world: String, card: String, id: String, owner: String, request: AttachmentRenameRequest) = checked(world, card, owner) { w, c, o -> attachments.renameSettingAttachment(w, c, id, o, request, card = true) }
    fun delete(world: String, card: String, id: String, owner: String) { checked(world, card, owner) { w, c, o -> attachments.deleteSettingAttachment(w, c, id, o, card = true) } }
}
