package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import tools.jackson.databind.json.JsonMapper

/** Filters and entry points answer before MVC, so they write the shared error DTO themselves. Set other headers first: writing commits the response. */
fun HttpServletResponse.writeError(mapper: JsonMapper, status: Int, error: OperationsErrorResponse) {
    this.status = status
    contentType = MediaType.APPLICATION_JSON_VALUE
    mapper.writeValue(writer, error)
}
