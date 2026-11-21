package ai.storyfork.operations.credit.service.dto

/**
 * A manual grant or revocation. Core owns every rule (amount 1 to 100,000, reason 1 to 200 characters after trimming, a revocation only within the
 * usable balance) and answers 422 or 409, so nothing is checked here and Core's answer reaches the browser as it is.
 */
data class CreditAdjustRequest(val amount: Int, val reason: String)
