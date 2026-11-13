package ai.storyfork.content.world.controller

import ai.storyfork.content.world.service.dto.WorldCoverImage
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity

/** 표지 이미지 응답이다. 첨부 이미지와 같이 캐시하지 않고(비공개 전환의 즉시성) 형식을 추측해 읽지 못하게 한다(nosniff). */
fun coverImage(cover: WorldCoverImage): ResponseEntity<ByteArray> = ResponseEntity.ok()
    .contentType(MediaType.parseMediaType(cover.contentType)).contentLength(cover.bytes.size.toLong())
    .header(HttpHeaders.CACHE_CONTROL, "private, no-store").header("X-Content-Type-Options", "nosniff").body(cover.bytes)
