import { describe, expect, it, vi } from 'vitest'

import { DATASET_MAX_BYTES, DATASET_MAX_LINES, DatasetInvalid } from '../entities/llmDatasets'
import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { LlmDatasetRepository } from '../repositories/LlmDatasetRepository'
import { LlmDatasetUseCase } from '../usecases/LlmDatasetUseCase'

const make = (repo: Partial<LlmDatasetRepository> = {}) => new LlmDatasetUseCase(repo as LlmDatasetRepository)
const rejects = (promise: Promise<unknown>, message: string) => expect(promise).rejects.toThrow(new OperationsError(message))
const jsonl = (count: number) => Array.from({ length: count }, (_, i) => JSON.stringify({ input: { q: `질문 ${i + 1}` }, expectedOutput: '정답', metadata: { criteria: '기준' } })).join('\n')   // 이름을 모르는 세트(범용)에 올릴 수 있는 줄

describe('평가 데이터셋 목록·문항 조회(#868)', () => {
  it('목록과 문항(쪽 번호 포함)을 읽기 전용 호출 그대로 건네고, 권한(403)이 없으면 실패가 아니라 null이다', async () => {
    const datasets = vi.fn(async () => [{ name: 'simulation.act', kind: 'gate' as const, prompt: 'character_simulation.act', itemCount: 24, description: '저장소 시드' }])
    const items = vi.fn(async () => ({ items: [{ id: 'a', input: 1 }], page: 2, size: 20, total: 45, unavailable: [] }))
    const uc = make({ datasets, items })
    expect(await uc.datasets()).toEqual([{ name: 'simulation.act', kind: 'gate' as const, prompt: 'character_simulation.act', itemCount: 24, description: '저장소 시드' }])
    expect((await uc.items('simulation.act', 2))?.total).toBe(45)
    expect(items).toHaveBeenCalledWith('simulation.act', 2)
    const forbidden = async () => { throw new OperationsForbidden('권한 없음') }
    expect([await make({ datasets: forbidden }).datasets(), await make({ items: forbidden }).items('x', 0)]).toEqual([null, null])
  })
})

describe('평가 데이터셋 업로드(#868): 있는 세트에 .jsonl을 올리고 전부 아니면 무', () => {
  it('세트 이름은 다듬고 .jsonl 본문·저작권 확인(true)을 그대로 보내며 서버가 만든 문항 수를 돌려준다', async () => {
    const upload = vi.fn(async (_name: string, _file: string, _text: string, _confirmed: boolean) => 2)
    const text = jsonl(2)
    expect(await make({ upload }).upload('  my-set  ', 'items.jsonl', text, true)).toBe(2)
    expect(upload).toHaveBeenCalledWith('my-set', 'items.jsonl', text, true)
  })

  it('올릴 세트가 비었거나 .jsonl 파일이 아니거나 저작권 확인이 없으면 보내지 않는다', async () => {
    const upload = vi.fn(async () => 1)
    const uc = make({ upload })
    await rejects(uc.upload('  ', 'a.jsonl', jsonl(1), true), '올릴 세트를 골라 주세요.')
    await rejects(uc.upload('s', 'a.json', jsonl(1), true), '.jsonl 파일만 올릴 수 있어요.')
    await rejects(uc.upload('s', 'a.jsonl', jsonl(1), false), '저작권 있는 원문(웹소설·해리 포터 등)이 아님을 확인해 주세요.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('올릴 세트의 종류별 필수 칸(채점 코드가 읽는 칸)과 expectedOutput 필수·파일 안 중복 input은 올리기 전에 줄 오류로 막는다(서버가 같은 규칙으로 다시 검사한다)', async () => {
    const upload = vi.fn(async () => 1)
    const uc = make({ upload })
    const errorsOf = async (set: string, text: string) => ((await uc.upload(set, 'a.jsonl', text, true).catch((error) => error)) as DatasetInvalid).errors
    expect(await errorsOf('simulation.act', jsonl(1))).toEqual([{ line: 1, message: 'input.data(객체)가 필요해요.' }])   // 범용 줄은 시뮬레이션 세트 모양이 아니다
    expect(await errorsOf('optimize.simulation.narrate', jsonl(1))).toEqual([{ line: 1, message: 'input.data(객체)가 필요해요.' }])
    expect(await errorsOf('s', JSON.stringify({ input: { q: 1 }, metadata: { criteria: '기준' } }))).toEqual([{ line: 1, message: 'expectedOutput이 필요해요.' }])
    expect(await errorsOf('s', JSON.stringify({ input: { q: 1 }, expectedOutput: '정답' }))).toEqual([{ line: 1, message: 'metadata.criteria(글)가 필요해요.' }])
    expect(await errorsOf('s', jsonl(1) + '\n' + jsonl(1))).toEqual([{ line: 2, message: '같은 input이 1번째 줄에 이미 있어요.' }])
    expect(upload).not.toHaveBeenCalled()
    const text = jsonl(2)
    expect(await uc.upload('s', 'a.jsonl', text, true)).toBe(1)   // 올릴 세트에 맞는 줄은 그대로 보낸다
    expect(upload).toHaveBeenCalledWith('s', 'a.jsonl', text, true)
  })

  it('형식이 틀린 줄이 하나라도 있으면 그 줄 목록(DatasetInvalid)으로 막고 보내지 않으며(일부만 올리지 않는다), 문항이 없거나 크기를 넘어도 보내지 않는다', async () => {
    const upload = vi.fn(async () => 1)
    const uc = make({ upload })
    const bad = await uc.upload('s', 'a.jsonl', jsonl(1) + '\n{bad\n' + JSON.stringify({ id: 'x', input: { q: 1 } }) + '\n' + JSON.stringify({ input: null }), true).catch((error) => error)
    expect(bad).toBeInstanceOf(DatasetInvalid)
    expect(bad.errors).toEqual([{ line: 2, message: 'JSON으로 읽을 수 없어요.' }, { line: 3, message: '알 수 없는 칸이 있어요: id' }, { line: 4, message: 'input이 필요해요.' }])
    await rejects(uc.upload('s', 'a.jsonl', '  \n', true), '올릴 문항이 없어요.')
    await rejects(uc.upload('s', 'a.jsonl', jsonl(DATASET_MAX_LINES + 1), true), `줄이 ${DATASET_MAX_LINES + 1}개라 너무 많아요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.`)
    expect(upload).not.toHaveBeenCalled()
  })

  it('크기 제한은 줄 검사보다 먼저 본다(서버도 413을 줄 오류(400)보다 먼저 준다): 틀린 줄이 섞인 큰 파일은 줄 목록이 아니라 크기 안내다', async () => {
    const upload = vi.fn(async () => 1)
    const uc = make({ upload })
    await rejects(uc.upload('s', 'a.jsonl', jsonl(DATASET_MAX_LINES) + '\n{bad', true), `줄이 ${DATASET_MAX_LINES + 1}개라 너무 많아요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.`)
    await rejects(uc.upload('s', 'a.jsonl', JSON.stringify({ input: 'x'.repeat(DATASET_MAX_BYTES) }) + '\n{bad', true), '파일이 2MB를 넘어요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('서버가 거절한 오류는 그대로 던진다', async () => {
    const rejected = new OperationsError('서버가 거절했어요.')
    await expect(make({ upload: async () => { throw rejected } }).upload('s', 'a.jsonl', jsonl(1), true)).rejects.toBe(rejected)
  })
})
