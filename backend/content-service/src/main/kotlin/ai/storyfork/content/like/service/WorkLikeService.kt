package ai.storyfork.content.like.service

import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.like.entity.WorkLikeEntity
import ai.storyfork.content.like.repository.WorkLikeRepository
import ai.storyfork.content.like.service.dto.WorkLikeResponse
import ai.storyfork.content.work.service.WorkAccessService
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional

/** 공개 작품 좋아요(작품당 회원 1회)와 작품별 좋아요 수 집계를 맡는다. 수는 공개하고 누른 회원은 요청한 본인의 `liked`로만 알린다. */
@Service
@Transactional(transactionManager="contentTransactionManager")
class WorkLikeService(
    private val access: WorkAccessService,
    private val likes: WorkLikeRepository,
) {

    /**
     * 공개 작품에 좋아요를 누른다. 이미 눌렀으면 그대로 두며(멱등) 비공개·제한·없는 작품은 404다. 작가 본인도 누를 수 있다.
     * 같은 회원의 동시 요청이 PK를 겹쳐 쓰는 실패를 삼켜도 다른 호출이 오염되지 않도록(PostgreSQL은 실패한 트랜잭션을 이어 쓰지 못한다)
     * 서비스 트랜잭션은 쓰지 않고 저장소 호출마다 각자 트랜잭션을 가진다.
     */
    @Transactional(transactionManager="contentTransactionManager", propagation=Propagation.NOT_SUPPORTED)
    fun like(id: String, member: String): WorkLikeResponse {
        requireMember(member)
        access.published(id)
        val key=WorkLikeEntity.Key(id,member)
        if(!likes.existsById(key)) {
            try {
                likes.saveAndFlush(WorkLikeEntity(id,member))
            } catch(error: DataIntegrityViolationException) {
                // 같은 회원의 동시 요청이 방금 저장했다면 이미 누른 것이므로 무시한다.
                if(!likes.existsById(key)) throw error
            }
        }
        return WorkLikeResponse(likes.countByWorkId(id),true)
    }

    /** 좋아요를 취소한다. 누르지 않았어도 성공하며(멱등) 비공개·제한·없는 작품은 404다. */
    fun unlike(id: String, member: String): WorkLikeResponse {
        requireMember(member)
        access.published(id)
        likes.deleteLike(id,member)
        return WorkLikeResponse(likes.countByWorkId(id),false)
    }

    /**
     * 작품 id 묶음의 좋아요 수를 한 번에 센다. 좋아요가 없는 작품은 맵에 담지 않으니 호출부가 0으로 본다.
     * ponytail: 공개 목록 전체를 IN으로 보내므로 JDBC 바인딩 한도(32767)까지만 된다. 작품이 그만큼 늘면 목록 페이지네이션과 함께 나눈다.
     */
    fun counts(ids: Collection<String>): Map<String, Long> =
        if(ids.isEmpty()) emptyMap() else likes.countByWork(ids).associate { row -> row[0] as String to (row[1] as Number).toLong() }

    /** 이 회원이 작품에 좋아요를 눌렀는지 본다. */
    fun liked(id: String, member: String): Boolean = likes.existsById(WorkLikeEntity.Key(id,member))

    private fun requireMember(member: String) = checkContent(member.isNotBlank() && member.length<=200,401,"서버 인증이 필요합니다.")

}
