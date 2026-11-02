package ai.storyfork.core.world.client.exception

class InitialValidationException(
 val rawOutput:String?,
 val usage:Map<String,Any>,
 val diagnostics:List<Map<String,String?>>
):RuntimeException("초기 설정 응답 검증 실패") {
 val issues:List<String> get()=diagnostics.map {
  "${it["record_id"] ?: "$"} ${it["field"]} [${it["code"]}]: ${it["cause"]}"
 }
}
