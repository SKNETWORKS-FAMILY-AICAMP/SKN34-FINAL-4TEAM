package ai.storyfork.content.world.domain

import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** 공개 가능한 고정 오류만 보관한다. 드라이버 오류·Cypher·비공개 payload는 포함하지 않는다. */
class WorldStudioFailure(status:HttpStatus,val code:String,val detail:String):ResponseStatusException(status,code) {
    companion object {
        fun migration()=WorldStudioFailure(HttpStatus.CONFLICT,"RELATIONSHIP_MIGRATION_REQUIRED","기존 세계관은 관계 저장소 전환 승인이 필요합니다. 기존 데이터는 변경하지 않았습니다.")
        fun incomplete()=WorldStudioFailure(HttpStatus.SERVICE_UNAVAILABLE,"RELATIONSHIP_WRITE_INCOMPLETE","관계 저장이 미완료입니다. 동일한 요청 키와 입력으로 다시 시도하세요. 현재 관계도를 최신으로 표시하지 않습니다.")
        fun rejected()=WorldStudioFailure(HttpStatus.CONFLICT,"WORLD_WRITE_REJECTED","이 저장 요청은 반영되지 않았습니다. 입력을 보존하고 최신 상태를 다시 조회한 뒤 수정하여 저장하세요.")
        fun mismatch()=WorldStudioFailure(HttpStatus.CONFLICT,"RELATIONSHIP_VERSION_MISMATCH","요청한 세계관과 관계 상태가 일치하지 않습니다. 입력을 보존하고 저장 상태를 확인하세요.")
        fun unavailable()=WorldStudioFailure(HttpStatus.SERVICE_UNAVAILABLE,"RELATIONSHIP_STORE_UNAVAILABLE","관계 저장소에 연결하지 못했습니다. 저장 완료로 처리하지 않았습니다. 같은 입력으로 다시 시도하세요.")
        fun history()=WorldStudioFailure(HttpStatus.CONFLICT,"RELATIONSHIP_HISTORY_UNSUPPORTED","현재 MVP는 관계 이력을 저장하지 않아 과거 세계관 전체 복원을 지원하지 않습니다. 인물·설정 버전은 보존됩니다.")
    }
}
