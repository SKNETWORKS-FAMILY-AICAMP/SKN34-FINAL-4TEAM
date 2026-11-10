import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpAdminActivityRepository, HttpMemberRepository, HttpOperationsWorkRepository, HttpReportRepository, HttpSupportInquiryRepository } from './operationsApi'

const reply = { id: 'p1', body: '답변\n내용', createdAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T02:00:00Z' }
const inquiry = {
  id: 'q1', memberId: '3f2c9a10-0000-4000-8000-000000000001', category: '계정', title: '로그인 문의', body: '첫 줄\n둘째 줄', status: 'ANSWERED',
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T02:00:00Z', replies: [reply],
}
const report = {
  id: 'r1', kind: 'RIGHTS', workId: 'w1', workTitle: '별빛', workOwnerId: 'owner', reporterId: 'u1', reason: '무단 사용', evidence: '',
  status: 'RECEIVED', contentRestricted: false, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
}
const member = { id: 'm1', email: 'm1@example.test', nickname: '연화', role: 'MEMBER', restricted: false, createdAt: '2026-11-08T00:00:00Z' }
const work = {
  workId: 'w1', ownerId: 'owner-1', title: '별빛 서약의 탑', authorName: '연화봉러', originKind: 'fork', creationType: 'external_derivative',
  rightsConfirmed: false, visibility: 'private', restricted: true,
}
const activity = {
  id: 'a1', actorId: 'admin-1', actorNickname: '운영자', action: 'WORK_RESTRICT', targetType: 'WORK', targetId: 'w1',
  detail: '별빛 서약의 탑', createdAt: '2026-11-10T01:00:00Z',
}
type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const empty = (status: number) => vi.fn(async () => new Response(null, { status }))

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'o-csrf' }) : Response.json({ accessToken: 'o-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

describe('HttpReportRepository', () => {
  it('운영 목록은 Bearer로 조회하고 선택 상태만 query로 보낸다', async () => {
    const fetcher = ok({ items: [report] })
    const repo = new HttpReportRepository(fetcher)
    expect(await repo.listAll('ACCEPTED')).toEqual([report])
    await repo.listAll(null)
    await repo.listMine()
    const [[url, init], [all], [mine]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/reports?status=ACCEPTED')
    expect(init.headers.Authorization).toBe('Bearer o-bearer')
    expect(all).toBe('/api/v1/operations/reports')
    expect(mine).toBe('/api/v1/operations/reports/mine')
  })

  it('상세는 이력까지 검증하고 알 수 없는 상태는 거부한다', async () => {
    // 작품 제한·해제 이력은 본문이 없어 서버가 body: null로 보낸다.
    const history = [
      { id: 'h1', type: 'EVIDENCE_REQUEST', actorId: 'a1', body: '계약서', createdAt: '2026-11-08T01:00:00Z' },
      { id: 'h2', type: 'RESTRICT', actorId: 'a1', body: null, createdAt: '2026-11-08T02:00:00Z' },
    ]
    expect(await new HttpReportRepository(ok({ ...report, history })).get('r1')).toEqual({ ...report, history })
    await expect(new HttpReportRepository(ok({ ...report, status: 'DONE' })).get('r1')).rejects.toThrow('서버 응답 형식을 확인할 수 없어요.')
  })

  it('접수·보완·소명·검토·증빙 요청은 JSON 본문으로 보낸다', async () => {
    const fetcher = empty(201)
    const repo = new HttpReportRepository(fetcher)
    await repo.submit({ kind: 'HARMFUL', workId: 'w1', reason: '사유', evidence: '' })
    await repo.addEvidence('r1', '링크')
    await repo.addExplanation('r1', '소명')
    await repo.review('r1', 'REJECTED', '근거 부족')
    await repo.requestEvidence('r1', '계약서')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body, init.headers['Content-Type']])).toEqual([
      ['/api/v1/operations/reports', 'POST', JSON.stringify({ kind: 'HARMFUL', workId: 'w1', reason: '사유', evidence: '' }), 'application/json'],
      ['/api/v1/operations/reports/r1/evidence', 'POST', JSON.stringify({ body: '링크' }), 'application/json'],
      ['/api/v1/operations/reports/r1/explanations', 'POST', JSON.stringify({ body: '소명' }), 'application/json'],
      ['/api/v1/operations/reports/r1/review', 'POST', JSON.stringify({ decision: 'REJECTED', note: '근거 부족' }), 'application/json'],
      ['/api/v1/operations/reports/r1/evidence-requests', 'POST', JSON.stringify({ body: '계약서' }), 'application/json'],
    ])
  })

  it('콘텐츠 제한은 POST, 해제는 DELETE를 쓴다', async () => {
    const fetcher = ok(report)
    const repo = new HttpReportRepository(fetcher)
    await repo.setContentRestriction('r 1', true)
    await repo.setContentRestriction('r 1', false)
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method])).toEqual([
      ['/api/v1/operations/reports/r%201/restriction', 'POST'], ['/api/v1/operations/reports/r%201/restriction', 'DELETE'],
    ])
  })

  it.each([
    [403, '이 작업을 할 권한이 없어요.'],
    [404, '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [502, '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 성공으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const repo = new HttpReportRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(repo.review('r1', 'ACCEPTED', '확인')).rejects.toThrow(new OperationsError(message))
  })
})

describe('HttpMemberRepository', () => {
  it('회원 목록은 역할·검색어·정렬을 query로 보내고 응답을 검증한다', async () => {
    const fetcher = ok({ items: [member] })
    expect(await new HttpMemberRepository(fetcher).list({ role: 'MEMBER', q: '연 화', sort: 'oldest' })).toEqual([member])
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/members?role=MEMBER&q=%EC%97%B0+%ED%99%94&sort=oldest')
    await expect(new HttpMemberRepository(ok({ items: [{ ...member, role: 'OWNER' }] })).list({ role: 'ALL', q: '', sort: 'newest' })).rejects.toThrow()
  })

  it('이용 제한은 PUT, 해제는 DELETE를 쓴다', async () => {
    const fetcher = ok(member)
    const repo = new HttpMemberRepository(fetcher)
    await repo.setRestriction('m1', true)
    await repo.setRestriction('m1', false)
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method])).toEqual([
      ['/api/v1/operations/members/m1/restriction', 'PUT'], ['/api/v1/operations/members/m1/restriction', 'DELETE'],
    ])
  })

  it('관리자 목록은 권한을 포함하고, 생성은 권한과 함께 보낸다', async () => {
    const admin = { ...member, role: 'ADMIN', permissions: ['users'] }
    expect(await new HttpMemberRepository(ok({ items: [admin] })).listAdmins()).toEqual([admin])
    const fetcher = ok(admin, 201)
    const input = { email: 'a@example.test', nickname: '운영', password: 'StoryforkDev123!', permissions: ['users'] }
    await new HttpMemberRepository(fetcher).createAdmin(input)
    expect(callsOf(fetcher)[0]).toMatchObject(['/api/v1/operations/admins', { method: 'POST', body: JSON.stringify(input) }])
  })

  it('신고 조치의 409는 이메일 중복이 아니라 충돌로 안내한다', async () => {
    await expect(new HttpReportRepository(empty(409)).review('r1', 'ACCEPTED', '확인')).rejects.toThrow('다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.')
  })

  it('중복 이메일(409)을 안내한다', async () => {
    const repo = new HttpMemberRepository(empty(409))
    await expect(repo.createAdmin({ email: 'a@example.test', nickname: '운영', password: 'StoryforkDev123!', permissions: ['users'] })).rejects.toThrow('이미 등록된 이메일이에요.')
  })
})

describe('HttpOperationsWorkRepository (74 운영 작품 조회)', () => {
  it('작품 목록은 Bearer로 끝 슬래시 없는 경로를 GET하고 응답을 검증한다', async () => {
    const fetcher = ok({ items: [work] })
    expect(await new HttpOperationsWorkRepository(fetcher).list()).toEqual([work])
    expect(callsOf(fetcher)).toHaveLength(1)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/works')
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer o-bearer' } })
  })

  it('계약에 없는 값이나 빠진 필드는 거부한다', async () => {
    const failed = '서버 응답 형식을 확인할 수 없어요.'
    for (const patch of [{ originKind: 'derived' }, { creationType: 'copy' }, { visibility: 'hidden' }, { rightsConfirmed: 'yes' }, { restricted: null }, { authorName: undefined }, { workId: 1 }]) {
      await expect(new HttpOperationsWorkRepository(ok({ items: [{ ...work, ...patch }] })).list()).rejects.toThrow(failed)
    }
    await expect(new HttpOperationsWorkRepository(ok([work])).list()).rejects.toThrow(failed)
  })

  it('운영 제한은 PUT, 해제는 DELETE를 쓰고 작품 id를 인코딩한다', async () => {
    const fetcher = ok({ workId: 'w 1', ownerId: 'owner-1', title: '별빛 서약의 탑', restricted: true })
    const repo = new HttpOperationsWorkRepository(fetcher)
    await repo.setRestriction('w 1', true)
    await repo.setRestriction('w 1', false)
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/works/w%201/restriction', 'PUT', undefined], ['/api/v1/operations/works/w%201/restriction', 'DELETE', undefined],
    ])
  })

  it.each([
    [403, '이 작업을 할 권한이 없어요.'],
    [404, '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [502, '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 성공으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const repo = new HttpOperationsWorkRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(repo.list()).rejects.toThrow(new OperationsError(message))
    await expect(repo.setRestriction('w1', true)).rejects.toThrow(new OperationsError(message))
    await expect(repo.setRestriction('w1', false)).rejects.toThrow(new OperationsError(message))
  })
})

describe('HttpAdminActivityRepository (72 관리자 활동 기록)', () => {
  it('활동 기록은 Bearer로 끝 슬래시 없는 경로를 GET하고 닉네임·내역이 null인 행도 받는다', async () => {
    const rows = [activity, { ...activity, id: 'a2', actorNickname: null, action: 'NOTICE_DELETE', targetType: 'NOTICE', targetId: 'n1', detail: null }]
    const fetcher = ok({ items: rows })
    expect(await new HttpAdminActivityRepository(fetcher).list()).toEqual(rows)
    expect(callsOf(fetcher)).toHaveLength(1)
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/admin/activities')
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer o-bearer' } })
  })

  it('계약에 없는 형태나 빠진 필드는 거부한다', async () => {
    const failed = '서버 응답 형식을 확인할 수 없어요.'
    for (const patch of [{ createdAt: '어제' }, { actorNickname: undefined }, { detail: undefined }, { actorId: 1 }, { targetId: null }, { action: undefined }]) {
      await expect(new HttpAdminActivityRepository(ok({ items: [{ ...activity, ...patch }] })).list()).rejects.toThrow(failed)
    }
    await expect(new HttpAdminActivityRepository(ok([activity])).list()).rejects.toThrow(failed)
  })

  it.each([
    [403, '이 작업을 할 권한이 없어요.'],
    [502, '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 빈 목록으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const repo = new HttpAdminActivityRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(repo.list()).rejects.toThrow(new OperationsError(message))
  })
})

describe('HttpSupportInquiryRepository', () => {
  it('내 문의와 운영 목록은 Bearer로 조회하고 선택 상태만 query로 보낸다', async () => {
    const fetcher = ok({ items: [inquiry] })
    const repo = new HttpSupportInquiryRepository(fetcher)
    expect(await repo.listMine()).toEqual([inquiry])
    await repo.listAll(null)
    await repo.listAll('WAITING')
    const [[mine, init], [all], [waiting]] = callsOf(fetcher)
    expect(mine).toBe('/api/v1/operations/support/inquiries/mine')
    expect(init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer o-bearer' } })
    expect(all).toBe('/api/v1/operations/support/inquiries')
    expect(waiting).toBe('/api/v1/operations/support/inquiries?status=WAITING')
  })

  it('상세는 답변까지 검증하고 알 수 없는 상태·잘못된 답변은 거부한다', async () => {
    const fetcher = ok(inquiry)
    expect(await new HttpSupportInquiryRepository(fetcher).get('q 1')).toEqual(inquiry)
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/support/inquiries/q%201')
    const failed = '서버 응답 형식을 확인할 수 없어요.'
    await expect(new HttpSupportInquiryRepository(ok({ ...inquiry, status: 'DONE' })).get('q1')).rejects.toThrow(failed)
    await expect(new HttpSupportInquiryRepository(ok({ ...inquiry, replies: [{ ...reply, body: 1 }] })).get('q1')).rejects.toThrow(failed)
    await expect(new HttpSupportInquiryRepository(ok({ items: [{ ...inquiry, memberId: undefined }] })).listMine()).rejects.toThrow(failed)
    await expect(new HttpSupportInquiryRepository(ok({ items: [{ ...inquiry, createdAt: '어제' }] })).listAll(null)).rejects.toThrow(failed)
  })

  it('접수와 답변 등록·수정은 JSON 본문으로, 답변 삭제는 본문 없이 보낸다', async () => {
    const fetcher = ok(inquiry, 201)
    const repo = new HttpSupportInquiryRepository(fetcher)
    await repo.create({ category: '계정', title: '제목', body: '첫 줄\n둘째 줄' })
    await repo.addReply('q1', '답변')
    await repo.updateReply('q 1', 'p 1', '수정')
    await repo.deleteReply('q1', 'p1')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body, init.headers['Content-Type']])).toEqual([
      ['/api/v1/operations/support/inquiries', 'POST', JSON.stringify({ category: '계정', title: '제목', body: '첫 줄\n둘째 줄' }), 'application/json'],
      ['/api/v1/operations/support/inquiries/q1/replies', 'POST', JSON.stringify({ body: '답변' }), 'application/json'],
      ['/api/v1/operations/support/inquiries/q%201/replies/p%201', 'PUT', JSON.stringify({ body: '수정' }), 'application/json'],
      ['/api/v1/operations/support/inquiries/q1/replies/p1', 'DELETE', undefined, undefined],
    ])
  })

  it.each([
    [400, '입력값을 확인해 주세요.'],
    [403, '이 작업을 할 권한이 없어요.'],
    [404, '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [500, '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'],
  ])('%s 응답은 성공으로 숨기지 않고 안내 오류로 바꾼다', async (status, message) => {
    const repo = new HttpSupportInquiryRepository(vi.fn(async () => Response.json({ code: 'X', message: 'internal' }, { status })))
    await expect(repo.addReply('q1', '답변')).rejects.toThrow(new OperationsError(message))
    await expect(repo.create({ category: '계정', title: '제목', body: '본문' })).rejects.toThrow(new OperationsError(message))
    await expect(repo.listAll('ANSWERED')).rejects.toThrow(new OperationsError(message))
    await expect(repo.get('q1')).rejects.toThrow(new OperationsError(message))
  })
})
