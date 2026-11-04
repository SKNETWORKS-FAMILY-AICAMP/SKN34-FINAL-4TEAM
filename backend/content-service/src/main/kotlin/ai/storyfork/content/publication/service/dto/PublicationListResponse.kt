package ai.storyfork.content.publication.service.dto

import com.fasterxml.jackson.annotation.JsonValue

data class PublicationListResponse(@get:JsonValue val items: List<PublicationResponse>)
