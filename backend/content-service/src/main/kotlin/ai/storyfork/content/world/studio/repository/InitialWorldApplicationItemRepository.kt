package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.InitialWorldApplicationItem
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface InitialWorldApplicationItemRepository : JpaRepository<InitialWorldApplicationItem, UUID> {
    @org.springframework.data.jpa.repository.Query("select count(i)>0 from InitialWorldApplicationItem i, InitialWorldApplication a where i.applicationId=a.id and i.candidateId=:candidateId and i.active=true and a.status in ('applying','unknown')")
    fun hasPendingApplication(candidateId:UUID):Boolean
    fun existsByCandidateIdAndActiveTrue(candidateId:UUID):Boolean
    fun existsByApplicationIdAndCandidateId(applicationId:UUID,candidateId:UUID):Boolean
    fun findAllByApplicationId(applicationId:UUID):List<InitialWorldApplicationItem>
}
