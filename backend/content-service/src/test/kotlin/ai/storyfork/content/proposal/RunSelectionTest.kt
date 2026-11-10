package ai.storyfork.content.proposal

import ai.storyfork.content.proposal.service.dto.RunSelection
import ai.storyfork.content.proposal.domain.validateRunSelection
import ai.storyfork.content._common.exception.ContentFailure
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import java.security.MessageDigest
import java.util.HexFormat

class RunSelectionTest {
    @Test fun `selection binds utf16 quote hash and rejects stale or split surrogate`() {
        val hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest("😀".toByteArray()))
        validateRunSelection("😀원고",RunSelection(0,2,hash))
        for(selection in listOf(RunSelection(0,1,hash),RunSelection(2,4,hash),RunSelection(2,2,hash)))
            assertThrows(ContentFailure::class.java){validateRunSelection("😀원고",selection)}
    }
}
