package ai.storyfork.content.auth.client.exception

/** Remote credentials and raw responses must never become the public error or log message. */
class CoreAuthException(val status: Int, val code: String, detail: String) : RuntimeException(detail)
