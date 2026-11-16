import type { ImageGenerationRepository, ImageRequest } from '../repositories/ImageGenerationRepository'
export class ImageGenerationUseCase {
 constructor(private readonly repository: ImageGenerationRepository) {}
 submit(input: ImageRequest, key: string, signal?: AbortSignal) {
  if (!input.prompt.trim() || input.prompt.length > 12000) throw new Error('장면 설명을 1~12,000자로 입력해 주세요.')
  return this.repository.submit(input, key, signal)
 }
 readByKey(key: string, signal?: AbortSignal) { return this.repository.readByKey(key,signal) }
 read(id: string, signal?: AbortSignal) { return this.repository.read(id, signal) }
 image(id: string, signal?: AbortSignal) { return this.repository.image(id, signal) }
}
