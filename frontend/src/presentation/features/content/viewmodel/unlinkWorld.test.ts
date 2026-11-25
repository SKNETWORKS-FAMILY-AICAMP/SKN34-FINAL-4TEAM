import { describe, expect, it, vi } from 'vitest'

import { privateThenUnlink } from './unlinkWorld'

const work = { id: 'w1', worldId: 'world-1' }
const stubs = () => {
  const calls: string[] = []
  const publication = { worldId: 'world-1', visibility: 'private' as const, genre: null, publishedAt: null, listed: false }
  const setPublication = vi.fn(async (..._args: unknown[]) => { calls.push('private'); return publication })
  const linkWorldStudio = vi.fn(async (..._args: unknown[]) => { calls.push('unlink'); return { workId: 'w1', worldId: null } })
  return { calls, publication, setPublication, linkWorldStudio }
}
const { signal } = new AbortController()

describe('privateThenUnlink: 공개 세계관의 연결 해제는 비공개로 바꾼 뒤 성공했을 때만 해제한다', () => {
  it('세계관을 먼저 비공개로(장르는 현재 값 그대로) 보내고 그다음 해제를 보내며 두 요청에 같은 취소 신호를 넘긴다', async () => {
    const { calls, setPublication, linkWorldStudio } = stubs()
    const linked = await privateThenUnlink({ linkWorldStudio }, { setPublication }, work, 'fantasy', signal)
    expect(calls).toEqual(['private', 'unlink'])
    expect(setPublication).toHaveBeenCalledWith('world-1', { visibility: 'private', genre: 'fantasy' }, signal)
    expect(linkWorldStudio).toHaveBeenCalledWith('w1', null, signal)
    expect(linked).toEqual({ workId: 'w1', worldId: null })
  })

  it('장르가 없는 세계관은 장르 없음 그대로 비공개로 보낸다', async () => {
    const { setPublication, linkWorldStudio } = stubs()
    await privateThenUnlink({ linkWorldStudio }, { setPublication }, work, null, signal)
    expect(setPublication).toHaveBeenCalledWith('world-1', { visibility: 'private', genre: null }, signal)
  })

  it('비공개로 바꾸지 못하면 해제하지 않고 서버 문구 그대로 던진다', async () => {
    const { calls, setPublication, linkWorldStudio } = stubs()
    setPublication.mockRejectedValueOnce(new Error('세계관 공개 설정을 저장하지 못했어요.'))
    await expect(privateThenUnlink({ linkWorldStudio }, { setPublication }, work, null, signal)).rejects.toThrow('세계관 공개 설정을 저장하지 못했어요.')
    expect(linkWorldStudio).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('해제가 실패하면 그 사유를 그대로 던진다(이미 비공개로 바꾼 것은 되돌리지 않는다)', async () => {
    const { calls, setPublication, linkWorldStudio } = stubs()
    linkWorldStudio.mockRejectedValueOnce(new Error('연결을 해제하지 못했어요.'))
    await expect(privateThenUnlink({ linkWorldStudio }, { setPublication }, work, null, signal)).rejects.toThrow('연결을 해제하지 못했어요.')
    expect(calls).toEqual(['private'])
  })

  it('비공개 응답이 오는 사이 화면을 떠나 취소됐으면(저장소가 취소 신호를 몰라도) 해제를 보내지 않고 취소로 던진다', async () => {
    const controller = new AbortController()
    const { calls, publication, setPublication, linkWorldStudio } = stubs()
    setPublication.mockImplementationOnce(async () => { calls.push('private'); controller.abort(); return publication })
    await expect(privateThenUnlink({ linkWorldStudio }, { setPublication }, work, 'fantasy', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(linkWorldStudio).not.toHaveBeenCalled()
    expect(calls).toEqual(['private'])
  })
})
