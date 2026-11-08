package ai.storyfork.core

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class CoreServiceHttpBoundaryTest {
    private val services = listOf(
        "auth/service/SignupService.kt",
        "auth/service/ProfileService.kt",
        "auth/service/WithdrawalService.kt",
        "auth/service/AuthVerificationService.kt",
        "auth/service/MemberAdminService.kt",
        "notification/service/NoticeService.kt",
    )

    @Test
    fun `core business services do not decide HTTP status or depend on HTTP types`() {
        for (file in services) {
            val source = Files.readString(Path.of("src/main/kotlin/ai/storyfork/core/$file"))
            for (forbidden in listOf("ResponseStatusException", "org.springframework.http", "org.springframework.web")) {
                assertFalse(source.contains(forbidden), "$file must not use $forbidden")
            }
        }
    }
}
