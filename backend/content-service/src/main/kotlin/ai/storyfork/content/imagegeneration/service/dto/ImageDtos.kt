package ai.storyfork.content.imagegeneration.service.dto
import jakarta.validation.constraints.*
import java.util.UUID

data class ImageRequest(
 @field:Pattern(regexp="character_profile|world_cover|work_cover|illustration") val purpose:String,
 @field:NotBlank @field:Size(max=12000) val prompt:String,
 val workId:String?=null, val worldId:UUID?=null, val basisRevision:Int?=null,
)
data class ImageResult(val jobId:UUID,val status:String,val stage:String,val previewUrl:String?,
 val model:String="gpt-image-2.6-flare",val quality:String="high")
data class ImageInput(val purpose:String,val prompt:String,val model:String="gpt-image-2.6-flare",val quality:String="high",val templateVersion:String="v1")
data class ImageClaim(val claimed:Boolean,val input:ImageInput?=null)
data class ImageProgress(val stage:String)
data class ImageCompletion(val key:String)
data class ImageDispatch(val jobId:UUID)
