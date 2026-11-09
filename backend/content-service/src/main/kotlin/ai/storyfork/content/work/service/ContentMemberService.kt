package ai.storyfork.content.work.service

import ai.storyfork.content._common.exception.*
import org.springframework.stereotype.Service
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.transaction.support.TransactionTemplate
import ai.storyfork.content.work.entity.*
import ai.storyfork.content.work.repository.*

@Service
class ContentMemberService(
    private val members: MemberRepository,
    @Qualifier("contentTransactionManager") manager: org.springframework.transaction.PlatformTransactionManager,
) {

    private val transaction=TransactionTemplate(manager).apply {propagationBehavior=org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW}
    fun ensure(owner: String) {
        checkContent(owner.isNotBlank() && owner.length<=200,401,"서버 인증이 필요합니다.")
        try {
            transaction.executeWithoutResult {if(!members.existsById(owner)) members.saveAndFlush(MemberEntity(id=owner))}
        } catch(error: org.springframework.dao.DataIntegrityViolationException) {
            // A concurrent first work may already have registered the same credential-free author reference.
            if(!members.existsById(owner)) throw error
        }
    }

}
