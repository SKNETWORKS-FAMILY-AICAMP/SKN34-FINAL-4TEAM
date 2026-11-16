export type ImageRequest = { purpose: 'character_profile' | 'world_cover' | 'work_cover' | 'illustration'; prompt: string; workId?: string; worldId?: string }
export type ImageJob = { jobId: string; status: string; stage: string; previewUrl: string | null }
export interface ImageGenerationRepository {
 submit(input: ImageRequest, key: string, signal?: AbortSignal): Promise<ImageJob>
 readByKey(key: string, signal?: AbortSignal): Promise<ImageJob | null>
 read(id: string, signal?: AbortSignal): Promise<ImageJob | null>
 image(id: string, signal?: AbortSignal): Promise<Blob>
}
