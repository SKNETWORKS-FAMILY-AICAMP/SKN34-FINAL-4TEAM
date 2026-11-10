package ai.storyfork.content.editsuggestion.service.dto

/** 수정 제안 등록 요청이다. 길이·공백·같은 문장 검증은 Service가 한다. */
data class CreateSuggestionRequest(val beforeText: String = "", val afterText: String = "", val reason: String? = null)

/** 작가의 편집안 저장 요청이다. 원래 afterText는 바뀌지 않는다. */
data class EditedTextRequest(val editedText: String = "")

/** 거절 요청이다. 사유는 선택이며 본문을 보내지 않아도 된다. */
data class RejectionRequest(val reason: String? = null)
