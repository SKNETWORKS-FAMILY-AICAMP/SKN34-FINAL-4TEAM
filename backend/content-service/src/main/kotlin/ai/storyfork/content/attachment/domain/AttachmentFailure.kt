package ai.storyfork.content.attachment.domain

/** 공개 메시지는 고정 문구만 사용하며 저장소·DB 원문 오류를 포함하지 않는다. */
class AttachmentFailure(val status: Int, val code: String, override val message: String) : RuntimeException(message)
