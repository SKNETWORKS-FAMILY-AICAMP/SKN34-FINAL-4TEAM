import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { PROMPT_NAMES, promptLabel } from '../entities/promptNames'

const registered = () => [...readFileSync(new URL('../../../../backend/ai-service/app/prompts.py', import.meta.url), 'utf8').split('SEEDS: dict[str, str] = {')[1].split('\n}')[0].matchAll(/^\s+'([a-z_.0-9]+)':/gm)].map((m) => m[1])

describe('프롬프트 한국어 표시 이름(#857)', () => {
  it('코드는 한국어 이름이 되고, 모르는 코드(데모 이름·새 프롬프트)는 코드 그대로이며 객체 기본 속성 이름이 새지 않는다', () => {
    expect(promptLabel('character_simulation.act')).toBe('인물 시뮬레이션 · 인물 대사(act)')
    expect(promptLabel('character_simulation.narrate')).toBe('인물 시뮬레이션 · 나레이션·독백(narrate)')
    expect(promptLabel('story_context.answer')).toBe('Q&A · 작품 질문 답변(answer)')
    expect(['qa-answer', 'future.prompt', 'constructor', 'toString', ''].map(promptLabel)).toEqual(['qa-answer', 'future.prompt', 'constructor', 'toString', ''])
  })

  it('AI 서비스가 기동 때 등록하는 프롬프트(prompts.py SEEDS) 전부에 이름이 있고 옛 코드가 남지 않으며, 이름은 겹치지 않고 코드의 마지막 마디가 괄호로 끝에 붙는다', () => {
    const codes = registered()
    expect(codes.length).toBeGreaterThan(30)
    for (const code of codes) expect(PROMPT_NAMES.has(code), code).toBe(true)
    expect([...PROMPT_NAMES.keys()].filter((code) => !codes.includes(code))).toEqual([])
    const names = [...PROMPT_NAMES.values()]
    expect(new Set(names).size).toBe(names.length)
    for (const [code, name] of PROMPT_NAMES) expect(name.endsWith(`(${code.split('.').pop()})`), code).toBe(true)
  })
})
