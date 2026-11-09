package ai.storyfork.content.comment.service.dto

/** 댓글 작성 요청이다. quote(선택 인용 문장)는 작성 때만 받고 이후 수정할 수 없다. 길이·공백 검증은 Service가 한다. */
data class CreateCommentRequest(val body: String = "", val quote: String? = null, val spoiler: Boolean = false)

/** 댓글 수정 요청이다. 수정할 수 있는 필드는 본문과 스포일러 여부뿐이다. */
data class UpdateCommentRequest(val body: String = "", val spoiler: Boolean = false)
