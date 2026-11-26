import { describe, expect, it } from 'vitest'

import type { ChatReply, ChatStep } from '../../../domain/entities/writingChat'
import { proposalLine, proposalStageView } from './proposalView'

const waiting = (step: ChatStep, extra: Partial<ChatReply> = {}): ChatReply =>
  ({ status: 'waiting', steps: [step], missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 3, ...extra })
const draftStep: ChatStep = { feature: 'writing_editing', task: 'draft', status: 'completed', result: { text: '새로 쓴 장면' } }
const patchStep: ChatStep = { feature: 'writing_editing', task: 'patch', status: 'completed', result: { before: '웃었다.', after: '차갑게 웃었다.' } }
const planStep: ChatStep = { feature: 'writing_editing', task: 'revise_plan', status: 'completed',
  planRevision: { kind: 'scene', before: { title: '재회', content: '문을 연다' }, after: { title: '재회(긴장)', content: '문을 닫는다' } } }
const open = { number: 3, body: '그는 웃었다. 그리고 떠났다.' }

describe('proposalStageView', () => {
  it('원고 반영 승인이 아니면 원고 영역으로 옮기지 않는다(World·Content 작업·시뮬레이션·대기 없음)', () => {
    expect(proposalStageView(null, open)).toBeNull()
    expect(proposalStageView(waiting(draftStep, { awaitingApproval: 'world' }), open)).toBeNull()
    expect(proposalStageView(waiting(draftStep, { awaitingApproval: 'content_action' }), open)).toBeNull()
    expect(proposalStageView(waiting(draftStep, { awaitingApproval: 'character_simulation' }), open)).toBeNull()
    expect(proposalStageView(waiting(draftStep, { awaitingApproval: null }), open)).toBeNull()
  })

  it('보일 제안이 없으면(완료된 쓰기 단계 없음) 채팅 카드로 남긴다', () => {
    expect(proposalStageView(waiting({ ...draftStep, status: 'failed', result: null }), open)).toBeNull()
  })

  it('반영 회차가 열린 회차면 지금 초안과 제안을 나란히 둔다', () => {
    const view = proposalStageView(waiting(draftStep), open)
    expect(view).toMatchObject({ kind: 'draft', episode: 3, openEpisode: null, notice: '' })
    expect(view?.current).toEqual({ label: '지금 초안 · 3화', pre: open.body, mark: '', post: '' })
    expect(view?.proposal).toEqual({ label: '제안', pre: '새로 쓴 장면', mark: '', post: '' })
  })

  it('반영 회차가 열린 회차와 다르면 열린 회차로 대신하지 않고 그 회차를 열도록 안내한다(#635)', () => {
    const view = proposalStageView(waiting(draftStep, { approvalEpisode: 5 }), open)
    expect(view?.current).toBeNull()
    expect(view?.openEpisode).toBe(5)
    expect(view?.notice).toBe('5화 초안에 반영하는 제안이에요. 5화를 열어 비교해 주세요.')
    expect(view?.proposal.pre).toBe('새로 쓴 장면')
  })

  it('반영 회차를 모르면 비교하지 않고 열 회차도 정하지 않는다', () => {
    const view = proposalStageView(waiting(draftStep, { approvalEpisode: null }), open)
    expect(view?.current).toBeNull()
    expect(view?.openEpisode).toBeNull()
    expect(view?.notice).toBe('반영할 회차를 알 수 없어 지금 원고와 비교할 수 없어요.')
  })

  it('열린 회차가 없으면 반영 회차를 열도록 안내한다', () => {
    expect(proposalStageView(waiting(draftStep), null)?.openEpisode).toBe(3)
  })

  it('부분 수정은 초안 안에서 바뀌는 구간만 강조한다', () => {
    const view = proposalStageView(waiting(patchStep), open)
    expect(view?.kind).toBe('patch')
    expect(view?.current).toEqual({ label: '지금 초안 · 3화', pre: '그는 ', mark: '웃었다.', post: ' 그리고 떠났다.' })
    expect(view?.proposal).toEqual({ label: '제안', pre: '그는 ', mark: '차갑게 웃었다.', post: ' 그리고 떠났다.' })
    expect(view?.notice).toBe('')
  })

  it('수정 전 글을 초안에서 찾지 못하면 수정 전·후만 나란히 두고 알린다', () => {
    const view = proposalStageView(waiting(patchStep), { number: 3, body: '다른 글' })
    expect(view?.current).toEqual({ label: '수정 전', pre: '', mark: '웃었다.', post: '' })
    expect(view?.proposal).toEqual({ label: '수정 후', pre: '', mark: '차갑게 웃었다.', post: '' })
    expect(view?.notice).toBe('수정 전 글을 지금 초안에서 찾지 못해 바뀌는 구간만 보여요.')
  })

  it('다른 회차의 부분 수정은 수정 전·후를 보이되 회차를 열도록 안내한다', () => {
    const view = proposalStageView(waiting(patchStep, { approvalEpisode: 4 }), open)
    expect(view?.openEpisode).toBe(4)
    expect(view?.current?.label).toBe('수정 전')
    expect(view?.notice).toBe('4화 초안에 반영하는 제안이에요. 4화를 열어 비교해 주세요.')
  })

  it('계획 수정안은 회차와 상관없이 계획의 전후를 나란히 둔다', () => {
    const view = proposalStageView(waiting(planStep, { approvalEpisode: 9 }), open)
    expect(view).toMatchObject({ kind: 'plan', openEpisode: null, notice: '' })
    expect(view?.current).toEqual({ label: '지금 계획', pre: '재회\n\n문을 연다', mark: '', post: '' })
    expect(view?.proposal).toEqual({ label: '수정안', pre: '재회(긴장)\n\n문을 닫는다', mark: '', post: '' })
  })
})

describe('proposalLine', () => {
  it('채팅에 남는 한 줄은 종류와 회차만 알린다', () => {
    expect(proposalLine(proposalStageView(waiting(draftStep), null)!)).toBe('3화 초안 반영 제안 · 반영 여부를 기다려요')
    expect(proposalLine(proposalStageView(waiting(planStep), null)!)).toBe('계획 수정안 · 저장 여부를 기다려요')
    expect(proposalLine(proposalStageView(waiting(draftStep, { approvalEpisode: null }), null)!)).toBe('초안 반영 제안 · 반영 여부를 기다려요')
  })
})
