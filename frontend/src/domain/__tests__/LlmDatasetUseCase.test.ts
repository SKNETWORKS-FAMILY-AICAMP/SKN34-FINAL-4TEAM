import { describe, expect, it, vi } from 'vitest'

import type { DatasetItem } from '../entities/llmDatasets'
import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { LlmDatasetRepository } from '../repositories/LlmDatasetRepository'
import { LlmDatasetUseCase } from '../usecases/LlmDatasetUseCase'

const make = (repo: Partial<LlmDatasetRepository> = {}) => new LlmDatasetUseCase(repo as LlmDatasetRepository)
const rejects = (promise: Promise<unknown>, message: string) => expect(promise).rejects.toThrow(new OperationsError(message))
const jsonl = (...ids: string[]) => ids.map((id) => JSON.stringify({ id, input: '질문', metadata: {} })).join('\n')

describe('평가 데이터셋 목록·문항 조회(#857)', () => {
  it('목록과 문항을 읽기 전용 호출 그대로 건네고, 권한(403)이 없으면 실패가 아니라 null이다', async () => {
    const datasets = vi.fn(async () => [{ name: 'simulation.act', prompt: 'character_simulation.act', items: 24, source: '저장소 시드' }])
    const items = vi.fn(async () => [{ id: 'a', input: 1, metadata: {} }])
    const uc = make({ datasets, items })
    expect(await uc.datasets()).toEqual([{ name: 'simulation.act', prompt: 'character_simulation.act', items: 24, source: '저장소 시드' }])
    expect(await uc.items('simulation.act')).toEqual([{ id: 'a', input: 1, metadata: {} }])
    expect(items).toHaveBeenCalledWith('simulation.act')
    const forbidden = async () => { throw new OperationsForbidden('권한 없음') }
    expect([await make({ datasets: forbidden }).datasets(), await make({ items: forbidden }).items('x')]).toEqual([null, null])
  })
})

describe('평가 데이터셋 업로드(#857)', () => {
  it('세트 이름은 다듬고 검사를 통과한 문항만 파일 이름과 함께 보낸다', async () => {
    const upload = vi.fn(async (_name: string, _file: string, _items: DatasetItem[]) => {})
    await make({ upload }).upload('  my-set  ', 'items.jsonl', jsonl('a', 'b'), true)
    expect(upload).toHaveBeenCalledWith('my-set', 'items.jsonl', [{ id: 'a', input: '질문', metadata: {} }, { id: 'b', input: '질문', metadata: {} }])
  })

  it('세트 이름이 비었거나 .jsonl 파일이 아니거나 저작권 확인이 없으면 보내지 않는다', async () => {
    const upload = vi.fn(async () => {})
    const uc = make({ upload })
    await rejects(uc.upload('  ', 'a.jsonl', jsonl('a'), true), '세트 이름을 입력해 주세요.')
    await rejects(uc.upload('s', 'a.json', jsonl('a'), true), '.jsonl 파일만 올릴 수 있어요.')
    await rejects(uc.upload('s', 'a.jsonl', jsonl('a'), false), '저작권 있는 원문(웹소설·해리 포터 등)이 아님을 확인해 주세요.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('형식이 틀린 줄이 하나라도 있거나 문항이 없으면 보내지 않는다(일부만 올리지 않는다)', async () => {
    const upload = vi.fn(async () => {})
    const uc = make({ upload })
    await rejects(uc.upload('s', 'a.jsonl', jsonl('a') + '\n{bad', true), '형식이 맞지 않는 줄이 1개 있어요. 고친 뒤 다시 올려 주세요.')
    await rejects(uc.upload('s', 'a.jsonl', '  \n', true), '올릴 문항이 없어요.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('서버가 거절한 오류는 그대로 던진다', async () => {
    const rejected = new OperationsError('서버가 거절했어요.')
    await expect(make({ upload: async () => { throw rejected } }).upload('s', 'a.jsonl', jsonl('a'), true)).rejects.toBe(rejected)
  })
})
