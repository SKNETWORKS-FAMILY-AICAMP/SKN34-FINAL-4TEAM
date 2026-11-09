package ai.storyfork.content.manuscript.service.dto

/** 등록 결과. 일부 회차가 실패해도 200이며 succeeded는 failed가 아닌 수다. */
data class ManuscriptImportResponse(val succeeded: Int, val failed: Int, val results: List<ManuscriptImportResult>)

/** status는 created·versioned·partial·failed 중 하나다. partial은 저장했지만 이미지 일부가 빠진 경우다. */
data class ManuscriptImportResult(val number: Int, val title: String, val status: String, val reason: String?, val missingImages: Int)
