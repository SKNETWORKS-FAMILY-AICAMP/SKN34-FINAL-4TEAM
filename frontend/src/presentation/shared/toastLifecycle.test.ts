// @vitest-environment jsdom
import Editor from '@toast-ui/editor'
import { afterEach, expect, it, vi } from 'vitest'
import { stubRangeGeometry } from '../../test/rangeGeometry'

const observers = vi.hoisted(() => {
  const callbacks: (() => void)[] = []
  globalThis.ResizeObserver = class {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) { this.callback = callback }
    observe(target: Element) {
      if (target.classList.contains('toastui-editor-defaultUI-toolbar')) callbacks.push(() => this.callback([], this))
    }
    unobserve() {}
    disconnect() {}
  }
  return callbacks
})

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

it('크기 변경 직후 편집기를 제거해도 예약된 툴바 콜백이 DOM을 다시 그리지 않는다', () => {
  stubRangeGeometry()
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor({ el: host, initialEditType: 'markdown', height: '300px' })
  expect(observers).toHaveLength(1)
  observers[0]()
  observers[0]() // throttle의 다음 실행이 대기 중인 상태에서 회차 전환
  editor.destroy()
  expect(() => vi.advanceTimersByTime(250)).not.toThrow()
})
