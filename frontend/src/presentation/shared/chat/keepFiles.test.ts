// @vitest-environment jsdom
import type { DragEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { keepFiles } from './keepFiles'

type Dragged = DragEvent & { preventDefault: ReturnType<typeof vi.fn> }
const drag = (target: Element, ...types: string[]) => ({ target, dataTransfer: { types }, preventDefault: vi.fn() }) as unknown as Dragged
const make = (html: string) => { const host = document.createElement('div'); host.innerHTML = html; return host.firstElementChild as Element }
const handlers = [keepFiles.onDragOver, keepFiles.onDrop]

describe('keepFiles(#706)', () => {
  it('파일을 끌 때는 놓는 곳이 어디든(입력칸 포함) 기본 동작을 막아 브라우저가 파일을 열지 않게 한다', () => {
    for (const handle of handlers) {
      for (const target of [make('<div></div>'), make('<textarea></textarea>')]) {
        const file = drag(target, 'Files')
        handle(file)
        expect(file.preventDefault).toHaveBeenCalledTimes(1)
      }
    }
  })

  it('dataTransfer가 없는 끌기 이벤트도 오류 없이 지나가며, 입력칸이 아니라서 막힌다', () => {
    const bare = { preventDefault: vi.fn() } as unknown as Dragged
    expect(() => keepFiles.onDrop(bare)).not.toThrow()
    expect(bare.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('글자·링크를 입력칸(input·textarea·contenteditable 안)에 놓을 때는 막지 않아 놓을 수 있다', () => {
    const inEditor = make('<div contenteditable="true"><p>글</p></div>').firstElementChild!
    for (const handle of handlers) {
      for (const target of [make('<textarea></textarea>'), make('<input>'), inEditor]) {
        for (const types of [['text/plain', 'text/html'], ['text/uri-list', 'text/plain']]) {
          const text = drag(target, ...types)
          handle(text)
          expect(text.preventDefault).not.toHaveBeenCalled()
        }
      }
    }
  })

  it('입력칸 밖에서는 글자·링크 끌기도 막아 브라우저가 그 링크로 이동하지 않게 한다', () => {
    for (const handle of handlers) {
      for (const target of [make('<div></div>'), make('<div contenteditable="false"></div>')]) {
        for (const types of [['text/plain', 'text/html'], ['text/uri-list', 'text/plain']]) {
          const text = drag(target, ...types)
          handle(text)
          expect(text.preventDefault).toHaveBeenCalledTimes(1)
        }
      }
    }
  })
})
