package ai.storyfork.content.feedbackreport.domain

import ai.storyfork.content._common.exception.checkContent
import java.time.Instant

private val KINDS = setOf("typo", "story", "question", "suggestion")
private val VISIBILITIES = setOf("public", "private")
// 작가는 확인함·답변함·처리 완료·종료로만 바꿀 수 있고 확인 전(unchecked)으로 되돌릴 수 없다.
private val SETTABLE_STATUSES = setOf("checked", "answered", "resolved", "closed")

private const val BODY_MAX = 500
private const val RESPONSE_MAX = 2000

/** 제보 유형이다(typo·story·question·suggestion). 독자가 고르며 모르는 값은 422다. */
fun reportKind(code: String): String = code.also { checkContent(it in KINDS, message = "제보 유형을 확인해 주세요.") }

/** 공개 범위다. 생략하면 비공개이고 모르는 값은 422다. */
fun reportVisibility(code: String?): String = (code ?: "private").also { checkContent(it in VISIBILITIES, message = "공개 범위를 확인해 주세요.") }

/** 작가가 바꿀 수 있는 처리 상태다. unchecked로 되돌리기와 모르는 값은 422다. */
fun settableStatus(code: String): String = code.also { checkContent(it in SETTABLE_STATUSES, message = "처리 상태는 확인함·답변함·처리 완료·종료 중에서 골라 주세요.") }

// Kotlin trim·isNotBlank는 NBSP도 공백으로 본다(Bean Validation @NotBlank와 다르다). U+0000은 PostgreSQL text에 저장할 수 없다.
private fun clean(text: String, max: Int, message: String): String = text.trim().also {
    checkContent(it.isNotBlank() && it.length <= max && '\u0000' !in it, message = message)
}

/** 제보 본문이다. 앞뒤 공백을 지운 뒤 1~500자이며 아니면 422다. */
fun reportBody(text: String): String = clean(text, BODY_MAX, "제보 내용은 1~500자, 인용 문장은 500자 이내로 입력해 주세요.")

/** 정정 본문이다. 제보 본문과 같은 1~500자 규칙이다. */
fun correctionBody(text: String): String = clean(text, BODY_MAX, "정정 내용은 1~500자로 입력해 주세요.")

/** 작가 답변이다. 앞뒤 공백을 지운 뒤 1~2000자이며 아니면 422다. */
fun responseBody(text: String): String = clean(text, RESPONSE_MAX, "답변은 1~2000자로 입력해 주세요.")

/** 선택 인용 문장이다. 앞뒤 공백을 자르고 비면 없음(null)이며, 500자를 넘거나 U+0000이 있으면 422다. */
fun reportQuote(text: String?): String? = text?.trim()?.takeIf { it.isNotEmpty() }?.also {
    checkContent(it.length <= BODY_MAX && '\u0000' !in it, message = "제보 내용은 1~500자, 인용 문장은 500자 이내로 입력해 주세요.")
}

/** 작가가 제보를 확인하면 확인 전(unchecked)만 확인함(checked)이 되고 나머지 상태는 그대로다. */
fun statusAfterCheck(status: String): String = if (status == "unchecked") "checked" else status

/** 작가가 답변하면 확인 전·확인함은 답변함(answered)이 되고, 이미 답변함·처리 완료·종료면 그대로다. */
fun statusAfterResponse(status: String): String = if (status == "unchecked" || status == "checked") "answered" else status

/** 정정은 철회 전에만 할 수 있다. 철회했으면 409다. */
fun ensureCanCorrect(withdrawnAt: Instant?) = checkContent(withdrawnAt == null, 409, "철회한 제보는 정정할 수 없어요.")

/** 철회는 한 번만 할 수 있다. 이미 철회했으면 409다. */
fun ensureCanWithdraw(withdrawnAt: Instant?) = checkContent(withdrawnAt == null, 409, "이미 철회한 제보예요.")

/** 요청자가 제보를 어디까지 볼 수 있는지다. */
enum class ReportView {
    /** 원문·정정·제보자 이름까지 본다. */
    FULL,
    /** 비공개 제보의 공개 답변만 본다(원문 숨김). */
    ANSWERS_ONLY,
    /** 볼 수 없다(404). */
    HIDDEN,
}

/**
 * 공개 제보는 누구나, 비공개 제보는 제보자·작품 소유자만 원문을 본다.
 * 그 외 사람에게는 공개 답변이 있을 때만 원문 없이 답변만 보이고(UC-14), 없으면 존재 자체를 숨긴다.
 */
fun reportView(visibility: String, mine: Boolean, owner: Boolean, hasPublicResponse: Boolean): ReportView = when {
    visibility == "public" || mine || owner -> ReportView.FULL
    hasPublicResponse -> ReportView.ANSWERS_ONLY
    else -> ReportView.HIDDEN
}
