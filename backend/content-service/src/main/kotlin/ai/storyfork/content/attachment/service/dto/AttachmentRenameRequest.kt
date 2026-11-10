package ai.storyfork.content.attachment.service.dto

/** 설정 첨부 파일명 수정 요청. 규칙 위반과 누락은 Service가 같은 422로 거절한다. */
data class AttachmentRenameRequest(val filename: String? = null)
