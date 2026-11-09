import son from './presentation-assets/son.jpg'
import father from './presentation-assets/father.jpg'
import mother from './presentation-assets/mother.jpg'

/** 중간발표 PPT 인물 이미지. 발표용 목업 빌드(`--mode mockup`)에서만 인물 이름과 연결합니다. */
const portraits: Record<string, string> = { 홍길동: son, 길동: son, 홍문: father, '홍 승상': father, 춘섬: mother }

export function presentationPortrait(name: string) {
  return import.meta.env.MODE === 'mockup' ? portraits[name] : undefined
}
