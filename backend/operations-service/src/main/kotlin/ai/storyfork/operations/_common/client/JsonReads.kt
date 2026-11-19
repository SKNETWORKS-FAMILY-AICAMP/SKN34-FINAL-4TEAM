package ai.storyfork.operations._common.client

import tools.jackson.databind.JsonNode

/** The scalar's text, or null for a missing, null, blank or structured node (Jackson reads a JSON null as the text "null"). */
internal fun JsonNode.textOrNull(): String? = if (isValueNode && !isNull) asString().takeIf { it.isNotBlank() } else null

/** A number, or a numeric string such as the "123" that ClickHouse-backed Langfuse aggregates come as; null for anything else. */
internal fun JsonNode.doubleOrNull(): Double? = when {
    isNumber -> asDouble()
    isString -> stringValue().trim().toDoubleOrNull()
    else -> null
}
