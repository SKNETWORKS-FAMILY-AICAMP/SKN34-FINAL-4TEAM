package ai.storyfork.content.work.service.dto

import java.util.UUID

/** 작품에 연결할 WorldStudio 세계관이다. [worldId]가 null이면 연결을 해제한다. */
data class WorkWorldLinkRequest(val worldId: UUID? = null)

/** 작품과 그 작품에 연결된 세계관이다(1:1, DEC-46). 연결이 없으면 [worldId]는 null이다. */
data class WorkWorldLinkResponse(val workId: String, val worldId: UUID?)
