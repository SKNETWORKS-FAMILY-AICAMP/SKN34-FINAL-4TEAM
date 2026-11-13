import { describe, expect, it } from 'vitest'

import type { WorkNoticeInput } from '../../domain/entities/workNotice'
import { InMemoryWorkNoticeRepository } from './InMemoryWorkNoticeRepository'

const input = (title: string, extra: Partial<WorkNoticeInput> = {}): WorkNoticeInput => ({ category: 'info', title, body: `${title} 본문`, pinned: false, ...extra })
const titles = async (repo: InMemoryWorkNoticeRepository, workId = 'w1') => (await repo.list(workId)).map((n) => n.title)

describe('메모리 작품 소식 데모 저장소', () => {
  it('처음 열면 데모 소식 3건이 서버와 같은 순서(고정 먼저, 그 안에서 최신 먼저)로 보인다', async () => {
    const found = await new InMemoryWorkNoticeRepository().list('w1')
    expect(found.map((n) => [n.title, n.category, n.pinned])).toEqual([['연재 일정 안내', 'info', true], ['이번 주 휴재 안내', 'hiatus', false], ['연재를 시작합니다', 'info', false]])
    expect(found.every((n) => n.workId === 'w1')).toBe(true)
    expect(found.map((n) => Date.parse(n.createdAt)).every(Number.isFinite)).toBe(true)
  })

  it('새 소식은 고정이 아니면 고정 소식 아래 맨 위, 고정이면 고정 소식 중 맨 위에 온다', async () => {
    const repo = new InMemoryWorkNoticeRepository()
    const a = await repo.create('w1', input('첫 소식'))
    await repo.create('w1', input('둘째 소식'))
    await repo.create('w1', input('고정 소식', { pinned: true }))
    expect(await titles(repo)).toEqual(['고정 소식', '연재 일정 안내', '둘째 소식', '첫 소식', '이번 주 휴재 안내', '연재를 시작합니다'])
    expect(a).toMatchObject({ workId: 'w1', title: '첫 소식', body: '첫 소식 본문', category: 'info', pinned: false })
    expect(a.updatedAt).toBe(a.createdAt)
  })

  it('수정은 내용을 바꾸되 등록 시각과 순서를 지키고, 고정 해제·설정은 순서만 바꾼다', async () => {
    const repo = new InMemoryWorkNoticeRepository()
    const [pinned, , oldest] = await repo.list('w1')
    const edited = await repo.update('w1', oldest.id, input('고친 제목', { category: 'event', body: '고친 본문' }))
    expect(edited).toMatchObject({ id: oldest.id, title: '고친 제목', body: '고친 본문', category: 'event', pinned: false, createdAt: oldest.createdAt })
    expect(await titles(repo)).toEqual(['연재 일정 안내', '이번 주 휴재 안내', '고친 제목'])
    await repo.update('w1', oldest.id, input('고친 제목', { pinned: true }))
    expect(await titles(repo)).toEqual(['연재 일정 안내', '고친 제목', '이번 주 휴재 안내'])
    await repo.update('w1', pinned.id, input(pinned.title, { pinned: false }))
    expect(await titles(repo)).toEqual(['고친 제목', '연재 일정 안내', '이번 주 휴재 안내'])
  })

  it('삭제하면 목록에서 사라지고 없는 소식의 수정·삭제는 오류다', async () => {
    const repo = new InMemoryWorkNoticeRepository()
    const [first] = await repo.list('w1')
    await repo.remove('w1', first.id)
    expect(await titles(repo)).toEqual(['이번 주 휴재 안내', '연재를 시작합니다'])
    await expect(repo.update('w1', first.id, input('x'))).rejects.toThrow('소식을 찾을 수 없어요')
    await expect(repo.remove('w1', first.id)).rejects.toThrow('소식을 찾을 수 없어요')
    await expect(repo.remove('w2', (await repo.list('w1'))[0].id)).rejects.toThrow('소식을 찾을 수 없어요')
  })

  it('작품마다 따로 보관하고 비워도 시드로 되돌아가지 않으며 돌려준 목록을 바꿔도 저장된 값은 그대로다', async () => {
    const repo = new InMemoryWorkNoticeRepository()
    await repo.create('w1', input('w1 소식'))
    expect(await titles(repo, 'w2')).not.toContain('w1 소식')
    for (const n of await repo.list('w1')) await repo.remove('w1', n.id)
    expect(await repo.list('w1')).toEqual([])
    const [seed] = await repo.list('w2')
    seed.title = '밖에서 바꿈'
    expect((await repo.list('w2'))[0].title).toBe('연재 일정 안내')
  })
})
