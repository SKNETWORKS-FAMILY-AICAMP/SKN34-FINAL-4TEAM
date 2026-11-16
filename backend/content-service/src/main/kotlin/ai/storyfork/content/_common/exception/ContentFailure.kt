package ai.storyfork.content._common.exception

/** 콘텐츠 API가 공유하는 공개 실패 계약. 원문·DB 예외를 메시지에 포함하지 않는다. [code]는 클라이언트가 가를 때만 두는 기계용 식별자다. */
class ContentFailure(val status: Int, override val message: String, val code: String? = null) : RuntimeException(message)
fun checkContent(ok: Boolean, status: Int = 422, message: String) {
    if (!ok) throw ContentFailure(status, message)
}
