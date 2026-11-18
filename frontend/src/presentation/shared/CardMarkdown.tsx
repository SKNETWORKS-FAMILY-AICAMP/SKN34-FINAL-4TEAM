import type { ReactNode } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cardLinkOf } from '../../domain/entities/cardLinks'
import './CardMarkdown.css'

/** 본문의 `#`·`##`은 페이지 제목(h1)·문단 제목(h2)과 겹치지 않게 h3로 두고 더 깊은 제목도 h6까지만 한 단계씩 내린다. */
const heading = (Tag: 'h3' | 'h4' | 'h5' | 'h6') => ({ children }: { children?: ReactNode }) => <Tag>{children}</Tag>

const components: Components = {
  h1: heading('h3'), h2: heading('h3'), h3: heading('h4'), h4: heading('h5'), h5: heading('h6'), h6: heading('h6'),
  // 외부 이미지는 불러오지 않고 대체 글자만 보인다.
  img: ({ alt }) => <>{alt}</>,
}
// 물결표 하나(`1~3화`)는 취소선이 아니다: 취소선은 `~~글자~~`만.
const remarkPlugins: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }]]

/** 설정 링크(DEC-53) 하나를 그리는 방법: 대상 카드로 가는 링크 요소를 돌려주고, 갈 곳이 없으면(응답에 없는 카드) undefined라 글자만 보인다. */
export type CardLinkRender = (cardId: string, label: ReactNode) => ReactNode

/**
 * 설정 카드 본문(마크다운 문자열)을 그린다: GFM(표·목록·취소선·자동 링크). 원시 HTML은 요소로 그리지 않고 글자 그대로 보인다(`rehype-raw`를 쓰지 않는다).
 * 공개 카드 페이지의 문단 본문과 독자 설정 위키가 함께 쓴다. 외부 링크는 새 탭에서 열고 안전하지 않은 주소(javascript: 등)는 링크 없이 글자만 둔다.
 * 설정 링크(`[글자](card:<uuid>)`)는 [cardLink]가 있어야 링크로 그린다(없거나 undefined를 돌려주면 글자만): 어디로 갈지는 쓰는 화면이 정한다(카드 페이지·위키 문서).
 * 파서는 정규식이 링크로 보지 않는 모양(`<card:id>`·`[글자](<card:id>)`·제목이 붙은 링크·글자에 대괄호나 줄바꿈이 든 링크)도 `card:` 주소로 읽지만(기본 주소 변환이 그 주소를 비운다),
 * 설정 링크로 그리는 것은 그 노드의 원문이 정규식에 맞을 때뿐이다(`cardLinkOf`). 그 밖의 모양은 글자만 보인다.
 */
export const CardMarkdown = ({ text, cardLink }: { text: string; cardLink?: CardLinkRender }) => (
  <div className="card-md">
    <Markdown
      remarkPlugins={remarkPlugins}
      components={{
        ...components,
        a: ({ node, href, children }) => {
          const card = cardLinkOf(text.slice(node?.position?.start.offset, node?.position?.end.offset))
          if (card) return <>{cardLink?.(card, children) ?? children}</>
          return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>
        },
      }}
    >
      {text}
    </Markdown>
  </div>
)
