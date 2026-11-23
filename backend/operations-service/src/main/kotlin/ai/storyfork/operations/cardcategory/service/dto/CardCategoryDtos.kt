package ai.storyfork.operations.cardcategory.service.dto

import com.fasterxml.jackson.annotation.JsonInclude

/**
 * What the browser sends and Content receives. Content owns every rule (name length, duplicates), so nothing is checked here
 * and a null field is left out of the body Content gets.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class CardCategoryCreateRequest(val name: String, val icon: String? = null)

/** Only the sent fields change: `icon: ""` clears the icon, a missing or null field leaves the value as it is. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class CardCategoryUpdateRequest(val name: String? = null, val icon: String? = null, val active: Boolean? = null)

/** Every category code exactly once, in the new order; Content answers 422 for anything else. */
data class CardCategoryOrderRequest(val codes: List<String>)
