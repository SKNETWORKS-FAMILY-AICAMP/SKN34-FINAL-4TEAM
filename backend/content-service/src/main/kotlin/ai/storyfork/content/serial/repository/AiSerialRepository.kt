package ai.storyfork.content.serial.repository

import ai.storyfork.content.serial.entity.AiSerialEntity
import org.springframework.data.jpa.repository.JpaRepository

interface AiSerialRepository : JpaRepository<AiSerialEntity, String> {
    /** 켜진 자율 연재다. 일정 점검이 주기마다 읽는다(시연 규모라 페이지를 나누지 않는다). */
    fun findAllByEnabledTrue(): List<AiSerialEntity>
}
