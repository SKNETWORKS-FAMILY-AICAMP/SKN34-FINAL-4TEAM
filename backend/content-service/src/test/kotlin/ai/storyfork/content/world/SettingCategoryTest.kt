package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.domain.Setting
import ai.storyfork.content.world.domain.validateSetting
import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SettingCategoryTest {
    @Test fun `other settings can be edited and confirmed`() {
        assertDoesNotThrow { validateSetting(Setting(name="사건 연표", content="첫 만남과 갈등", category="기타")) }
    }

    @Test fun `unknown categories still require explicit other selection`() {
        assertThrows(ContentFailure::class.java) {
            validateSetting(Setting(name="사건 연표", content="첫 만남과 갈등", category="없는 분류"))
        }
    }
}
