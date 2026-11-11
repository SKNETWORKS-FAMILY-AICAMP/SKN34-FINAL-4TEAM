package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.SaveWorldRequest
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component
import tools.jackson.databind.json.JsonMapper

/**
 * 서버 시작 시 `genre-templates.json`의 장르 템플릿을 [TEMPLATE_OWNER](Core 운영 관리자) 소유 WorldStudio 세계관으로 적재한다.
 * Neo4j 노드가 필요해 SQL로는 넣을 수 없으므로 기존 [WorldStudioService]의 create → edit → save를 그대로 호출한다.
 * worldId·key가 고정이라 시작할 때마다 다시 시도해도 안전하고, 한 장르가 실패(Neo4j 장애 등)해도 로그만 남기고 서버와 다음 장르는 계속 간다.
 * 리소스 JSON을 읽지 못해도 로그만 남기고 서버는 계속 뜬다(그 시작에서는 적재 없음).
 *
 * v1 입력은 재시도 hash 보존을 위해 동결한다. 기존 11종의 v2 보완은 초기 샘플에만 적용하고, 미배포 신화 14종은 최신 카드로 바로 적재한다.
 */
@Component
class GenreTemplateSeeder(private val service: WorldStudioService, private val mapper: JsonMapper) {
    private val log = LoggerFactory.getLogger(GenreTemplateSeeder::class.java)

    @EventListener(ApplicationReadyEvent::class)
    fun seed() {
        // 리소스를 못 읽어도 ApplicationReadyEvent 예외로 서버 기동이 실패하지 않게 로그만 남기고 돌아온다.
        val templates = try { loadLegacy() }
            catch (e: Exception) { log.error("장르 템플릿 리소스 읽기 실패: {}: {}", e.javaClass.simpleName, e.message); return }
        val updated = try { load().associateBy { it.worldId } }
            catch (e: Exception) { log.error("템플릿 보완 리소스 읽기 실패", e); emptyMap() }
        val legacyIds = templates.map { it.worldId }.toSet()
        for (template in templates) {
            try { seedGenre(template) }
            catch (e: Exception) { log.error("장르 템플릿 적재 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
            val target = updated[template.worldId] ?: continue
            try { GenreTemplateRepair(service).repair(template, target) }
            catch (e: Exception) { log.error("장르 템플릿 보완 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
        }
        for (template in updated.values.filter { it.worldId !in legacyIds }) {
            try { seedGenre(template, legacy = false) }
            catch (e: Exception) { log.error("신화 템플릿 적재 실패 genre={}: {}: {}", template.genre, e.javaClass.simpleName, e.message) }
        }
    }

    internal fun load(): List<GenreTemplate> =
        ClassPathResource("genre-templates.json").inputStream.use { mapper.readValue(it, Array<GenreTemplate>::class.java).toList() }

    internal fun loadLegacy(): List<GenreTemplate> =
        ClassPathResource("genre-templates-v1.json").inputStream.use { mapper.readValue(it, Array<GenreTemplate>::class.java).toList() }

    private fun seedGenre(template: GenreTemplate, legacy: Boolean = true) {
        val key = "genre-template-${template.genre}"
        // create: 같은 id·같은 입력이면 기존 세계관을 돌려준다. 앞선 edit가 미완료로 남은 세계관은 INCOMPLETE라 아래 edit 재시도로 이어 간다.
        val world = try { service.create(TEMPLATE_OWNER, CreateWorldRequest(template.name, template.description, template.worldId)) }
            catch (e: WorldStudioFailure) { if (e.reason == WorldStudioFailure.Reason.INCOMPLETE) null else throw e }
        // save가 draft revision을 올려 같은 edit의 중복 판정이 깨지므로, 저장까지 끝난 세계관은 다시 edit하지 않는다.
        if (world?.currentRevisionId != null) return
        val cards = if (legacy) template.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic") }
            else GenreTemplateRepair.payloads(template)
        val edited = service.edit(template.worldId, TEMPLATE_OWNER, EditWorldDraftRequest(0, template.name, template.description, cards, key = key))
        service.save(template.worldId, TEMPLATE_OWNER, SaveWorldRequest(edited.draftRevision, key))
    }

    companion object {
        /**
         * 템플릿 세계관 소유자: Core auth V8 운영 관리자(admin@example.test, operator=true)의 회원 UUID. 운영자로 로그인하면 세계관 목록에 보인다.
         * 임시 할당이며 한계는 다음과 같다.
         * ① V8 샘플 관리자 비밀번호가 마이그레이션 주석에 공개돼 있어 그 계정으로 로그인하면 누구나 템플릿을 수정·삭제할 수 있다.
         *   실제 운영 계정·공개 템플릿 조회가 생기면 소유자를 바꾼다.
         * ② V8은 `ON CONFLICT (email) DO NOTHING`이라 기존 DB에 admin@example.test가 다른 id로 있으면 이 UUID가 실제 로그인 계정과 다를 수 있다.
         * ③ 다른 사용자에게는 여전히 보이지 않는다(가져오기·공개는 후속).
         * 소유자를 바꿔도 이미 적재된 세계관은 새 소유자로 옮겨지지 않는다(고정 worldId의 create가 소유자 불일치로 거절되어 장르별 오류 로그만 남는다).
         */
        val TEMPLATE_OWNER: UUID = UUID.fromString("5f0c2c7e-8a51-4d6b-9a39-1f4f2b6d0a01")
    }
}

internal data class GenreTemplate(val genre: String, val worldId: UUID, val name: String, val description: String, val cards: List<GenreTemplateCard>)
internal data class GenreTemplateCard(val id: UUID, val title: String, val body: String, val cardType: String)
