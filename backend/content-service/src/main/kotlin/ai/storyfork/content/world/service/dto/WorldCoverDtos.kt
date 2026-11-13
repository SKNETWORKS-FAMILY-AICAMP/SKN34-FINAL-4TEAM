package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 소유자의 표지 저장 응답이다. 저장되면 [hasCover]는 항상 true다. */
data class WorldCoverResponse(val worldId: UUID, val hasCover: Boolean)

/** 응답 본문으로 그대로 내보내는 표지 이미지 바이트와 형식(image/png·image/jpeg·image/webp)이다. */
class WorldCoverImage(val bytes: ByteArray, val contentType: String)
