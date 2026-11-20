package ai.storyfork.operations.genre.service.dto

import com.fasterxml.jackson.annotation.JsonInclude

/**
 * What the browser sends and Content receives. Content owns every rule (name length, duplicates, the home limit of six), so nothing is checked here
 * and a null field is left out of the body Content gets.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class GenreCreateRequest(val name: String, val emoji: String? = null)

/** Only the sent fields change: `emoji: ""` clears the icon, a missing or null field leaves the value as it is. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class GenreUpdateRequest(val name: String? = null, val emoji: String? = null, val active: Boolean? = null, val featured: Boolean? = null)

/** Every genre code exactly once, in the new order; Content answers 422 for anything else. */
data class GenreOrderRequest(val codes: List<String>)
