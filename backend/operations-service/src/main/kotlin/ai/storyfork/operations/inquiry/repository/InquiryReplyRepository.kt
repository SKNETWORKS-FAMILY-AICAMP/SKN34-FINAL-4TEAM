package ai.storyfork.operations.inquiry.repository

import ai.storyfork.operations.inquiry.entity.InquiryReplyEntity
import java.util.UUID
import org.springframework.data.domain.Page
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository

interface InquiryReplyRepository : JpaRepository<InquiryReplyEntity, UUID> {
    fun findAllByInquiryId(inquiryId: UUID, pageable: Pageable): Page<InquiryReplyEntity>
    fun findByIdAndInquiryId(id: UUID, inquiryId: UUID): InquiryReplyEntity?
    fun existsByInquiryId(inquiryId: UUID): Boolean
}
