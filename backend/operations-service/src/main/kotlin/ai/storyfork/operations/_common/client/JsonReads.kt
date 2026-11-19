package ai.storyfork.operations._common.client

import java.time.Instant
import java.time.format.DateTimeParseException
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.JsonNode

/** The scalar's text, or null for a missing, null, blank or structured node (Jackson reads a JSON null as the text "null"). */
internal fun JsonNode.textOrNull(): String? = if (isValueNode && !isNull) asString().takeIf { it.isNotBlank() } else null

/** A finite number, or a numeric string such as the "123" that ClickHouse-backed Langfuse aggregates come as; null for anything else (also "NaN"). */
internal fun JsonNode.doubleOrNull(): Double? = when {
    isNumber -> asDouble()
    isString -> stringValue().trim().toDoubleOrNull()
    else -> null
}?.takeIf { it.isFinite() }

/**
 * A Langfuse timestamp. A missing or malformed one is a broken answer from Langfuse, so it fails like any other Langfuse failure (502):
 * a dashboard card goes unavailable and a list API answers 502, instead of the request crashing with a 500.
 */
internal fun JsonNode.instant(): Instant = try {
    Instant.parse(asString())
} catch (error: DateTimeParseException) {
    throw ResponseStatusException(HttpStatus.BAD_GATEWAY, null, error)
}

/** An optional Langfuse timestamp: absent or blank is null, a malformed one is a 502 like [instant]. */
internal fun JsonNode.instantOrNull(): Instant? = if (textOrNull() == null) null else instant()
