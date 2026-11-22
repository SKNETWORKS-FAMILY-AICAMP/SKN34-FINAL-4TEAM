package ai.storyfork.operations.credit.service.dto

import java.math.BigDecimal

/**
 * A manual grant or revocation as the browser sends it. Core owns every rule (amount a whole number from 1 to 100,000, reason 1 to 200 characters
 * after trimming, a revocation only within the usable balance) and answers 422 or 409, so nothing is checked here. A missing field stays null for
 * Core to reject, and the amount is not narrowed to an Int, which would turn 1.5 into 1 before Core could refuse it.
 */
data class CreditAdjustRequest(val amount: BigDecimal?, val reason: String?)
