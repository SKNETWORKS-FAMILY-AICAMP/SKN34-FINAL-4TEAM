package ai.storyfork.content.world.service.dto

import java.time.Instant
import java.util.UUID

/**
 * 운영 세계관 목록의 한 줄이다(지우지 않은 전체, 비공개·제한 포함). [name]은 저장 버전이 있으면 그 이름(공개 목록이 보여 주는 이름), 없으면 초안 이름이다.
 * [published]는 저장 버전이 있어 공개 목록에 나올 수 있다는 뜻이고(공개 여부는 [visibility], 제한은 [restricted]가 따로 말한다), [linkedWorkId]는 연결된 소설(1:1, DEC-46, 없으면 null)이다.
 */
data class OperationsWorldResponse(
    val worldId: UUID, val ownerId: UUID, val name: String, val visibility: String, val published: Boolean, val restricted: Boolean,
    val genre: String?, val linkedWorkId: String?, val createdAt: Instant,
)
