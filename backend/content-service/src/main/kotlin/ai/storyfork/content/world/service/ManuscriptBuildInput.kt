package ai.storyfork.content.world.service

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.CharBuffer
import java.security.MessageDigest

/** 저장 버전의 정확한 사본. hash는 필드별 UTF-8 byte 길이(4-byte big endian)+값의 SHA-256이다. */
data class ManuscriptBuildSource(val number:Int,val episodeId:String,val versionId:String,val title:String,val body:String) {
    init { require(number>0 && episodeId.isNotBlank() && versionId.isNotBlank()) }
    val hash:String get() {
        val digest=MessageDigest.getInstance("SHA-256")
        for(value in listOf(number.toString(),episodeId,versionId,title,body)) {
            val bytes=Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(value))
            digest.update(ByteBuffer.allocate(4).putInt(bytes.remaining()).array())
            digest.update(bytes)
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    fun requireQuote(start:Int,end:Int,quote:String) {
        require(start>=0 && start<end && end<=body.length)
        fun splitsPair(offset:Int)=offset>0 && offset<body.length &&
            Character.isHighSurrogate(body[offset-1]) && Character.isLowSurrogate(body[offset])
        require(!splitsPair(start) && !splitsPair(end))
        require(body.substring(start,end)==quote)
    }
}

data class ManuscriptBuildResultBasis(val number:Int,val versionId:String,val sourceHash:String)

data class ManuscriptQuote(val start:Int,val end:Int,val quote:String)

/** 원본 추출 JSON은 변형 없이 보존한다. 이 envelope 검증은 의미 추출 스키마 검증을 대체하지 않는다. */
data class ManuscriptEpisodeResult(
    val basis:ManuscriptBuildResultBasis,val evidence:List<ManuscriptQuote>,val extraction:Map<String,Any?>,
)

/** 영속 결과의 완전성 경계. worker 완료 숫자나 이번 재시도 회차만으로 성공을 판단하지 않는다. */
data class ManuscriptBuildInput(val episodes:List<ManuscriptBuildSource>) {
    init {
        require(episodes.isNotEmpty())
        require(episodes.map { it.number }.zipWithNext().all { (a,b)->a<b })
        require(episodes.map { it.episodeId }.distinct().size==episodes.size)
        require(episodes.map { it.versionId }.distinct().size==episodes.size)
    }
    fun requireComplete(results:List<ManuscriptBuildResultBasis>) {
        require(results.size==episodes.size && results.map { it.number }.distinct().size==results.size)
        require(results.sortedBy { it.number }==episodes.map { ManuscriptBuildResultBasis(it.number,it.versionId,it.hash) })
    }
    fun missing(results:List<ManuscriptEpisodeResult>):List<ManuscriptBuildSource> {
        require(results.map { it.basis.number }.distinct().size==results.size)
        val sources=episodes.associateBy { it.number }
        results.forEach { result ->
            val source=requireNotNull(sources[result.basis.number])
            require(result.basis==ManuscriptBuildResultBasis(source.number,source.versionId,source.hash))
            result.evidence.forEach { source.requireQuote(it.start,it.end,it.quote) }
        }
        val saved=results.map { it.basis.number }.toSet()
        return episodes.filter { it.number !in saved }
    }
    fun requireResults(results:List<ManuscriptEpisodeResult>) {
        require(missing(results).isEmpty())
        requireComplete(results.map { it.basis })
    }
}
