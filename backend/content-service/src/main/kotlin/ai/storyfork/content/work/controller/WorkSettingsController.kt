package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.WorkSettingsService
import ai.storyfork.content.work.service.dto.UpdateWorkSettingsRequest
import ai.storyfork.content.work.service.dto.WorkSettingsResponse
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/** 작품 소유자가 집필 방식과 현재 운영 설정, 설정 변경 이력을 확인한다. */
@RestController
@RequestMapping("/api/v1/works/{id}/operating-settings")
class WorkSettingsController(private val settings: WorkSettingsService) {
    /** 현재 설정과 최신순 변경 이력을 반환한다. */
    @GetMapping
    fun read(@PathVariable id: String, principal: Principal): WorkSettingsResponse = settings.read(id, principal.name)

    /** 읽은 설정 버전을 기준으로 집필 방식을 변경한다. */
    @PutMapping
    fun update(@PathVariable id: String, principal: Principal, @RequestBody request: UpdateWorkSettingsRequest): WorkSettingsResponse =
        settings.update(id, principal.name, request)
}
