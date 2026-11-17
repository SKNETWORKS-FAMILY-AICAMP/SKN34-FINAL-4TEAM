package ai.storyfork.content.world.service.dto

/** 확정 버전으로 카드를 되돌리는 요청이다. 되돌릴 버전은 경로의 revisionId이고, 본문은 사용자가 본 초안 revision(낡았으면 409)만 보낸다. */
data class RestoreWorldRequest(val expectedDraftRevision: Long)
