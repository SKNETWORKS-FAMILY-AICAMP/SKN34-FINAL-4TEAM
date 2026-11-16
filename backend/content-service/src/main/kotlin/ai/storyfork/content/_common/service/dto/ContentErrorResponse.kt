package ai.storyfork.content._common.service.dto

import com.fasterxml.jackson.annotation.JsonInclude

/** [code]는 코드가 있는 실패에만 나가며, 없으면 기존처럼 `{ "detail": … }`뿐이다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class ContentErrorResponse(val detail: String, val code: String? = null)
