package ai.storyfork.content.comment

import ai.storyfork.content.comment.client.dto.FeedbackPrediction
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class FeedbackPredictionTest {
    @Test fun `threshold equality is negative and missing fields are rejected`() {
        assertTrue(FeedbackPrediction(false, 0.5, "service", 0.5).valid())
        assertFalse(FeedbackPrediction(true, 0.5, "service", 0.5).valid())
        assertFalse(FeedbackPrediction(null, null, null, null).valid())
        assertFalse(FeedbackPrediction(false, Double.NaN, "service", 0.5).valid())
    }
}
