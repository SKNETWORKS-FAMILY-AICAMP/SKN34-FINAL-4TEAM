import type { ImageGenerationRepository, ImageRequest } from '../repositories/ImageGenerationRepository'

export function referenceFileError(file:File) {
 if (file.size === 0 || file.size > 5 * 1024 * 1024) return '참고 이미지는 5 MiB 이하의 파일을 올려 주세요.'
 if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return 'PNG·JPEG·WebP 참고 이미지를 선택해 주세요.'
}

export class ImageGenerationUseCase {
 private readonly repository: ImageGenerationRepository
 constructor(repository: ImageGenerationRepository) { this.repository=repository }
 submit(input: ImageRequest, key: string, signal?: AbortSignal) {
  if (!input.prompt.trim() || input.prompt.length > 12000) throw new Error('장면 설명을 1~12,000자로 입력해 주세요.')
  if ((input.visualSettings?.length ?? 0) > 6000) throw new Error('고정 시각 설정은 6,000자 이하로 입력해 주세요.')
  if (input.visualSettings && !['work_cover','world_cover'].includes(input.purpose)) throw new Error('고정 시각 설정은 표지 생성에서만 사용할 수 있어요.')
  if ((input.reference || input.referenceFile) && !['work_cover','world_cover'].includes(input.purpose)) throw new Error('참고 이미지는 표지 생성에서 사용할 수 있어요.')
  if ((input.reference?.mode === 'upload') !== !!input.referenceFile) throw new Error('참고 이미지 파일을 선택해 주세요.')
  if (input.referenceFile) {
   const issue=referenceFileError(input.referenceFile)
   if(issue) throw new Error(issue)
  }
  return this.repository.submit(input, key, signal)
 }
 readByKey(key: string, signal?: AbortSignal) { return this.repository.readByKey(key,signal) }
 read(id: string, signal?: AbortSignal) { return this.repository.read(id, signal) }
 image(id: string, signal?: AbortSignal) { return this.repository.image(id, signal) }
}
