package ai.storyfork.operations._common.service.dto

/** One line of an uploaded file that is not an evaluation item: its 1-based line number in the file and why. */
data class DatasetLineError(val line: Int, val message: String)

/** The 400 of an upload with malformed lines: the usual error body plus every such line. */
data class DatasetInvalidResponse(val code: String, val message: String, val errors: List<DatasetLineError>)
