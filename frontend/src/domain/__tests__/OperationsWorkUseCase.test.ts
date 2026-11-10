import { describe, expect, it } from 'vitest'

import type { OperationsWork } from '../entities/operationsWork'
import type { OperationsWorkRepository } from '../repositories/OperationsWorkRepository'
import { OperationsWorkUseCase } from '../usecases/OperationsWorkUseCase'

const row: OperationsWork = {
  workId: 'w1', ownerId: 'o1', title: '별빛 서약의 탑', authorName: '연화봉러', originKind: 'original', creationType: 'original',
  rightsConfirmed: true, visibility: 'public', restricted: false,
}

/** 호출 인자만 기록하는 Fake Repository */
function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: OperationsWorkRepository = {
    list: async () => { calls.push(['list']); return [row] },
    forkIntegrity: async () => { throw new Error("테스트에서 사용하지 않음") },
    setRestriction: async (id, restricted) => { calls.push(['setRestriction', id, restricted]) },
  }
  return { calls, uc: new OperationsWorkUseCase(repository) }
}

describe('OperationsWorkUseCase (74 운영 작품 조회)', () => {
  it('작품 목록은 Repository 결과를 그대로 돌려준다', async () => {
    const { uc, calls } = setup()
    expect(await uc.list()).toEqual([row])
    expect(calls).toEqual([['list']])
  })

  it('운영 제한과 해제는 같은 작품·값으로 Repository에 위임한다', async () => {
    const { uc, calls } = setup()
    await uc.setRestriction('w1', true)
    await uc.setRestriction('w1', false)
    expect(calls).toEqual([['setRestriction', 'w1', true], ['setRestriction', 'w1', false]])
  })
})
