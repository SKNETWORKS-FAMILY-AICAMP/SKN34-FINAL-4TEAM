package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.*
import ai.storyfork.content.proposal.client.*
import ai.storyfork.content.proposal.entity.AiRunEntity
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.security.MessageDigest
import java.time.Instant
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Content만 아는 키로 작업·주체·판본·예산의 5분 위임을 서명한다. 토큰은 DB에 저장하지 않는다. */
@Service
class AiRunGrantService(@Value("\${AI_RUN_GRANT_SECRET:}") private val secret: String) {
    fun token(run: AiRunEntity): String {
        if(secret.length<32 || secret.any {it=='\r' || it=='\n'}) throw AiRunDispatchException(AiRunFailure.AI_RUN_UNCONFIGURED)
        if(run.grantExpiresAt<=Instant.now()) throw AiRunDispatchException(AiRunFailure.AI_RUN_GRANT_EXPIRED)
        val payload=listOf("storyfork-ai-run-v1",run.id,run.threadId,run.requesterId,run.workId,run.operation,
            run.requestHash,run.scopeHash,run.targetRefsJson,run.maxCalls.toString(),run.grantExpiresAt.epochSecond.toString()).joinToString("|")
        val mac=Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8),"HmacSHA256"))
        return HexFormat.of().formatHex(mac.doFinal(payload.toByteArray(Charsets.UTF_8)))
    }

    fun requireValid(run: AiRunEntity,supplied: String) {
        checkContent(run.grantExpiresAt>Instant.now(),403,"작업 위임을 확인할 수 없어요.")
        val expected=try {token(run)} catch(_: AiRunDispatchException) {throw ContentFailure(503,"작업 위임 설정을 확인해 주세요.")}
        fun digest(value: String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        checkContent(MessageDigest.isEqual(digest(expected),digest(supplied)),403,"작업 위임을 확인할 수 없어요.")
    }
}
