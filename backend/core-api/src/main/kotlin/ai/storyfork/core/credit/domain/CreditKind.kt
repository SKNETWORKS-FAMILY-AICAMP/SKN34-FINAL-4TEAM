package ai.storyfork.core.credit.domain

/** 크레딧 지급 종류. MVP는 무료 크레딧(가입 체험·보상·이벤트)만 쓴다(F-CRD-04). 구독·추가 구매는 MVP 이후다. */
enum class CreditKind(val code: String) {
    SIGNUP_TRIAL("signup-trial"),
    REWARD("reward"),
    EVENT("event"),
}
