package ai.storyfork.core.auth.service.dto

data class LoginResponse(val accessToken: String, val user: MemberResponse)
