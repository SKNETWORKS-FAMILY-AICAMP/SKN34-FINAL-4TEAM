// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { downloadText } from './downloadFile'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('Blob 주소를 만들어 download 이름을 단 링크를 누르고 잠시 뒤 주소를 해제한다', async () => {
  vi.useFakeTimers()
  const made: Blob[] = []
  Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { made.push(blob); return 'blob:x' }), revokeObjectURL: vi.fn() })
  const clicked: HTMLAnchorElement[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
  downloadText('세계관-20261121.json', '{"a":1}', 'application/json;charset=utf-8')
  expect(clicked).toHaveLength(1)
  expect([clicked[0].download, clicked[0].href]).toEqual(['세계관-20261121.json', 'blob:x'])
  expect(made[0].type).toBe('application/json;charset=utf-8')
  expect(await made[0].text()).toBe('{"a":1}')
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
})
