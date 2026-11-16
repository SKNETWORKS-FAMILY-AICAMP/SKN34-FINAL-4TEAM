package ai.storyfork.content.imagegeneration
import ai.storyfork.content.imagegeneration.entity.ImageJob
import ai.storyfork.content.imagegeneration.repository.ImageJobRepository
import ai.storyfork.content.imagegeneration.service.ImageJobService
import ai.storyfork.content.imagegeneration.client.ImageJobClient
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content._common.exception.ContentFailure
import java.util.UUID
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
class ImageJobServiceTest {
 private val jobs=mock(ImageJobRepository::class.java)
 private val storage=mock(AttachmentStorageClient::class.java)
 private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
 private val service=ImageJobService(jobs,mock(ImageJobClient::class.java),storage,mock(WorkAccessService::class.java),mock(WorldStudioService::class.java),JsonMapper.builder().build(),TransactionTemplate(manager))
 @Test fun `another owner cannot see job or bytes`() {
  val id=UUID.randomUUID()
  `when`(jobs.lock(id)).thenReturn(ImageJob(id=id,owner="alice",status="succeeded"))
  assertEquals(404,assertThrows(ContentFailure::class.java){service.read(id,"bob")}.status)
  assertThrows(ContentFailure::class.java){service.content(id,"bob")}
  verifyNoInteractions(storage)
 }
 @Test fun `late success cannot overwrite interrupted result`() {
  val id=UUID.randomUUID()
  `when`(jobs.lock(id)).thenReturn(ImageJob(id=id,status="interrupted"))
  assertEquals(409,assertThrows(ContentFailure::class.java){service.complete(id,"image-generations/$id.png")}.status)
  verifyNoInteractions(storage)
 }
 @Test fun `result key must be tied to job`() {
  assertEquals(422,assertThrows(ContentFailure::class.java){service.complete(UUID.randomUUID(),"someone-else.png")}.status)
  verifyNoInteractions(storage)
 }
 @Test fun `failed callback cannot reverse completed job`() {
  val id=UUID.randomUUID()
  `when`(jobs.lock(id)).thenReturn(ImageJob(id=id,status="succeeded"))
  assertEquals("succeeded",service.failed(id,"uploading").status)
 }
}
