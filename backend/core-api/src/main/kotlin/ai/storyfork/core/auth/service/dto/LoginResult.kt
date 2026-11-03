package ai.storyfork.core.auth.service.dto

data class LoginResult(val accessToken: String, val user: MemberResponse, val refreshToken: String)
