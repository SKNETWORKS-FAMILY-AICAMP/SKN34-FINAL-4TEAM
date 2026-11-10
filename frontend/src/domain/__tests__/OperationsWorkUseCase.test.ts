import { describe, expect, it } from 'vitest'

import { OperationsError, OperationsRejected } from '../entities/operations'
import type { ForkIntegrity, OperationsWork } from '../entities/operationsWork'
import type { OperationsWorkRepository } from '../repositories/OperationsWorkRepository'
import { OperationsWorkUseCase } from '../usecases/OperationsWorkUseCase'

const row: OperationsWork = {
  workId: 'w1', ownerId: 'o1', title: '별빛 서약의 탑', authorName: '연화봉러', originKind: 'original', creationType: 'original',
  rightsConfirmed: true, visibility: 'public', restricted: false,
}

const report: ForkIntegrity = { basisEpisode: 2, forkHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), matches: false, characterStateStatus: 'unavailable' }

/** 호출 인자만 기록하는 Fake Repository */
function setup(forkIntegrity: OperationsWorkRepository['forkIntegrity'] = async () => report) {
  const calls: [string, ...unknown[]][] = []
  const repository: OperationsWorkRepository = {
    list: async () => { calls.push(['list']); return [row] },
    forkIntegrity: async (id) => { calls.push(['forkIntegrity', id]); return forkIntegrity(id) },
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

  it('포크 정합성 점검 결과는 점검 가능 상태로 돌려준다', async () => {
    const { uc, calls } = setup()
    expect(await uc.forkIntegrity('w1')).toEqual({ available: true, report })
    expect(calls).toEqual([['forkIntegrity', 'w1']])
  })

  it('서버가 점검할 수 없다고 안내한 포크는 실패가 아니라 그 문구를 영구 상태로 돌려준다', async () => {
    const { uc } = setup(async () => { throw new OperationsRejected('원작의 고정 기준 기록을 확인할 수 없어요.') })
    expect(await uc.forkIntegrity('w1')).toEqual({ available: false, message: '원작의 고정 기준 기록을 확인할 수 없어요.' })
  })

  it('그 밖의 실패는 영구 상태로 바꾸지 않고 그대로 던져 다시 시도하게 한다', async () => {
    const generic = new OperationsError('연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.')
    await expect(setup(async () => { throw generic }).uc.forkIntegrity('w1')).rejects.toBe(generic)
    const unexpected = new Error('네트워크 오류')
    await expect(setup(async () => { throw unexpected }).uc.forkIntegrity('w1')).rejects.toBe(unexpected)
  })
})
