package ai.storyfork.core.credit.domain

import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/** 지급 종류별 소멸 시각 계산. 모든 기한은 한국 시간(KST) 기준이다(UC-17). */
object CreditExpiry {
    val KST: ZoneId = ZoneId.of("Asia/Seoul")

    /** 가입 체험 크레딧은 지급 후 30일에 소멸한다. */
    fun signupTrial(grantedAt: Instant): Instant = grantedAt.plus(Duration.ofDays(30))

    /** 보상·이벤트 크레딧은 지급한 달의 월간 초기화 시점(다음 달 1일 00:00 KST)에 소멸한다. */
    fun monthly(grantedAt: Instant): Instant =
        grantedAt.atZone(KST).toLocalDate().withDayOfMonth(1).plusMonths(1).atStartOfDay(KST).toInstant()
}
