import { imageMarker, imageReferencePattern } from './media'

/**
 * 편집기가 그리는 원고: 문단과 이미지 블록만 있다. 에디터 JSON과 모양이 같아 그대로 주고받는다.
 * 저장 형식은 기존 그대로 일반 텍스트 + `[[image:<id>]]` 표식이고, 한 줄 = 한 문단, 표식만 있는 줄 = 이미지 블록이다.
 */
export type ManuscriptNode =
  | { type: 'paragraph'; content?: { type: 'text'; text: string }[] }
  | { type: 'episodeImage'; attrs: { imageId: string } }
export type ManuscriptDoc = { type: 'doc'; content: ManuscriptNode[] }

// docToBody가 받는 느슨한 모양: 에디터가 돌려주는 JSON을 그대로 넘긴다.
type Loose = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Loose[] }

const imageLine = new RegExp(`^${imageReferencePattern.source}$`, 'i')

/** 본문 문자열을 줄 단위로 나눠 문서로 만든다. 어떤 문자열이든 `docToBody(bodyToDoc(body)) === body`다. */
export function bodyToDoc(body: string): ManuscriptDoc {
  return {
    type: 'doc',
    content: body.split('\n').map((line): ManuscriptNode => {
      const imageId = imageLine.exec(line)?.[1]
      // 표식을 다시 만든 문자열이 줄과 다르면(예: [[IMAGE:…]]) 이미지가 아니라 글자로 남겨 왕복이 무손실이게 한다.
      if (imageId && imageMarker(imageId) === line) return { type: 'episodeImage', attrs: { imageId } }
      return line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
    }),
  }
}

/** 문서를 본문 문자열로 되돌린다: 문단은 줄바꿈으로 잇고 이미지 블록은 표식 한 줄이 된다. */
export function docToBody(doc: Loose): string {
  return (doc.content ?? [])
    .map(node => node.type === 'episodeImage' ? imageMarker(String(node.attrs?.imageId)) : (node.content ?? []).map(t => t.text ?? '').join(''))
    .join('\n')
}
