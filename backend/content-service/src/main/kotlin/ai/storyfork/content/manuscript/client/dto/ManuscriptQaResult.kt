package ai.storyfork.content.manuscript.client.dto

import ai.storyfork.content.context.service.dto.QaClaim

internal data class ManuscriptQaResult(val claims: List<QaClaim>, val gaps: List<String>)
