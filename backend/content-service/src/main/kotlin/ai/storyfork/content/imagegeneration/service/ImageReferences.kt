package ai.storyfork.content.imagegeneration.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.imagegeneration.service.dto.ImageRequest
import ai.storyfork.content.world.domain.WORLD_COVER_MAX_BYTES
import ai.storyfork.content.world.domain.worldCoverType
import ai.storyfork.content.world.service.WorldCoverService
import java.util.UUID
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Service

const val COVER_REFERENCE_VERSION = "landscape-v1"

@Service
class ImageReferences(private val works:AttachmentService, private val worlds:WorldCoverService) {
    private val landscape by lazy {
        ClassPathResource("cover-references/landscape-v1.jpg").inputStream.use {
            it.readNBytes(WORLD_COVER_MAX_BYTES + 1)
        }.let { AttachmentObjectPayload(it, worldCoverType(it)) }
    }

    fun preset(version:String):AttachmentObjectPayload {
        if (version != COVER_REFERENCE_VERSION) throw ContentFailure(404,"참고할 기본 이미지를 찾을 수 없어요.")
        return landscape
    }

    fun validate(request:ImageRequest, upload:ByteArray?) {
        val reference = request.reference
        if (reference == null && upload == null) return
        val cover = request.purpose in setOf("work_cover", "world_cover")
        val valid = reference != null && reference.role in setOf("style", "subject") && when (reference.mode) {
            "preset" -> reference.presetVersion == COVER_REFERENCE_VERSION && reference.role == "style" && upload == null
            "upload" -> reference.presetVersion == null && upload != null && upload.size in 1..WORLD_COVER_MAX_BYTES
            "cover" -> reference.presetVersion == null && upload == null &&
                if (request.purpose == "work_cover") request.workId != null else request.worldId != null
            else -> false
        }
        if (!cover || !valid) throw ContentFailure(422,"표지 생성에 사용할 참고 이미지와 목적을 확인해 주세요.")
    }

    /** 현재 표지 읽기에도 해당 표지의 기존 소유자 검사를 적용한다. */
    fun snapshot(request:ImageRequest, owner:String, upload:ByteArray?):AttachmentObjectPayload {
        val reference = requireNotNull(request.reference)
        if (reference.mode == "preset") return preset(requireNotNull(reference.presetVersion))
        val bytes = upload ?: if (request.purpose == "work_cover") {
            works.downloadCover(requireNotNull(request.workId),owner,false).bytes
        } else {
            worlds.read(requireNotNull(request.worldId),UUID.fromString(owner)).bytes
        }
        return AttachmentObjectPayload(bytes,worldCoverType(bytes))
    }
}
