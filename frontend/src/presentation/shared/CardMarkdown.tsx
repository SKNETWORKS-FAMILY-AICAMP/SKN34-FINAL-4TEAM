import type { ReactNode } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import './CardMarkdown.css'

/** 본문의 `#`·`##`은 페이지 제목(h1)·문단 제목(h2)과 겹치지 않게 h3로 두고 더 깊은 제목도 h6까지만 한 단계씩 내린다. */
const heading = (Tag: 'h3' | 'h4' | 'h5' | 'h6') => ({ children }: { children?: ReactNode }) => <Tag>{children}</Tag>

const components: Components = {
  h1: heading('h3'), h2: heading('h3'), h3: heading('h4'), h4: heading('h5'), h5: heading('h6'), h6: heading('h6'),
  // 링크는 새 탭에서 연다. 안전하지 않은 주소(javascript: 등)는 react-markdown이 주소를 비우므로 링크 없이 글자만 둔다.
  a: ({ href, children }) => (href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>),
  // 외부 이미지는 불러오지 않고 대체 글자만 보인다.
  img: ({ alt }) => <>{alt}</>,
}
// 물결표 하나(`1~3화`)는 취소선이 아니다: 취소선은 `~~글자~~`만.
const remarkPlugins: Options['remarkPlugins'] = [[remarkGfm, { singleTilde: false }]]

/**
 * 설정 카드 본문(마크다운 문자열)을 그린다: GFM(표·목록·취소선·자동 링크). 원시 HTML은 요소로 그리지 않고 글자 그대로 보인다(`rehype-raw`를 쓰지 않는다).
 * 공개 카드 페이지의 문단 본문과 편집 화면의 미리보기가 함께 쓴다.
 */
export const CardMarkdown = ({ text }: { text: string }) => <div className="card-md"><Markdown remarkPlugins={remarkPlugins} components={components}>{text}</Markdown></div>
