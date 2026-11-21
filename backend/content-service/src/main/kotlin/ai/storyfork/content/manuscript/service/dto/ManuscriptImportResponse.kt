package ai.storyfork.content.manuscript.service.dto

/** 등록 결과. 일부 회차가 실패해도 200이며 succeeded는 failed가 아닌 수다. [worldBuild]는 회차를 하나 이상 저장했을 때만 있다(null이면 세계관 구축 접수를 시도하지 않았다). */
data class ManuscriptImportResponse(val succeeded: Int, val failed: Int, val results: List<ManuscriptImportResult>, val worldBuild: ManuscriptImportWorldBuild? = null)

/** status는 created·versioned·partial·failed 중 하나다. partial은 저장했지만 이미지 일부가 빠진 경우다. */
data class ManuscriptImportResult(val number: Int, val title: String, val status: String, val reason: String?, val missingImages: Int)

/**
 * 가져오기 직후 최초 세계관 구축 자동 접수의 결과다. [status]는 started·rejected이고, started면 [jobId]가 접수된 작업이며
 * rejected면 시작 API(`POST /works/{id}/world-preprocessing`)와 같은 [code]·[message]다.
 */
data class ManuscriptImportWorldBuild(val status: String, val jobId: String?, val code: String?, val message: String?)
