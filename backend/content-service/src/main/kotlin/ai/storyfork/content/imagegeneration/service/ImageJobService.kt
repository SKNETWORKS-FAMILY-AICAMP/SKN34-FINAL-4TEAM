package ai.storyfork.content.imagegeneration.service
import ai.storyfork.content.imagegeneration.entity.ImageJob
import ai.storyfork.content.imagegeneration.repository.ImageJobRepository
import ai.storyfork.content.imagegeneration.service.dto.*
import ai.storyfork.content.imagegeneration.client.ImageJobClient
import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectPayload
import ai.storyfork.content.attachment.helper.AttachmentUploadHelper
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.service.WorldStudioService
import java.time.Instant
import java.util.UUID
import java.io.ByteArrayInputStream
import javax.imageio.ImageIO
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.scheduling.annotation.Scheduled
import tools.jackson.databind.json.JsonMapper

/** 작업·권한의 정본. 원격 호출은 잠금 밖에서 실행한다. */
@Service
class ImageJobService(private val jobs:ImageJobRepository,private val client:ImageJobClient,
 private val storage:AttachmentStorageClient,private val access:WorkAccessService,private val worlds:WorldStudioService,
 private val mapper:JsonMapper,@Qualifier("contentTransactions") private val tx:TransactionTemplate,
 private val references:ImageReferences) {
 private val log=LoggerFactory.getLogger(javaClass)
 private fun <T:Any> transaction(action:()->T):T= requireNotNull(tx.execute { action() })
 private fun missing():Nothing=throw ContentFailure(404,"이미지 작업을 찾을 수 없어요.")
 private fun locked(id:UUID)=jobs.lock(id) ?: missing()
 private fun owned(id:UUID,owner:String)=locked(id).also { if(it.owner!=owner || it.status=="deleted") missing() }
 private fun referenced(j:ImageJob)=mapper.readValue(j.input,ReferencedImageRequest::class.java)
 private fun input(j:ImageJob)=if(j.templateVersion=="cover-v3") referenced(j).request else mapper.readValue(j.input,ImageRequest::class.java)
 private fun key(id:UUID)="image-generations/$id.png"
 private fun referenceKey(id:UUID)="image-references/$id"
 private fun hasTemporaryReference(j:ImageJob)=j.templateVersion=="cover-v3" && referenced(j).request.reference?.mode!="preset"
 private fun discardReference(id:UUID) {
  try { storage.delete(referenceKey(id)) }
  catch(_:Exception) { log.warn("이미지 작업의 참조 파일을 정리하지 못했어요. jobId={}",id) }
 }
 private fun digest(bytes:ByteArray)=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes))
 fun preset(version:String)=references.preset(version)
 private fun response(j:ImageJob)=ImageResult(j.id,j.status,j.stage,if(j.status=="succeeded") "/api/v1/image-generations/${j.id}/content" else null,j.model,j.quality)
 private fun authorize(r:ImageRequest,owner:String) {
  if(r.visualSettings.isNotEmpty() && r.purpose !in setOf("work_cover","world_cover")) throw ContentFailure(422,"고정 시각 설정은 표지 생성에서만 사용할 수 있어요.")
  r.workId?.let { id -> val work=access.own(id,owner)
   if(work.restricted) throw ContentFailure(403,"이 작품에서는 AI 생성을 사용할 수 없어요.")
   r.basisRevision?.let { access.requireRevision(work,it) }
  }
  r.worldId?.let { worlds.draft(it,UUID.fromString(owner)) }
  if(r.purpose=="illustration" && r.workId==null) throw ContentFailure(422,"원고의 작품을 지정해 주세요.")
  if(r.purpose in setOf("world_cover","character_profile") && r.worldId==null) throw ContentFailure(422,"세계관을 지정해 주세요.")
 }
 fun submit(owner:String,requestKey:UUID,r:ImageRequest,upload:ByteArray?=null):ImageResult {
  references.validate(r,upload)
  val json=mapper.writeValueAsString(r)
  val uploadHash=upload?.let(::digest)
  val hash=digest((if(uploadHash==null) json else "$json\n$uploadHash").toByteArray(Charsets.UTF_8))
  fun existing():ImageResult?=tx.execute { jobs.findByOwnerAndRequestKey(owner,requestKey)?.let {
   if(it.inputHash!=hash) throw ContentFailure(409,"이전 요청과 생성 조건이 달라요. 다시 생성해 주세요.")
   if(it.status=="deleted") throw ContentFailure(410,"이전 생성 요청이 삭제됐어요. 다시 생성해 주세요.")
   response(it)
  } }
  existing()?.let { return it }
  authorize(r,owner)
  val reference=r.reference?.let { references.snapshot(r,owner,upload) }
  val version=when {
   reference!=null -> "cover-v3"
   r.purpose in setOf("work_cover","world_cover") -> "cover-v2"
   else -> "v1"
  }
  val snapshot=reference?.let { mapper.writeValueAsString(ReferencedImageRequest(r,uploadHash ?: digest(it.bytes),it.mediaType)) } ?: json
  val job=try { transaction { jobs.saveAndFlush(ImageJob(owner=owner,requestKey=requestKey,input=snapshot,inputHash=hash,templateVersion=version)) } }
  catch(e:DataIntegrityViolationException) { return existing() ?: throw e }
  val temporary=reference!=null && r.reference?.mode!="preset"
  try {
   if(temporary) {
    storage.upload(referenceKey(job.id),requireNotNull(reference))
    if(!transaction { locked(job.id).status=="accepted" }) {
     discardReference(job.id)
     return read(job.id,owner)
    }
   }
   client.submit(job.id)
   transaction { locked(job.id).also { if(it.status=="accepted") { it.status="queued"; it.stage="waiting"; it.updatedAt=Instant.now() } }; true }
  } catch(_:Exception) {
   // 큐 등록 응답이 유실됐을 수 있어 자동 재접수하지 않는다. 선점 전 작업만 중단한다.
   val stopped=transaction {
    val current=locked(job.id)
    if(current.status!="accepted") false else {
     current.status="interrupted"; current.stage="dispatching"; true
    }
   }
   if(stopped && temporary) discardReference(job.id)
  }
  return read(job.id,owner)
 }
 fun byKey(key:UUID,owner:String)=transaction { jobs.findByOwnerAndRequestKey(owner,key)?.takeIf { it.status!="deleted" }?.let(::response) ?: missing() }
 fun read(id:UUID,owner:String)=transaction { response(owned(id,owner)) }
 fun claim(id:UUID):ImageClaim {
  val (result,discard)=transaction {
   val job=locked(id)
   val previous=job.status
   if(!job.claim()) {
    ImageClaim(false) to (previous!=job.status && hasTemporaryReference(job))
   } else input(job).let {
    ImageClaim(true,ImageInput(it.purpose,it.prompt,job.model,job.quality,job.templateVersion,it.visualSettings,it.reference?.role)) to false
   }
  }
  if(discard) discardReference(id)
  return result
 }
 fun reference(id:UUID):AttachmentObjectPayload {
  val snapshot=transaction {
   val job=locked(id)
   if(!job.running() || job.templateVersion!="cover-v3") missing()
   referenced(job)
  }
  val preset=snapshot.request.reference?.presetVersion
  val bytes=if(preset!=null) references.preset(preset).bytes else storage.read(referenceKey(id)).bytes
  check(digest(bytes)==snapshot.digest) { "IMAGE_REFERENCE_CHANGED" }
  return AttachmentObjectPayload(bytes,snapshot.mediaType)
 }
 fun progress(id:UUID,stage:String)=transaction {
  val job=locked(id)
  if(!job.running() || stage!="uploading") throw ContentFailure(409,"실행 중인 이미지 작업을 확인해 주세요.")
  job.stage=stage; job.updatedAt=Instant.now(); response(job)
 }
 fun failed(id:UUID,stage:String,interrupted:Boolean=false):ImageResult {
  val (result,discard)=transaction {
   val job=locked(id)
   val wasRunning=job.running()
   if(wasRunning) {
    job.status=if(interrupted) "interrupted" else "failed"
    job.stage=when {
     stage=="uploading" -> stage
     !interrupted && stage in setOf("output_blocked","moderation_unavailable") -> stage
     else -> "generating"
    }
    job.updatedAt=Instant.now()
   }
   response(job) to (wasRunning && hasTemporaryReference(job))
  }
  if(discard) discardReference(id)
  return result
 }
 fun complete(id:UUID,suppliedKey:String):ImageResult {
  if(suppliedKey!=key(id)) throw ContentFailure(422,"결과 키가 작업과 다릅니다.")
  val request=tx.execute {
   val job=locked(id)
   if(job.running() || job.status=="succeeded") input(job) else null
  } ?: rejectCompletion(id)
  val bytes=storage.read(key(id)).bytes
  try { validate(bytes,request.purpose) }
  catch(e:Exception) {
   // 규격·형식이 맞지 않는 결과는 running으로 남기지 않고 실패로 닫은 뒤 PNG를 지운다.
   failed(id,"uploading")
   discardAbandonedResult(id)
   throw e
  }
  val (result,discard)=tx.execute {
   val job=locked(id)
   if(!job.running() && job.status!="succeeded") return@execute null
   val wasRunning=job.running()
   job.status="succeeded";job.stage="completed";job.updatedAt=Instant.now()
   response(job) to (wasRunning && hasTemporaryReference(job))
  } ?: rejectCompletion(id)
  if(discard) discardReference(id)
  return result
 }
 private fun discardAbandonedResult(id:UUID) {
  // 종료 상태는 다시 실행되지 않는다. 성공이 커밋된 결과나 아직 실행 가능한 결과는 보존한다.
  if(!transaction { locked(id).status in setOf("failed","interrupted","deleted") }) return
  try { storage.delete(key(id)) }
  catch(_:Exception) { log.warn("종료된 이미지 작업의 결과 파일을 정리하지 못했어요. jobId={}",id) }
 }
 private fun rejectCompletion(id:UUID):Nothing {
  discardAbandonedResult(id)
  throw ContentFailure(409,"종료된 이미지 작업입니다.")
 }
 fun content(id:UUID,owner:String):ByteArray {
  // succeeded는 complete()가 결과를 검증한 뒤에만 되므로 읽을 때 다시 검증하지 않는다.
  transaction { if(owned(id,owner).status!="succeeded") throw ContentFailure(409,"이미지 생성이 완료되지 않았어요.") }
  return storage.read(key(id)).bytes
 }
 fun delete(id:UUID,owner:String) {
  val hasReference=transaction { val job=locked(id)
   if(job.owner!=owner) missing()
   if(job.status in setOf("accepted","queued","running")) throw ContentFailure(409,"실행 중인 작업은 삭제할 수 없어요.")
   job.status="deleted";job.input="{}";job.templateVersion=="cover-v3" }
  if(hasReference) storage.delete(referenceKey(id))
  storage.delete(key(id))
 }
 private fun validate(bytes:ByteArray,purpose:String) {
  if(bytes.size>5*1024*1024) throw ContentFailure(422,"생성 이미지가 용량 한도를 넘었어요.")
  AttachmentUploadHelper.validateImage(bytes,"image/png")
  val image=ImageIO.read(ByteArrayInputStream(bytes)) ?: throw ContentFailure(422,"생성 이미지가 잘못됐어요.")
  val size=when(purpose) { "character_profile" -> 1024 to 1024; "illustration" -> 1536 to 1024; else -> 1152 to 1536 }
  if(image.width!=size.first || image.height!=size.second) throw ContentFailure(422,"생성 이미지 규격이 달라요.")
 }
 /** 대기·실행 유실을 영구 로딩으로 남기지 않는다. 자동 재생성은 하지 않는다. */
 @Scheduled(fixedDelay=30000)
 fun expire() {
  val ids=transaction { jobs.findAllByStatusInAndUpdatedAtBefore(listOf("accepted","queued","running"),Instant.now().minusSeconds(300)).map { it.id } }
  if(ids.isEmpty()) return
  // 후보 조회의 JPA 캐시를 닫아야 잠금 뒤 이미 완료된 작업을 최신 상태로 다시 읽는다.
  val expired=transaction {
   ids.mapNotNull { id ->
    val job=locked(id)
    if(job.status !in setOf("accepted","queued","running") || !job.updatedAt.isBefore(Instant.now().minusSeconds(300))) null
    else { job.status="interrupted"; id to hasTemporaryReference(job) }
   }
  }
  // 업로드 뒤 완료 보고가 유실된 작업의 결과 파일도 남기지 않는다. 없는 키의 삭제는 멱등이다.
  expired.forEach { (id,temporary) -> if(temporary) discardReference(id); discardAbandonedResult(id) }
 }
}
