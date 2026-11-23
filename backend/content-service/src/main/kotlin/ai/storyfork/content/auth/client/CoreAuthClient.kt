package ai.storyfork.content.auth.client

import ai.storyfork.content.auth.client.dto.CreditReleasePayload
import ai.storyfork.content.auth.client.dto.CreditReservationResponse
import ai.storyfork.content.auth.client.dto.CreditReservePayload
import ai.storyfork.content.auth.client.dto.CreditSettlePayload
import ai.storyfork.content.auth.client.dto.NicknamesPayload
import ai.storyfork.content.auth.client.dto.NicknamesResponse
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.service.annotation.HttpExchange
import org.springframework.web.service.annotation.PostExchange

/** 사용자 Bearer 확인과 표시용 닉네임 조회를 Core에 요청한다. 별도 서비스 자격은 HTTP proxy 설정이 주입한다. */
@HttpExchange(accept = [MediaType.APPLICATION_JSON_VALUE])
interface CoreAuthClient {
    @PostExchange("/internal/v1/auth/verify")
    fun verify(@RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String): VerifiedMemberResponse

    @PostExchange("/internal/v1/auth/verify-scheduled-member", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun verifyScheduledMember(@RequestBody request: ScheduledMemberPayload): VerifiedMemberResponse

    /** 회원 UUID 묶음의 최신 닉네임이다. 사용자 Bearer 없이 서비스 자격만 쓰며, Core에 없는 회원은 응답 맵에 없다. */
    @PostExchange("/internal/v1/members/nicknames", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun nicknames(@RequestBody request: NicknamesPayload): NicknamesResponse

    /** 크레딧 예약·정산·해제(AI 자율 연재, docs/design/credit-internal-api.md). 사용자 Bearer 없이 서비스 자격만 쓰고, 본문이 비어 돌아오면 null이다. */
    @PostExchange("/internal/v1/credits/reservations", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun reserveCredit(@RequestBody request: CreditReservePayload): CreditReservationResponse?

    @PostExchange("/internal/v1/credits/reservations/settle", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun settleCredit(@RequestBody request: CreditSettlePayload): CreditReservationResponse?

    @PostExchange("/internal/v1/credits/reservations/release", contentType = MediaType.APPLICATION_JSON_VALUE)
    fun releaseCredit(@RequestBody request: CreditReleasePayload): CreditReservationResponse?
}

/** Core의 내부 확인 응답이며 회원 UUID와 운영자 여부(`operator`, 없으면 일반 회원)만 읽는다. 공개 MemberResponse나 회원 정본 사본이 아니다. */
data class VerifiedMemberResponse(val memberId: UUID, val operator: Boolean = false)
data class ScheduledMemberPayload(val memberId: String)
