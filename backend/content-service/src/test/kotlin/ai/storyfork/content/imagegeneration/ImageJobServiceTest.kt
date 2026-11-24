package ai.storyfork.content.imagegeneration
import ai.storyfork.content.imagegeneration.entity.ImageJob
import ai.storyfork.content.imagegeneration.repository.ImageJobRepository
import ai.storyfork.content.imagegeneration.service.ImageJobService
import ai.storyfork.content.imagegeneration.service.ImageReferences
import ai.storyfork.content.imagegeneration.client.ImageJobClient
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.service.AttachmentService
import ai.storyfork.content.world.service.WorldCoverService
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content._common.exception.ContentFailure
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyCollection
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import ai.storyfork.content.imagegeneration.service.dto.ImageRequest
class ImageJobServiceTest {
 private val jobs=mock(ImageJobRepository::class.java)
 private val storage=mock(AttachmentStorageClient::class.java)
 private val manager=mock(PlatformTransactionManager::class.java).also { `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() } }
 private val mapper=JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
 private val client=mock(ImageJobClient::class.java)
 private val references=ImageReferences(mock(AttachmentService::class.java),mock(WorldCoverService::class.java))
 private val service=ImageJobService(jobs,client,storage,mock(WorkAccessService::class.java),mock(WorldStudioService::class.java),mapper,TransactionTemplate(manager),references)
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
  verify(storage).delete("image-generations/$id.png")
 }
 @Test fun `expiration during result validation removes the abandoned PNG`() {
  val job=ImageJob(status="running",input="""{"purpose":"work_cover","prompt":"scene"}""")
  val key="image-generations/${job.id}.png"
  `when`(jobs.lock(job.id)).thenReturn(job)
  `when`(storage.read(key)).thenAnswer {
   job.status="interrupted"
   validCover()
  }
  assertEquals(409,assertThrows(ContentFailure::class.java){service.complete(job.id,key)}.status)
  verify(storage).delete(key)
 }
 @Test fun `a duplicate completion preserves the already committed PNG`() {
  val job=ImageJob(status="succeeded",input="""{"purpose":"work_cover","prompt":"scene"}""")
  val key="image-generations/${job.id}.png"
  `when`(jobs.lock(job.id)).thenReturn(job)
  `when`(storage.read(key)).thenReturn(validCover())
  assertEquals("succeeded",service.complete(job.id,key).status)
  verify(storage,never()).delete(key)
 }
 @Test fun `a result that fails validation fails the job and removes the PNG`() {
  // 형식 오류(AttachmentFailure)와 규격 오류(ContentFailure) 모두 영구 running·잔류 PNG를 남기지 않는다.
  for((purpose,bytes) in listOf("work_cover" to byteArrayOf(1,2,3),"character_profile" to validCover().bytes)) {
   val job=ImageJob(status="running",input="""{"purpose":"${purpose}","prompt":"scene"}""")
   val key="image-generations/${job.id}.png"
   `when`(jobs.lock(job.id)).thenReturn(job)
   `when`(storage.read(key)).thenReturn(AttachmentObjectResult(bytes))
   val status=when(val error=assertThrows(RuntimeException::class.java){service.complete(job.id,key)}) {
    is ContentFailure -> error.status
    is AttachmentFailure -> error.status
    else -> -1
   }
   assertEquals(422,status)
   assertEquals("failed",job.status)
   assertEquals("uploading",job.stage)
   verify(storage).delete(key)
  }
 }
 @Test fun `expiry removes the abandoned result object and the temporary reference`() {
  val old=Instant.now().minusSeconds(600)
  val temporary=ImageJob(status="running",templateVersion="cover-v3",updatedAt=old,
   input="""{"request":{"purpose":"work_cover","prompt":"scene","reference":{"mode":"upload","role":"style"}},"digest":"x","mediaType":"image/png"}""")
  val plain=ImageJob(status="queued",updatedAt=old)
  `when`(jobs.findAllByStatusInAndUpdatedAtBefore(anyCollection(),any(Instant::class.java) ?: Instant.EPOCH)).thenReturn(listOf(temporary,plain))
  `when`(jobs.lock(temporary.id)).thenReturn(temporary)
  `when`(jobs.lock(plain.id)).thenReturn(plain)
  service.expire()
  assertEquals(listOf("interrupted","interrupted"),listOf(temporary.status,plain.status))
  verify(storage).delete("image-generations/${temporary.id}.png")
  verify(storage).delete("image-references/${temporary.id}")
  verify(storage).delete("image-generations/${plain.id}.png")
  verify(storage,never()).delete("image-references/${plain.id}")
 }
 @Test fun `a succeeded job serves the stored PNG without parsing or revalidating it`() {
  val job=ImageJob(owner="alice",status="succeeded")
  `when`(jobs.lock(job.id)).thenReturn(job)
  `when`(storage.read("image-generations/${job.id}.png")).thenReturn(AttachmentObjectResult(byteArrayOf(1)))
  assertArrayEquals(byteArrayOf(1),service.content(job.id,"alice"))
 }
 private fun validCover()=AttachmentObjectResult(java.io.ByteArrayOutputStream().also {
  javax.imageio.ImageIO.write(java.awt.image.BufferedImage(1152,1536,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",it)
 }.toByteArray())
 @Test fun `result key must be tied to job`() {
  assertEquals(422,assertThrows(ContentFailure::class.java){service.complete(UUID.randomUUID(),"someone-else.png")}.status)
  verifyNoInteractions(storage)
 }
 @Test fun `failed callback cannot reverse completed job`() {
  val id=UUID.randomUUID()
  `when`(jobs.lock(id)).thenReturn(ImageJob(id=id,status="succeeded"))
  assertEquals("succeeded",service.failed(id,"uploading").status)
 }
 @Test fun `moderation failure stages survive polling without a preview`() {
  for (stage in listOf("output_blocked", "moderation_unavailable")) {
   val job=ImageJob(owner="alice",status="running",stage="generating")
   `when`(jobs.lock(job.id)).thenReturn(job)
   service.failed(job.id,stage)
   val result=service.read(job.id,"alice")
   assertEquals("failed",result.status)
   assertEquals(stage,result.stage)
   assertNull(result.previewUrl)
   assertEquals(409,assertThrows(ContentFailure::class.java){service.content(job.id,"alice")}.status)
  }
  verifyNoInteractions(storage)
 }
 @Test fun `cover inputs and version are frozen and changed settings conflict`() {
  val owner=UUID.randomUUID().toString();val requestKey=UUID.randomUUID()
  val request=mapper.readValue("""{"purpose":"work_cover","prompt":"새벽 항구","visualSettings":"황동 탑"}""",ImageRequest::class.java)
  var saved:ImageJob?=null
  `when`(jobs.findByOwnerAndRequestKey(owner,requestKey)).thenAnswer { saved }
  `when`(jobs.saveAndFlush(any(ImageJob::class.java))).thenAnswer { invocation ->
   (invocation.arguments[0] as ImageJob).also { saved=it;`when`(jobs.lock(it.id)).thenReturn(it) }
  }
  val accepted=service.submit(owner,requestKey,request)
  val claimed=service.claim(accepted.jobId)
  assertEquals("cover-v2",claimed.input?.templateVersion)
  assertEquals("새벽 항구",claimed.input?.prompt)
  assertEquals("황동 탑",mapper.readTree(mapper.writeValueAsString(claimed.input)).get("visualSettings").asText())
  assertEquals(accepted.jobId,service.submit(owner,requestKey,request).jobId)
  val changed=mapper.readValue("""{"purpose":"work_cover","prompt":"새벽 항구","visualSettings":"흰 석조 탑"}""",ImageRequest::class.java)
  val conflict=assertThrows(ContentFailure::class.java){service.submit(owner,requestKey,changed)}
  assertEquals(409,conflict.status)
  assertEquals("이전 요청과 생성 조건이 달라요. 다시 생성해 주세요.",conflict.message)
 }
 @Test fun `submitting a deleted job again asks the user to generate again`() {
  val owner=UUID.randomUUID().toString()
  val requestKey=UUID.randomUUID()
  val request=mapper.readValue("""{"purpose":"work_cover","prompt":"scene"}""",ImageRequest::class.java)
  val saved=ImageJob(owner=owner,requestKey=requestKey,status="deleted",
   inputHash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(request))))
  `when`(jobs.findByOwnerAndRequestKey(owner,requestKey)).thenReturn(saved)

  val deleted=assertThrows(ContentFailure::class.java){service.submit(owner,requestKey,request)}
  assertEquals(410,deleted.status)
  assertEquals("이전 생성 요청이 삭제됐어요. 다시 생성해 주세요.",deleted.message)
 }
 @Test fun `v1 request hashes and queued snapshots remain compatible`() {
  val owner=UUID.randomUUID().toString();val requestKey=UUID.randomUUID()
  val legacy="""{"purpose":"work_cover","prompt":"legacy scene","workId":null,"worldId":null,"basisRevision":null}"""
  val hash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(legacy.toByteArray()))
  val job=ImageJob(owner=owner,requestKey=requestKey,input=legacy,inputHash=hash,status="queued")
  `when`(jobs.findByOwnerAndRequestKey(owner,requestKey)).thenReturn(job)
  `when`(jobs.lock(job.id)).thenReturn(job)
  assertEquals(job.id,service.submit(owner,requestKey,ImageRequest("work_cover","legacy scene")).jobId)
  assertEquals("v1",service.claim(job.id).input?.templateVersion)
  verify(jobs,never()).saveAndFlush(any(ImageJob::class.java))
 }
 @Test fun `fixed visual settings cannot be silently ignored for illustrations`() {
  val request=mapper.readValue("""{"purpose":"illustration","prompt":"scene","workId":"a-work","visualSettings":"fixed"}""",ImageRequest::class.java)
  assertEquals(422,assertThrows(ContentFailure::class.java){service.submit(UUID.randomUUID().toString(),UUID.randomUUID(),request)}.status)
 }
 @Test fun `reference snapshot precedes enqueue and cannot be changed with the same key`() {
  val owner=UUID.randomUUID().toString()
  val requestKey=UUID.randomUUID()
  val request=mapper.readValue("""{"purpose":"work_cover","prompt":"새벽 항구","reference":{"mode":"upload","role":"subject"}}""",ImageRequest::class.java)
  val data=java.io.ByteArrayOutputStream().also {
   javax.imageio.ImageIO.write(java.awt.image.BufferedImage(8,8,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",it)
  }.toByteArray()
  var saved:ImageJob?=null
  `when`(jobs.findByOwnerAndRequestKey(owner,requestKey)).thenAnswer { saved }
  `when`(jobs.saveAndFlush(any(ImageJob::class.java))).thenAnswer { invocation ->
   (invocation.arguments[0] as ImageJob).also { saved=it;`when`(jobs.lock(it.id)).thenReturn(it) }
  }
  val accepted=service.submit(owner,requestKey,request,data)
  val objectKey="image-references/${accepted.jobId}"
  val order=inOrder(storage,client)
  order.verify(storage).upload(org.mockito.ArgumentMatchers.eq(objectKey) ?: objectKey, any(ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload::class.java)
   ?: ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload(data,"image/png"))
  order.verify(client).submit(accepted.jobId)
  assertEquals("cover-v3",service.claim(accepted.jobId).input?.templateVersion)
  `when`(storage.read(objectKey)).thenReturn(ai.storyfork.content.attachment.client.dto.AttachmentObjectResult(data))
  assertArrayEquals(data,service.reference(accepted.jobId).bytes)
  assertEquals(accepted.jobId,service.submit(owner,requestKey,request,data).jobId)
  val changed=request.copy(reference=request.reference?.copy(role="style"))
  assertEquals(409,assertThrows(ContentFailure::class.java){service.submit(owner,requestKey,changed,data)}.status)
  assertEquals(409,assertThrows(ContentFailure::class.java){service.submit(owner,requestKey,request,data+0.toByte())}.status)
  assertEquals(422,assertThrows(ContentFailure::class.java){service.submit(owner,UUID.randomUUID(),request)}.status)
  service.failed(accepted.jobId,"generating")
  verify(storage).delete(objectKey)
  assertEquals(404,assertThrows(ContentFailure::class.java){service.reference(accepted.jobId)}.status)
 }
}
