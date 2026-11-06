import { beforeEach, vi } from 'vitest'

// Import only in tests that mount route chrome or exercise its scroll controls.
export const scrollToSpy = vi.fn<typeof window.scrollTo>()
beforeEach(() => {
  scrollToSpy.mockClear()
  const spy = vi.spyOn(window, 'scrollTo').mockImplementation(scrollToSpy)
  return () => spy.mockRestore()
})
