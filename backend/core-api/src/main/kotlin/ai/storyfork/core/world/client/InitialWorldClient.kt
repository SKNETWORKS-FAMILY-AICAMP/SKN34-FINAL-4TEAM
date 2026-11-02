package ai.storyfork.core.world.client

import ai.storyfork.core.world.domain.*
import ai.storyfork.core._common.helper.buildRestClient
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.time.Duration
import org.springframework.web.client.RestClientResponseException
import ai.storyfork.core.world.client.exception.InitialValidationException

@Component
@ConditionalOnProperty(name=["STUDIO_ENABLED"],havingValue="true")
class InitialWorldClient(@param:Value("\${app.ai-service.base-url}") base:URI,private val mapper:ObjectMapper,
 @param:Value("\${INITIAL_WORLD_REPLAY_FILE:}") private val replayFile:String="") {
 fun replay(input:InitialInput):Pair<String,InitialExtraction> {
  require(replayFile.isNotBlank()) {"보존한 응답 파일이 설정되지 않았습니다."}
  // Only an operator-configured local audit is readable; no client-supplied paths or output.
  val audit=mapper.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(replayFile)))
  require(audit["request_count"].asInt()==1 && audit["http_status"].asInt()==200 && audit["raw_response"]["status"].asText()=="completed") {"완료된 단일 응답만 재검증할 수 있습니다."}
  val sent=audit["request_body"]["input"].first {it.path("role").asText()=="user"}["content"].asText()
  require(java.security.MessageDigest.getInstance("SHA-256").digest(sent.toByteArray()).joinToString("") { "%02x".format(it) }==audit["input_hash"].asText()) {"실제 호출 입력 해시가 일치하지 않습니다."}
  require(mapper.readTree(sent)==audit["input"]) {"감사 입력과 실제 요청 입력이 다릅니다."}
  val sources=audit["input"]["sources"].associate {it["id"].asText() to it["text"].asText()}
  require(sources==input.sources().filterValues {it.isNotBlank()}) {"실제 호출의 입력과 현재 분석 원문이 다릅니다."}
  val text=audit["raw_response"]["output"].flatMap {it.path("content").toList()}.filter {it.path("type").asText()=="output_text"}.joinToString("") {it["text"].asText()}
  val payload=mapper.readValue(text,Payload::class.java)
  return audit["audit_id"].asText() to InitialExtraction(payload.items,text,mapOf("model" to audit["model"].asText(),"originalRequests" to 1,"reprocessRequests" to 0,"auditInputHash" to audit["input_hash"].asText()),payload.coverage)
 }
 private val http=buildRestClient(RestClient.builder(),base,Duration.ofSeconds(5),Duration.ofSeconds(200))
 fun analyze(input:InitialInput):InitialExtraction {
  val response=try {requireNotNull(http.post().uri("/internal/v1/initial-world-knowledge")
   .body(mapOf("sources" to input.sources().filterValues {it.isNotBlank()}.map {(id,text)->mapOf("id" to id,"text" to text)},"targets" to input.targetReferences()))
   .retrieve().body(String::class.java))
  } catch(e:RestClientResponseException) {
   if(e.statusCode.value()!=422) throw e
   val failure=mapper.readValue(e.responseBodyAsString,FailureEnvelope::class.java).detail
   require(failure.contractVersion=="initial-content-4-minimal" && failure.diagnostics.isNotEmpty())
   throw InitialValidationException(failure.rawOutput,failure.usage,failure.diagnostics)
  }
  val payload=mapper.readValue(response,Payload::class.java)
  require(payload.contractVersion=="initial-content-4-minimal") {"초기 설정 추출 계약이 일치하지 않습니다."}
  return assembleInitialSemantic(input,payload.items,payload.coverage,payload.rawOutput ?: response,payload.usage)
 }
 data class Payload(val items:List<InitialItem>,val usage:Map<String,Any> = emptyMap(),val coverage:List<InitialCoverage>,val rawOutput:String?=null,val contractVersion:String?=null)
 data class FailureEnvelope(val detail:FailurePayload)
 data class FailurePayload(val message:String,val contractVersion:String,val diagnostics:List<Map<String,String?>>,val rawOutput:String?,val usage:Map<String,Any>)
}
