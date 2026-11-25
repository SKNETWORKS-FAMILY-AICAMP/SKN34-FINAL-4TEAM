package ai.storyfork.operations._common.exception

import ai.storyfork.operations._common.service.dto.DatasetLineError

/** The file has lines that are not evaluation items: every one of them with its line number, and nothing was created. */
class DatasetInvalidException(val errors: List<DatasetLineError>) : RuntimeException()

/** The upload came without the confirmation that the file holds no copyrighted text. */
class CopyrightConfirmRequiredException : RuntimeException()

/** The file has more items than an upload may have. */
class DatasetTooLargeException : RuntimeException()
