package ai.storyfork.core.notification.service.dto

import jakarta.validation.constraints.NotNull
import java.time.Instant

/** upTo 이전(포함)에 도착한 알림만 모두 읽음 처리한다. 그 뒤 도착한 알림은 미읽음으로 남는다. */
data class ReadAllRequest(@field:NotNull val upTo: Instant?)
