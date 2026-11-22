import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { INSUFFICIENT_CREDIT_MESSAGE } from '../../domain/entities/aiSerial'
import { login, refresh } from '../api/auth'
import { HttpSerialRepository } from './HttpSerialRepository'

const settingsRow = (extra: Record<string, unknown> = {}) => ({ enabled: true, days: ['MON', 'THU'], time: '21:00', direction: '밝은 분위기로', ...extra })
const boardRow = (extra: Record<string, unknown> = {}) => ({ id: 'b1', episodeNumber: 4, status: 'published', publishedEpisodeNumber: 4, failureReason: null, closedAt: '2026-11-22T12:00:00Z', ...extra })
const opinionRow = (extra: Record<string, unknown> = {}) => ({ id: 'o1', authorName: '독자', kind: 'general', body: '반전이 좋겠어요', simulation: null, votes: 3, createdAt: '2026-11-22T01:00:00Z', ...extra })
const boardBody = (extra: Record<string, unknown> = {}) => ({ board: { id: 'b9', episodeNumber: 5 }, opinions: [opinionRow()], myOpinionId: null, myVoteOpinionId: null, summary: null, ...extra })
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

describe('독자 의견 게시판', () => {
  it('익명은 Authorization·CSRF 없이 읽는다 (누구나 읽는 공개 게시판)', async () => {
    await signOut()
    const fetcher = vi.fn().mockResolvedValue(Response.json(boardBody()))
    await new HttpSerialRepository(fetcher).board('w 1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/works/w%201/serial-board', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    expect(headers(fetcher).has('Authorization')).toBe(false)
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
  })

  it('로그인했으면 Bearer를 실어 내 의견·내 투표를 받는다', async () => {
    await signIn()
    const fetcher = vi.fn().mockResolvedValue(Response.json(boardBody({ myOpinionId: 'o1', myVoteOpinionId: 'o2' })))
    const view = await new HttpSerialRepository(fetcher).board('w1')
    expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
    expect(headers(fetcher).has('X-CSRF-TOKEN')).toBe(false)
    expect([view.myOpinionId, view.myVoteOpinionId]).toEqual(['o1', 'o2'])
  })

  it('열린 게시판·의견(시뮬레이션 장면 포함)·종합 문장을 계약 필드 그대로 돌려준다', async () => {
    await signOut()
    const simulation = { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'], scene: '비가 그친 새벽, 그는 편지를 펼쳤다.' }
    const body = boardBody({ opinions: [opinionRow({ id: 'o2', kind: 'simulation', body: '편지를 읽었다면', simulation, votes: 7 }), opinionRow({ simulation: { premise: '전제', beats: [], scene: null } })], summary: '지난 회차는 편지를 둘러싼 갈등을 모았어요.' })
    const view = await new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(body))).board('w1')
    expect(view).toEqual(body)
  })

  it('열린 게시판이 없으면 board가 null이다', async () => {
    await signOut()
    const none = { board: null, opinions: [], myOpinionId: null, myVoteOpinionId: null, summary: '지난 종합' }
    expect(await new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(none))).board('w1')).toEqual(none)
  })

  it.each([
    ['설정 카드 유형(범위 밖)', boardBody({ opinions: [opinionRow({ kind: 'setting' })] })],
    ['득표수가 문자열', boardBody({ opinions: [opinionRow({ votes: '3' })] })],
    ['잘못된 작성 시각', boardBody({ opinions: [opinionRow({ createdAt: '어제' })] })],
    ['opinions 누락', boardBody({ opinions: undefined })],
  ])('게시판 응답이 계약 모양이 아니면(%s) 빈 게시판으로 숨기지 않고 거절한다', async (_name, bad) => {
    await signOut()
    await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(bad))).board('w1')).rejects.toThrow('서버 응답 형식')
  })

  describe('쓰기 (로그인, CSRF)', () => {
    beforeEach(signIn)

    it('의견 제출은 POST로 요청 본문 그대로 보내고 201 응답 본문은 쓰지 않는다', async () => {
      const request = { kind: 'simulation' as const, body: '', simulation: { premise: '전제', beats: ['비트'] } }
      const fetcher = vi.fn().mockResolvedValue(Response.json(opinionRow(), { status: 201 }))
      await expect(new HttpSerialRepository(fetcher).submitOpinion('w1', request)).resolves.toBeUndefined()
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body]).toEqual(['/api/v1/works/w1/serial-board/opinions', 'POST', request])
      expect(headers(fetcher).get('Authorization')).toBe('Bearer serial-bearer')
      expect(headers(fetcher).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    })

    it('투표·옮기기는 PUT {opinionId}, 취소는 본문 없는 DELETE(204)다', async () => {
      const put = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(put).vote('w1', 'o2')
      expect([sent(put).url, sent(put).init.method, sent(put).body]).toEqual(['/api/v1/works/w1/serial-board/vote', 'PUT', { opinionId: 'o2' }])
      const del = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await expect(new HttpSerialRepository(del).cancelVote('w1')).resolves.toBeUndefined()
      expect([sent(del).url, sent(del).init.method, sent(del).body]).toEqual(['/api/v1/works/w1/serial-board/vote', 'DELETE', undefined])
      expect(headers(del).get('X-CSRF-TOKEN')).toBe('serial-csrf')
    })

    it('투표 취소 응답이 204가 아니면 취소로 확정하지 않는다', async () => {
      await expect(new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json({ ok: true }))).cancelVote('w1')).rejects.toThrow('삭제 완료 응답')
    })

    it('의견 숨김은 의견 id를 경로에 맞게 인코딩해 본문 없이 POST한다', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      await new HttpSerialRepository(fetcher).hideOpinion('w 1', 'o/1')
      const { url, init, body } = sent(fetcher)
      expect([url, init.method, body]).toEqual(['/api/v1/works/w%201/serial-board/opinions/o%2F1/hide', 'POST', undefined])
    })

    it('쓰기에도 화면 이탈 취소 신호를 이어 준다', async () => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
      const leave = new AbortController()
      await new HttpSerialRepository(fetcher).vote('w1', 'o1', leave.signal)
      leave.abort()
      expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    })
  })
})

describe('오류 문구', () => {
  beforeEach(signIn)
  const fail = (status: number, body: unknown) => new HttpSerialRepository(vi.fn().mockResolvedValue(Response.json(body, { status })))
  const simulate = (repo: HttpSerialRepository) => repo.submitOpinion('w1', { kind: 'simulation', body: '', simulation: { premise: '전제', beats: [] } })

  it('크레딧 부족(409 INSUFFICIENT_CREDIT)은 서버 문구 대신 정해 둔 한국어 문구로 알린다 (detail 없는 Core 오류도 같다)', async () => {
    await expect(simulate(fail(409, { detail: 'Server English text.', code: 'INSUFFICIENT_CREDIT' }))).rejects.toThrow(new Error(INSUFFICIENT_CREDIT_MESSAGE))
    await expect(simulate(fail(409, { code: 'INSUFFICIENT_CREDIT', message: 'Not enough credits.' }))).rejects.toThrow(new Error(INSUFFICIENT_CREDIT_MESSAGE))
  })

  it.each([
    ['OPINION_EXISTS', '이 게시판에는 이미 의견을 냈어요.', (repo: HttpSerialRepository) => repo.submitOpinion('w1', { kind: 'general', body: '의견' })],
    ['VOTE_CONFLICT', '투표를 처리하는 중이에요. 잠시 뒤 다시 눌러 주세요.', (repo: HttpSerialRepository) => repo.vote('w1', 'o1')],
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

  it('시뮬레이션 의견 제출만 AI 장면 미리보기를 기다리도록 150초이고, 그 밖의 요청은 공용 기본값(80초)이다', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await new HttpSerialRepository(created()).submitOpinion('w1', { kind: 'simulation', body: '', simulation: { premise: '전제', beats: [] } })
      expect(timeout).toHaveBeenCalledWith(150000)
      expect(timeout).not.toHaveBeenCalledWith(80000)
      timeout.mockClear()
      await new HttpSerialRepository(created()).submitOpinion('w1', { kind: 'general', body: '의견' })
      await new HttpSerialRepository(created()).vote('w1', 'o1')
      expect(timeout).toHaveBeenCalledWith(80000)
      expect(timeout).not.toHaveBeenCalledWith(150000)
    } finally { timeout.mockRestore() }
  })
})
