import { describe, expect, it } from 'vitest'

import { createFixtureDb } from '../../data/mock/fixtureDb'
import { InMemoryAdminRepository, InMemoryFeedbackRepository, InMemoryWorkRepository } from '../../data/mock/InMemoryRepositories'
import { mockupNotificationRepository } from '../../data/mock/mockupRepositories'
import { FeedbackUseCase } from '../usecases/FeedbackUseCase'
import { InboxUseCase, inboxCls } from '../usecases/InboxUseCase'
import { ShellUseCase } from '../usecases/ShellUseCase'

/** 목업(메모리 저장소)의 내 포크: 원작 스냅샷 1화 + 직접 쓴 2화. 포크의 회차 번호는 스냅샷을 포함한 번호다(epsOf). */
async function myFork(typoAuto: boolean) {
  const db = createFixtureDb()
  const works = new InMemoryWorkRepository(db), feedback = new InMemoryFeedbackRepository(db)
  const { id } = await works.createFork('guunmong', 1, '내 포크', '다른 길')
  const fork = (await works.listWorks()).find((w) => w.id === id)!
  fork.snap!.eps = [{ t: '원작 1화', p: ['스승이 않 된다고 했다.'] }]
  fork.eps = [{ t: '내 2화', p: ['제자가 않 된다고 답했다.'] }]
  fork.settings = { autoWorld: false, typoAuto }
  await works.saveWork(fork)
  const texts = async () => { const w = (await works.listWorks()).find((x) => x.id === id)!; return { snap: w.snap!.eps[0].p[0], own: w.eps[0].p[0] } }
  return { id, feedback, texts, feedbackUseCase: new FeedbackUseCase(works, feedback, new InMemoryAdminRepository(db)), inboxUseCase: new InboxUseCase(works, feedback) }
}
const typo = (workId: string, n: number, t: string) => ({ workId, n, type: '단순 오류' as const, text: '오타', sentence: { t, pi: 0 }, verified: false, nick: '독자' })

describe('포크 소설 피드백함 회차 인덱스 (#22)', () => {
  it('직접 쓴 회차의 오타 제보는 같은 회차 문단을 baseText로 접수하고 승인·발행하면 그 문단만 고친다', async () => {
    const { id, feedback, texts, feedbackUseCase, inboxUseCase } = await myFork(false)
    await feedbackUseCase.sendFeedback(typo(id, 2, '제자가 않 된다고 답했다.'))
    const [item] = await feedback.listInbox()
    expect(item).toMatchObject({ n: 2, baseText: '제자가 않 된다고 답했다.', from: '않 된다', to: '안 된다', status: '작가 검토 대기' })
    expect((await inboxUseCase.list(item.id)).current).toBe('제자가 않 된다고 답했다.')
    expect(await inboxUseCase.act(item.id, 'approve')).toBe('수정안을 승인했어요. 발행은 별도로 확인해 주세요')
    expect(await inboxUseCase.act(item.id, 'publishRevision')).toBe('수정안을 발행했어요 (데모)')
    expect(await texts()).toEqual({ snap: '스승이 않 된다고 했다.', own: '제자가 안 된다고 답했다.' })
  })

  it('원작 스냅샷 회차는 자동 승인으로 고치지 않고, 승인해도 발행하지 않는다', async () => {
    const { id, feedback, texts, feedbackUseCase, inboxUseCase } = await myFork(true)
    expect((await feedbackUseCase.sendFeedback(typo(id, 1, '스승이 않 된다고 했다.'))).status).toBe('작가 검토 대기')
    const [item] = await feedback.listInbox()
    expect(item).toMatchObject({ n: 1, baseText: '스승이 않 된다고 했다.' })
    await inboxUseCase.act(item.id, 'approve')
    expect(await inboxUseCase.act(item.id, 'publishRevision')).toBe('원고나 공개 상태가 바뀌어 발행하지 않았어요')
    expect(await texts()).toEqual({ snap: '스승이 않 된다고 했다.', own: '제자가 않 된다고 답했다.' })
  })
})

describe('피드백함 상태 표시 (#32)', () => {
  it('반영 실패는 완료(ok)가 아니라 진행·대기(wait) 표시다', () => {
    expect(inboxCls('반영 실패')).toBe('wait')
  })

  it('이미 발행 완료인 수정안을 다시 발행해도 완료 상태를 반영 실패로 덮어쓰지 않는다', async () => {
    const { id, feedback, texts, feedbackUseCase, inboxUseCase } = await myFork(false)
    await feedbackUseCase.sendFeedback(typo(id, 2, '제자가 않 된다고 답했다.'))
    const [item] = await feedback.listInbox()
    await inboxUseCase.act(item.id, 'approve')
    await inboxUseCase.act(item.id, 'publishRevision')
    expect(await inboxUseCase.act(item.id, 'publishRevision')).toBeNull()
    expect((await feedback.listInbox())[0].status).toBe('발행 완료')
    expect((await texts()).own).toBe('제자가 안 된다고 답했다.')
  })

  it('반영 실패 항목은 메뉴 배지의 처리할 독자 제보에 센다', async () => {
    const { id, feedback, feedbackUseCase, inboxUseCase } = await myFork(false)
    await feedbackUseCase.sendFeedback(typo(id, 1, '스승이 않 된다고 했다.'))
    const [item] = await feedback.listInbox()
    await inboxUseCase.act(item.id, 'approve')
    await inboxUseCase.act(item.id, 'publishRevision') // 원작 스냅샷 회차라 발행하지 못해 반영 실패가 된다
    expect((await feedback.listInbox())[0].status).toBe('반영 실패')
    expect(await new ShellUseCase(mockupNotificationRepository, feedback).getBadges()).toEqual({ unread: 0, pending: 1 })
  })
})
