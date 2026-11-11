package ai.storyfork.content.world.controller

import ai.storyfork.content.world.domain.*
import ai.storyfork.content.world.domain.WorldStudioFailure.Reason
import ai.storyfork.content.world.service.dto.WorldStudioErrorResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.dao.DataAccessException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.transaction.TransactionException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 비공개 입력·SQL·Cypher·드라이버 오류를 응답이나 로그에 노출하지 않는다. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes=[WorldStudioController::class,InitialWorldAnalysisController::class,InitialWorldApplicationController::class])
class WorldStudioExceptionHandler {
    @ExceptionHandler(ai.storyfork.content.world.service.InitialWorldReviewConflict::class)
    fun reviewConflict(error:ai.storyfork.content.world.service.InitialWorldReviewConflict)=ResponseEntity.status(409).body(WorldStudioErrorResponse(error.code,
        if(error.code=="ANALYSIS_STALE") "원본이 변경되었습니다. 재분석 후 검토하세요." else "완료된 분석 후보만 처리할 수 있습니다."))
    @ExceptionHandler(WorldStudioFailure::class)
    fun failure(error:WorldStudioFailure)=ResponseEntity.status(status(error.reason)).body(WorldStudioErrorResponse(error.code,error.detail))
    private fun status(reason:Reason)=when(reason) {
        Reason.MIGRATION,Reason.REJECTED,Reason.MISMATCH,Reason.HISTORY->HttpStatus.CONFLICT
        Reason.INCOMPLETE,Reason.UNAVAILABLE->HttpStatus.SERVICE_UNAVAILABLE
    }
    @ExceptionHandler(WorldNotFound::class)
    fun missing()=ResponseEntity.status(404).body(WorldStudioErrorResponse("WORLD_NOT_FOUND","세계관을 찾을 수 없습니다."))
    @ExceptionHandler(WorldConflict::class)
    fun conflict()=ResponseEntity.status(409).body(WorldStudioErrorResponse("WORLD_CONFLICT","다른 편집본 또는 저장 요청과 충돌했습니다. 입력을 보존하고 상태를 확인하세요."))
    @ExceptionHandler(IllegalArgumentException::class)
    fun invalid()=ResponseEntity.status(422).body(WorldStudioErrorResponse("WORLD_INPUT_INVALID","이름·내용 길이, 카드·관계 ID와 입력 값을 확인하세요."))
    @ExceptionHandler(DataAccessException::class,TransactionException::class)
    fun persistence()=ResponseEntity.status(503).body(WorldStudioErrorResponse("WORLD_WRITE_UNCONFIRMED","저장 완료를 확인하지 못했습니다. 입력을 보존하고 동일 요청으로 다시 시도하세요."))
}
