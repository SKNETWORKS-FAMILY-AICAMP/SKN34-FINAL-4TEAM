package ai.storyfork.content.imagegeneration

import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.imagegeneration.client.ImageJobClient
import ai.storyfork.content.imagegeneration.entity.ImageJob
import ai.storyfork.content.imagegeneration.repository.ImageJobRepository
import ai.storyfork.content.imagegeneration.service.ImageJobService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldStudioService
import java.time.Instant
import java.util.UUID
import org.hibernate.cfg.Configuration
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.*
import org.mockito.AdditionalAnswers.delegatesTo
import org.mockito.Mockito.*
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory
import org.springframework.orm.jpa.JpaTransactionManager
import org.springframework.orm.jpa.SharedEntityManagerCreator
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

class ImageJobExpiryIntegrationTest {
 @Test fun `expiry does not overwrite a completion committed after candidate selection`() {
  Configuration().addAnnotatedClass(ImageJob::class.java)
   .setProperty("hibernate.connection.driver_class","org.h2.Driver")
   .setProperty("hibernate.connection.url","jdbc:h2:mem:${UUID.randomUUID()};DB_CLOSE_DELAY=-1")
   .setProperty("hibernate.hbm2ddl.auto","create-drop")
   .buildSessionFactory().use { factory ->
    val manager=JpaTransactionManager(factory)
    val tx=TransactionTemplate(manager)
    val concurrent=TransactionTemplate(manager).apply { propagationBehavior=TransactionDefinition.PROPAGATION_REQUIRES_NEW }
    val actual=JpaRepositoryFactory(SharedEntityManagerCreator.createSharedEntityManager(factory)).getRepository(ImageJobRepository::class.java)
    val finished=ImageJob(status="running",updatedAt=Instant.now().minusSeconds(600))
    val stale=ImageJob(status="queued",updatedAt=Instant.now().minusSeconds(600))
    tx.execute { actual.saveAndFlush(finished);actual.saveAndFlush(stale) }
    val jobs=mock(ImageJobRepository::class.java,delegatesTo<Any>(actual))
    doAnswer { call ->
     val selected=actual.findAllByStatusInAndUpdatedAtBefore(call.getArgument(0),call.getArgument(1))
     concurrent.execute {
      actual.findById(finished.id).orElseThrow().apply { status="succeeded";updatedAt=Instant.now() }
     }
     selected
    }.`when`(jobs).findAllByStatusInAndUpdatedAtBefore(anyCollection(),any(Instant::class.java) ?: Instant.EPOCH)
    val service=ImageJobService(jobs,mock(ImageJobClient::class.java),mock(AttachmentStorageClient::class.java),
     mock(WorkAccessService::class.java),mock(WorldStudioService::class.java),JsonMapper.builder().build(),tx)

    service.expire()

    tx.execute {
     assertEquals("succeeded",actual.findById(finished.id).orElseThrow().status)
     assertEquals("interrupted",actual.findById(stale.id).orElseThrow().status)
    }
   }
 }
}
