import son from './presentation-assets/son.png'
import father from './presentation-assets/father.png'
import mother from './presentation-assets/mother.png'

/** Images used in the presentation deck, shared by seeded documents and avatars. */
export const presentationPortraits: Record<string, string> = {
  길동: son,
  홍길동: son,
  홍문: father,
  '홍 승상': father,
  춘섬: mother,
}

export function presentationPortrait(name: string) {
  return import.meta.env.MODE === 'presentation' ? presentationPortraits[name] : undefined
}
