import { describe, expect, it, vi } from 'vitest'

import { DATASET_MAX_BYTES, DATASET_MAX_LINES, DatasetInvalid } from '../entities/llmDatasets'
import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { LlmDatasetRepository } from '../repositories/LlmDatasetRepository'
import { LlmDatasetUseCase } from '../usecases/LlmDatasetUseCase'

const make = (repo: Partial<LlmDatasetRepository> = {}) => new LlmDatasetUseCase(repo as LlmDatasetRepository)
const rejects = (promise: Promise<unknown>, message: string) => expect(promise).rejects.toThrow(new OperationsError(message))
const jsonl = (count: number) => Array.from({ length: count }, (_, i) => JSON.stringify({ input: `질문 ${i + 1}`, expectedOutput: '정답' })).join('\n')

describe('평가 데이터셋 목록·문항 조회(#868)', () => {
  it('목록과 문항(쪽 번호 포함)을 읽기 전용 호출 그대로 건네고, 권한(403)이 없으면 실패가 아니라 null이다', async () => {
    const datasets = vi.fn(async () => [{ name: 'simulation.act', prompt: 'character_simulation.act', itemCount: 24, description: '저장소 시드' }])
    const items = vi.fn(async () => ({ items: [{ id: 'a', input: 1 }], page: 2, size: 20, total: 45, unavailable: [] }))
    const uc = make({ datasets, items })
    expect(await uc.datasets()).toEqual([{ name: 'simulation.act', prompt: 'character_simulation.act', itemCount: 24, description: '저장소 시드' }])
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

  it('expectedOutput이 없는 줄도 올린다(서버 규칙: input만 필수)', async () => {
    const upload = vi.fn(async () => 2)
    const text = [JSON.stringify({ input: '질문 1' }), JSON.stringify({ input: { q: 2 }, metadata: { source: '시험' } })].join('\n')
    expect(await make({ upload }).upload('s', 'a.jsonl', text, true)).toBe(2)
    expect(upload).toHaveBeenCalledWith('s', 'a.jsonl', text, true)
  })

  it('형식이 틀린 줄이 하나라도 있으면 그 줄 목록(DatasetInvalid)으로 막고 보내지 않으며(일부만 올리지 않는다), 문항이 없거나 크기를 넘어도 보내지 않는다', async () => {
    const upload = vi.fn(async () => 1)
    const uc = make({ upload })
    const bad = await uc.upload('s', 'a.jsonl', jsonl(1) + '\n{bad\n' + JSON.stringify({ id: 'x', input: 1 }) + '\n' + JSON.stringify({ input: null }), true).catch((error) => error)
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
