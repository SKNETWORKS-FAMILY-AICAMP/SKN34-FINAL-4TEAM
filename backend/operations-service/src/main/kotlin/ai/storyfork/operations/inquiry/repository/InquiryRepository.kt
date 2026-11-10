package ai.storyfork.operations.inquiry.repository

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface InquiryRepository : JpaRepository<InquiryEntity, UUID> {
    /** Member-facing lookups never see legacy service-token records (`member_id IS NULL`). */
    fun findByIdAndMemberIdIsNotNull(id: UUID): InquiryEntity?
    fun findAllByMemberIdOrderByCreatedAtDescIdDesc(memberId: UUID, page: Pageable): List<InquiryEntity>
    fun findAllByMemberIdIsNotNullOrderByCreatedAtDescIdDesc(page: Pageable): List<InquiryEntity>

    /** Status is derived from reply presence; filtering here keeps the page limit applied after the filter. */
    @Query("""
        select i from InquiryEntity i
        where i.memberId is not null and not exists (select r.id from InquiryReplyEntity r where r.inquiryId = i.id)
        order by i.createdAt desc, i.id desc
    """)
    fun findWaitingMemberInquiries(page: Pageable): List<InquiryEntity>

    @Query("""
        select i from InquiryEntity i
        where i.memberId is not null and exists (select r.id from InquiryReplyEntity r where r.inquiryId = i.id)
        order by i.createdAt desc, i.id desc
    """)
    fun findAnsweredMemberInquiries(page: Pageable): List<InquiryEntity>
}
