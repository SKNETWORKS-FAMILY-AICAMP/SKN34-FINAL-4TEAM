import type { DragEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { keepFiles } from './keepFiles'

const drag = (...types: string[]) => ({ dataTransfer: { types }, preventDefault: vi.fn() }) as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> }

describe('keepFiles(#706)', () => {
  it('파일을 끌 때만 기본 동작을 막아 브라우저가 파일을 열지 않게 한다', () => {
    for (const handle of [keepFiles.onDragOver, keepFiles.onDrop]) {
      const file = drag('Files')
      handle(file)
      expect(file.preventDefault).toHaveBeenCalledTimes(1)
    }
  })

  it('글자를 끌 때는 막지 않아 입력창에 놓을 수 있다', () => {
    for (const handle of [keepFiles.onDragOver, keepFiles.onDrop]) {
      const text = drag('text/plain', 'text/html')
      handle(text)
      expect(text.preventDefault).not.toHaveBeenCalled()
    }
  })
})
