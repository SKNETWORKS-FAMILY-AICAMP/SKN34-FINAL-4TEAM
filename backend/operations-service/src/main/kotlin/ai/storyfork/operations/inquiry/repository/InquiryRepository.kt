package ai.storyfork.operations.inquiry.repository

import ai.storyfork.operations.inquiry.entity.InquiryEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InquiryRepository : JpaRepository<InquiryEntity, UUID>
