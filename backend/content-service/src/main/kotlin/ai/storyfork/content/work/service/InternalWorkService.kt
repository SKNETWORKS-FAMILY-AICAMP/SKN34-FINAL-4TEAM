package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.dto.InternalWorkResponse
import ai.storyfork.content.work.service.dto.OperationsWorkListResponse
import ai.storyfork.content.work.service.dto.OperationsWorkResponse
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 운영 서비스 전용 작품 조회·제한 플래그 변경. 소유권 검사 없이 서비스 토큰으로만 보호된다. */
@Service
@Transactional(transactionManager="contentTransactionManager")
class InternalWorkService(private val works: WorkRepository) {
    fun read(id: String) = view(works.findById(id).orElse(null) ?: missing())

    /**
     * 공개·비공개·제한 작품 전체. 행마다 추가 조회하지 않고 목록 쿼리 한 번의 결과만 옮긴다.
     * ponytail: 페이지네이션 없이 전체를 한 번에 준다. 작품이 많아지면 서버 필터·페이지로 옮긴다(operations-work-contract.md).
     */
    fun list() = OperationsWorkListResponse(works.listForOperations().map { row ->
        val w = row[0] as WorkEntity
        OperationsWorkResponse(w.id, w.ownerId, w.title, w.authorName, w.originKind, w.creationType, row[1] as Boolean, row[2] as String? ?: "private", w.restricted)
    })

    /** 작가 수정과 같은 작품 행 잠금으로 직렬화해 전체 행 저장이 플래그를 덮어쓰지 않게 한다. */
    fun restrict(id: String, restricted: Boolean): InternalWorkResponse {
        val row = works.lockAll(listOf(id)).singleOrNull() ?: missing()
        row.restricted = restricted
        return view(row)
    }

    private fun view(w: WorkEntity) = InternalWorkResponse(w.id, w.ownerId, w.title, w.restricted)
    private fun missing(): Nothing = throw ContentFailure(404, "작품을 찾을 수 없어요.")
}
