import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { INSUFFICIENT_CREDIT_MESSAGE } from '../../domain/entities/aiSerial'
import { login, refresh } from '../api/auth'
import { HttpSerialRepository } from './HttpSerialRepository'

const settingsRow = (extra: Record<string, unknown> = {}) => ({ enabled: true, days: ['MON', 'THU'], time: '21:00', direction: '밝은 분위기로', ...extra })
const boardRow = (extra: Record<string, unknown> = {}) => ({ id: 'b1', episodeNumber: 4, status: 'published', publishedEpisodeNumber: 4, failureReason: null, closedAt: '2026-11-22T12:00:00Z', ...extra })
const choiceRow = (extra: Record<string, unknown> = {}) => ({ id: 'c1', position: 1, text: '주인공이 편지를 열어 본다', votes: 3, ...extra })
const proposalRow = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', authorName: '독자', kind: 'general', title: '반전이 좋겠어요', body: '편지의 주인이 사실 동생이면 어떨까요?', simulation: null,
  likes: 3, likedByMe: false, mine: false, createdAt: '2026-11-22T01:00:00Z', ...extra,
})
const boardBody = (extra: Record<string, unknown> = {}) => ({
  enabled: true, board: { id: 'b9', episodeNumber: 5 }, choices: [choiceRow()], myChoiceId: null, proposals: [proposalRow()], summary: null, ...extra,
})
const headers = (fetcher: ReturnType<typeof vi.fn>, call = 0) => new Headers(fetcher.mock.calls[call][1].headers)
const sent = (fetcher: ReturnType<typeof vi.fn>) => ({ url: fetcher.mock.calls[0][0], init: fetcher.mock.calls[0][1], body: fetcher.mock.calls[0][1].body && JSON.parse(fetcher.mock.calls[0][1].body) })

const signIn = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'serial-csrf' })
    : Response.json({ accessToken: 'serial-bearer', user: { id: 'owner', email: 'owner@example.invalid', nickname: '작가', operator: false } })))
  await login('owner@example.invalid', 'test-password')
}
const signOut = async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'c' }) : new Response(null, { status: 401 })))
  await refresh().catch(() => {})
}

afterEach(() => vi.unstubAllGlobals())

describe('AI 집필 설정·기록 (소유자, Bearer·CSRF)', () => {
  beforeEach(signIn)

  it('설정은 GET으로 읽고 요일·시각·방향을 그대로 돌려준다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(settingsRow()))
    expect(await new HttpSerialRepository(fetcher).settings('w 1')).toEqual(settingsRow())
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w%201/ai-serial', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
  })

  it.each([
    ['알 수 없는 요일', settingsRow({ days: ['MON', 'FUNDAY'] })],
    ['시각이 아닌 값', settingsRow({ time: '밤 9시' })],
    ['초가 붙은 시각', settingsRow({ time: '21:00:00' })],
    ['켜짐이 문자열', settingsRow({ enabled: 'true' })],
    ['방향 누락', settingsRow({ direction: undefined })],
  ])('설정 응답이 계약 모양이 아니면(%s) 성공으로 받지 않는다', async (_name, bad) => {
    await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(bad))).settings('w1')).rejects.toThrow('서버 응답 형식')
  })

  it('저장은 PUT으로 {days,time,direction}만 보내고(켜짐은 집필 방식이 정한다) 응답 본문(설정 JSON·204·202)은 쓰지 않는다', async () => {
    const input = { days: ['MON' as const, 'SUN' as const], time: '20:30', direction: '긴장감 있게' }
    for (const response of [() => Response.json(settingsRow()), () => new Response(null, { status: 204 }), () => new Response(null, { status: 202 })]) {
      const fetcher = vi.fn(async () => response())
      await expect(new HttpSerialRepository(fetcher).saveSettings('w1', input)).resolves.toBeUndefined()
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body]).toEqual(['/api/v1/works/w1/ai-serial', 'PUT', input])
      expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
      expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    }
  })

  it('지금 마감·실행은 본문 없이 POST하고 202(본문 없음)로 끝난다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    await expect(new HttpSerialRepository(fetcher).run('w1')).resolves.toBeUndefined()
    const { url, init, body } = sent(fetcher)
    expect([url, init.method, body]).toEqual(['/api/v1/works/w1/ai-serial/run', 'POST', undefined])
    expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('serial-csrf')
  })

  it('게시판 기록은 GET으로 읽어 서버가 준 순서(최신순) 그대로 돌려준다', async () => {
    const rows = [boardRow({ id: 'b3', episodeNumber: 6, status: 'open', publishedEpisodeNumber: null, closedAt: null }), boardRow({ id: 'b2', status: 'failed', publishedEpisodeNumber: null, failureReason: '검수를 통과하지 못했습니다.' }), boardRow()]
    const fetcher = vi.fn().mockResolvedValue(Response.json(rows))
    expect(await new HttpSerialRepository(fetcher).boards('w1')).toEqual(rows)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w1/ai-serial/boards', expect.objectContaining({ method: 'GET' }))
  })

  it.each([
    ['알 수 없는 상태', [boardRow({ status: 'done' })]],
    ['잘못된 마감 시각', [boardRow({ closedAt: '어제' })]],
    ['배열이 아닌 응답', { items: [boardRow()] }],
  ])('기록 응답이 계약 모양이 아니면(%s) 빈 목록으로 숨기지 않고 거절한다', async (_name, bad) => {
    await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(bad))).boards('w1')).rejects.toThrow('서버 응답 형식')
  })
})

describe('다음 회차 게시판 (투표·제안)', () => {
  it('익명은 Authorization·CSRF 없이 읽는다 (누구나 읽는 공개 게시판)', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json(boardBody()))
    await new HttpSerialRepository(fetcher).board('w 1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w%201/serial-board', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
  })

  it('로그인했으면 Bearer를 실어 내 투표·내 글·내 추천을 받는다', async () => {
    await signIn()
    const body = boardBody({ myChoiceId: 'c1', proposals: [proposalRow({ mine: true, likedByMe: true })] })
    const fetcher = vi.fn().mockResolvedValue(Response.json(body))
    const view = await new HttpSerialRepository(fetcher).board('w1')
    expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect([view.myChoiceId, view.proposals[0].mine, view.proposals[0].likedByMe]).toEqual(['c1', true, true])
  })

  it('AI 자율 집필 여부(enabled)·열린 게시판·선택지 4개·제안 글(시뮬레이션 장면 포함)·종합 문장을 계약 필드 그대로 돌려준다', async () => {
    await signOut()
    const simulation = { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'], scene: '비가 그친 새벽, 그는 편지를 펼쳤다.' }
    const choices = [1, 2, 3, 4].map((position) => choiceRow({ id: 'c' + position, position, text: '전개 ' + position, votes: position - 1 }))
    const body = boardBody({
      choices,
      proposals: [proposalRow({ id: 'p2', kind: 'simulation', title: '편지 장면', body: '편지를 읽는 장면', simulation, likes: 7, mine: true }), proposalRow({ simulation: { premise: '전제', beats: [], scene: null } })],
      summary: '지난 회차는 편지를 둘러싼 갈등을 모았어요.',
    })
    expect(await new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(body))).board('w1')).toEqual(body)
  })

  it.each([
    ['AI 자율 집필이 꺼져 있다(탭을 보이지 않는다)', { enabled: false, board: null, choices: [], myChoiceId: null, proposals: [], summary: null }],
    ['열린 게시판이 없다(다음 회차를 쓰는 중)', { enabled: true, board: null, choices: [], myChoiceId: null, proposals: [], summary: '지난 종합' }],
    ['선택지를 아직 만들지 못했다', boardBody({ choices: [] })],
  ])('게시판 응답의 빈 상태도 그대로 돌려준다: %s', async (_name, body) => {
    await signOut()
    expect(await new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(body))).board('w1')).toEqual(body)
  })

  it.each([
    ['enabled 누락', boardBody({ enabled: undefined })],
    ['선택지 득표수가 문자열', boardBody({ choices: [choiceRow({ votes: '3' })] })],
    ['선택지 번호가 정수가 아님', boardBody({ choices: [choiceRow({ position: '1' })] })],
    ['설정 카드 유형(범위 밖)', boardBody({ proposals: [proposalRow({ kind: 'setting' })] })],
    ['추천 수가 문자열', boardBody({ proposals: [proposalRow({ likes: '3' })] })],
    ['내 추천 표시 누락', boardBody({ proposals: [proposalRow({ likedByMe: undefined })] })],
    ['잘못된 작성 시각', boardBody({ proposals: [proposalRow({ createdAt: '어제' })] })],
    ['proposals 누락', boardBody({ proposals: undefined })],
    ['옛 opinions 모양', { board: { id: 'b9', episodeNumber: 5 }, opinions: [], myOpinionId: null, myVoteOpinionId: null, summary: null }],
  ])('게시판 응답이 계약 모양이 아니면(%s) 빈 게시판으로 숨기지 않고 거절한다', async (_name, bad) => {
    await signOut()
    await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(bad))).board('w1')).rejects.toThrow('서버 응답 형식')
  })

  describe('쓰기 (로그인, CSRF)', () => {
    beforeEach(signIn)

    it('투표·옮기기는 PUT {choiceId}, 취소는 본문 없는 DELETE(204)다', async () => {
      const put = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(put).vote('w1', 'c2')
      expect([sent(put).url, sent(put).init.method, sent(put).body]).toEqual(['/api/v1/works/w1/serial-board/vote', 'PUT', { choiceId: 'c2' }])
      expect(headers(put).get('Authorization')).toBe('Bearer serial-bearer')
      expect(headers(put).get('X-CSRF-TOKEN')).toBe('serial-csrf')
      const del = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await expect(new HttpSerialRepository(del).cancelVote('w1')).resolves.toBeUndefined()
      expect([sent(del).url, sent(del).init.method, sent(del).body]).toEqual(['/api/v1/works/w1/serial-board/vote', 'DELETE', undefined])
      expect(headers(del).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    })

    it('투표 취소 응답이 204가 아니면 취소로 확정하지 않는다', async () => {
      await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json({ ok: true }))).cancelVote('w1')).rejects.toThrow('삭제 완료 응답')
    })

    it('제안 글 제출은 POST로 요청 본문 그대로 보내고 201 응답 본문은 쓰지 않는다', async () => {
      const request = { kind: 'simulation' as const, title: '편지 장면', body: '읽는 장면', simulation: { premise: '전제', beats: ['비트'] } }
      const fetcher = vi.fn().mockResolvedValue(Response.json({ id: 'p9' }, { status: 201 }))
      await expect(new HttpSerialRepository(fetcher).submitProposal('w1', request)).resolves.toBeUndefined()
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body]).toEqual(['/api/v1/works/w1/serial-board/proposals', 'POST', request])
      expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
      expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    })

    it('추천은 PUT, 추천 취소는 DELETE(204)이고 둘 다 글 id를 경로에 맞게 인코딩하며 본문이 없다', async () => {
      const put = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(put).likeProposal('w 1', 'p/1')
      expect([sent(put).url, sent(put).init.method, sent(put).body]).toEqual(['/api/v1/works/w%201/serial-board/proposals/p%2F1/like', 'PUT', undefined])
      const del = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(del).unlikeProposal('w 1', 'p/1')
      expect([sent(del).url, sent(del).init.method, sent(del).body]).toEqual(['/api/v1/works/w%201/serial-board/proposals/p%2F1/like', 'DELETE', undefined])
      expect(headers(del).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    })

    it('제안 글 숨김은 글 id를 경로에 맞게 인코딩해 본문 없이 POST한다', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(fetcher).hideProposal('w 1', 'p/1')
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body]).toEqual(['/api/v1/works/w%201/serial-board/proposals/p%2F1/hide', 'POST', undefined])
    })

    it('쓰기에도 화면 이탈 취소 신호를 이어 준다', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      const leave = new AbortController()
      await new HttpSerialRepository(fetcher).vote('w1', 'c1', leave.signal)
      leave.abort()
      expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    })
  })
})

describe('오류 문구', () => {
  beforeEach(signIn)
  const fail = (status: number, body: unknown) => new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(body, { status })))
  const simulate = (repo: HttpSerialRepository) => repo.submitProposal('w1', { kind: 'simulation', title: '제목', body: '내용', simulation: { premise: '전제', beats: [] } })

  it('크레딧 부족(409 INSUFFICIENT_CREDIT)은 서버 문구 대신 정해 둔 한국어 문구로 알린다 (detail 없는 Core 오류도 같다)', async () => {
    await expect(simulate(fail(409, { detail: 'Server English text.', code: 'INSUFFICIENT_CREDIT' }))).rejects.toThrow(new Error(INSUFFICIENT_CREDIT_MESSAGE))
    await expect(simulate(fail(409, { code: 'INSUFFICIENT_CREDIT', message: 'Not enough credits.' }))).rejects.toThrow(new Error(INSUFFICIENT_CREDIT_MESSAGE))
  })

  it.each([
    ['SERIAL_NO_BOARD', '열린 게시판이 없어요.', (repo: HttpSerialRepository) => repo.vote('w1', 'c1')],
    ['VOTE_CONFLICT', '투표를 처리하는 중이에요. 잠시 뒤 다시 눌러 주세요.', (repo: HttpSerialRepository) => repo.vote('w1', 'c1')],
    ['SERIAL_NO_BOARD', '열린 게시판이 없어요.', (repo: HttpSerialRepository) => repo.submitProposal('w1', { kind: 'general', title: '제목', body: '내용' })],
  ])('409 %s는 서버가 준 한국어 detail을 그대로 알린다 (SERIAL_* 등 나머지 code도 같은 길이다)', async (code, detail, call) => {
    await expect(call(fail(409, { detail, code }))).rejects.toThrow(new Error(detail))
  })

  it('모르는 code나 code 없는 오류는 서버 detail을 그대로 전달하고, detail도 없으면 기본 문구다', async () => {
    await expect(fail(409, { detail: '서버가 준 안내예요.', code: 'SOMETHING_NEW' }).run('w1')).rejects.toThrow('서버가 준 안내예요.')
    await expect(fail(403, { detail: '작품 소유자만 할 수 있어요.' }).saveSettings('w1', { days: ['MON'], time: '21:00', direction: '' })).rejects.toThrow('작품 소유자만 할 수 있어요.')
    await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))).run('w1')).rejects.toThrow('요청을 처리하지 못했어요.')
  })
})

describe('요청 제한 시간', () => {
  beforeEach(signIn)
  const created = () => vi.fn().mockResolvedValue(new Response(null, { status: 201 }))

  it('시뮬레이션 제안 글 제출만 AI 장면 미리보기를 기다리도록 150초이고, 그 밖의 요청은 공용 기본값(80초)이다', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await new HttpSerialRepository(created()).submitProposal('w1', { kind: 'simulation', title: '제목', body: '내용', simulation: { premise: '전제', beats: [] } })
      expect(timeout).toHaveBeenCalledWith(150000)
      expect(timeout).not.toHaveBeenCalledWith(80000)
      timeout.mockClear()
      await new HttpSerialRepository(created()).submitProposal('w1', { kind: 'general', title: '제목', body: '내용' })
      await new HttpSerialRepository(created()).vote('w1', 'c1')
      await new HttpSerialRepository(created()).likeProposal('w1', 'p1')
      expect(timeout).toHaveBeenCalledWith(80000)
      expect(timeout).not.toHaveBeenCalledWith(150000)
    } finally { timeout.mockRestore() }
  })
})
