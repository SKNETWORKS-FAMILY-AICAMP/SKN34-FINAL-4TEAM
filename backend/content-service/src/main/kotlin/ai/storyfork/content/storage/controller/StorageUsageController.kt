package ai.storyfork.content.storage.controller

import ai.storyfork.content.storage.service.StorageUsageService
import ai.storyfork.content.storage.service.dto.StorageUsageResponse
import java.security.Principal
import java.util.UUID
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/** 로그인한 회원에게 본인 콘텐츠의 저장 사용량과 항목을 반환한다. */
@RestController
class StorageUsageController(private val usage: StorageUsageService) {
    /** 쓰기 없이 항목별 본문·원고 이미지 크기와 합계를 조회한다. */
    @GetMapping("/api/v1/me/storage-usage")
    fun read(principal: Principal): StorageUsageResponse = usage.read(UUID.fromString(principal.name))
}
