export const DEFAULT_COVER_REFERENCE = 'landscape-v1'
export type CoverReferenceRole = 'style' | 'subject'
export type CoverReference =
 | { mode:'preset'; role:'style'; presetVersion:string }
 | { mode:'upload'|'cover'; role:CoverReferenceRole }
export type ImageRequest = { purpose: 'character_profile' | 'world_cover' | 'work_cover' | 'illustration'; prompt: string; visualSettings?: string; workId?: string; worldId?: string; reference?: CoverReference; referenceFile?: File }
export type ImageJob = { jobId: string; status: string; stage: string; previewUrl: string | null }
/** 서버가 접수를 받아들이지 않았다(4xx). message는 사용자에게 그대로 보여 줄 서버 안내다. */
export class ImageRequestRejected extends Error {}
export interface ImageGenerationRepository {
 submit(input: ImageRequest, key: string, signal?: AbortSignal): Promise<ImageJob>
 readByKey(key: string, signal?: AbortSignal): Promise<ImageJob | null>
 read(id: string, signal?: AbortSignal): Promise<ImageJob | null>
 image(id: string, signal?: AbortSignal): Promise<Blob>
}
