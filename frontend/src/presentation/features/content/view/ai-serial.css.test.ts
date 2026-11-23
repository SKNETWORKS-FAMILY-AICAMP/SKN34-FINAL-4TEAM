import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// jsdom은 CSS를 적용하지 않아 규칙을 글자로 확인한다(episode.css.test.ts와 같은 방식).
const css = readFileSync(new URL('./ai-serial.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector)?.[2] ?? ''

it('[critique] 꺼져서 잠긴 연재 설정 폼(fieldset disabled)은 흐리게 보이고, 켜졌을 때의 간격은 그대로다', () => {
  expect(rule('.ep-serial .ep-serial-fields:disabled')).toMatch(/opacity:\.6/)
  // fieldset은 새 블록 서식 맥락이라 폼의 위 간격(16px)은 폼이 아니라 fieldset이 가져야 앞 형제의 아래 간격과 겹쳐지는 방식이 예전과 같다.
  expect(rule('.ep-serial .ep-serial-fields')).toMatch(/display:block;margin-top:16px/)
  expect(rule('.ep-serial form')).not.toMatch(/margin-top/)
})
