import { ADMIN_PERMISSIONS, today, type AdminState } from '../entities/admin'
import { EMAIL } from '../entities/account'
import { forkList, hashText, isPub, nid, publicCast, type Work } from '../entities/work'
import type { AdminRepository } from '../repositories/AdminRepository'
import type { ChatRepository } from '../repositories/ChatRepository'
import type { CreditRepository } from '../repositories/CreditRepository'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { InquiryRepository } from '../repositories/InquiryRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import type { ChatUseCase } from './ChatUseCase'

/** 목업 admin()·adminLegacy()·adminExtra()와 15절 관리자 핸들러. 실제 권한 판단은 Core가 맡아야 합니다. */
export class AdminUseCase {
  private readonly adminRepository: AdminRepository
  private readonly workRepository: WorkRepository
  private readonly feedbackRepository: FeedbackRepository
  private readonly inquiryRepository: InquiryRepository
  private readonly creditRepository: CreditRepository
  private readonly chatRepository: ChatRepository
  private readonly chatUseCase: ChatUseCase
  constructor(adminRepository: AdminRepository, workRepository: WorkRepository, feedbackRepository: FeedbackRepository, inquiryRepository: InquiryRepository, creditRepository: CreditRepository, chatRepository: ChatRepository, chatUseCase: ChatUseCase) {
    this.adminRepository = adminRepository
    this.workRepository = workRepository
    this.feedbackRepository = feedbackRepository
    this.inquiryRepository = inquiryRepository
    this.creditRepository = creditRepository
    this.chatRepository = chatRepository
    this.chatUseCase = chatUseCase
  }

  /** 목업 adminLog(): 상태를 바꾼 뒤 활동 로그를 맨 앞에 남깁니다. */
  private async log(change: (a: AdminState) => void, action: string, detail: (a: AdminState) => string) {
    const a = await this.adminRepository.get()
    change(a)
    a.audit.unshift({ at: new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()), actor: a.profile.nick, action, detail: detail(a) })
    await this.adminRepository.save(a)
  }

  /** 화면 하나에 필요한 데이터를 한 번에 모읍니다. */
  async load() {
    const [admin, works, worlds, inquiries, queue, reports, credits, chats, inbox] = await Promise.all([
      this.adminRepository.get(), this.workRepository.listWorks(), this.workRepository.listWorlds(), this.inquiryRepository.list(),
      this.feedbackRepository.listReview(), this.feedbackRepository.listReports(), this.creditRepository.get(), this.chatUseCase.chats(), this.feedbackRepository.listInbox(),
    ])
    const comments = (await this.adminRepository.listComments(works)).map((c) => ({ ...c, status: admin.hiddenComments.includes(c.id) ? '숨김' : '게시' }))
    const originals = works.filter((w) => !w.parent)
    const rights = originals.map((w) => ({
      id: w.id, title: w.title, owner: w.owner === 'me' ? '나' : w.owner ?? '', kind: w.kind, rights: w.rights,
      fork: forkList(w, worlds).length ? (w.forkAll ? '전체 회차' : forkList(w, worlds).join('·') + '화') : '불가',
      reports: queue.filter((q) => q.w === w.id).length, state: w.hidden ? '비공개 (신고 조치)' : w.private ? '비공개' : '공개',
    })).concat([admin.flagged])
    const isolation = works.filter((f) => f.parent && f.snap).map((fk) => {
      const p = works.find((w) => w.id === fk.parent)!, snap = fk.snap!
      const now = hashText(JSON.stringify(p.eps.slice(0, fk.forkAt))), snapNow = hashText(JSON.stringify(snap.eps))
      const diff = snap.cast.flatMap((c) => { const pc = p.cast.find((x) => x.n === c.n); return pc && pc.st !== c.st ? [c.n + ': ' + pc.st + ' → ' + c.st] : [] })
      return { title: fk.title, parent: p.title, forkAt: fk.forkAt, snapNow, now, diff, ok: snapNow === snap.srcHash, same: now === snapNow }
    })
    return {
      admin, works, inquiries, queue, comments, rights, isolation,
      alerts: credits.alerts,
      chats: chats.flatMap((c) => { const w = works.find((x) => x.id === c.workId); return w ? [{ ...c, w }] : [] }),
      reports: reports.filter((r) => !String(r.type).startsWith('신고 ·')),
      expired: originals.filter((w) => w.kind === '저작권 만료'),
      imported: works.some((w) => w.id === 'chunhyang'),
      chunhyangKind: works.find((w) => w.id === 'chunhyang')?.kind ?? '',
      pending: inbox.filter((i) => ['작가 검토 대기', '수정 진행 중', '발행 대기'].includes(i.status)).length,
    }
  }

  /** 목업 #adminCharacterChatForm 선택지: 공개 작품과 공개 인물 */
  chatChoices(works: Work[], kind: string) {
    return works.filter(isPub).filter((w) => kind === 'all' || (kind === 'fork' ? !!w.parent : !w.parent)).map((w) => ({ w, cast: publicCast(w, Math.max(w.eps.length, 1)) }))
  }

  async toggleUser(id: string) {
    await this.log((a) => { const u = a.users.find((x) => x.id === id); if (u) u.status = u.status === '활동' ? '제한' : '활동' }, '사용자 상태 변경', (a) => { const u = a.users.find((x) => x.id === id)!; return u.nick + ' · ' + u.status })
    return '사용자 상태를 변경했어요 (데모)'
  }

  async toggleWork(id: string) {
    const w = (await this.workRepository.listWorks()).find((x) => x.id === id)
    if (!w) return null
    w.hidden = !w.hidden
    await this.workRepository.saveWork(w)
    await this.log(() => {}, '작품 공개 상태 변경', () => w.title + ' · ' + (w.hidden ? '운영상 비공개' : '제한 해제'))
    return '작품 공개 상태를 변경했어요 (데모)'
  }

  async toggleComment(id: string, label: string) {
    let status = ''
    await this.log((a) => { const hidden = a.hiddenComments.includes(id); a.hiddenComments = hidden ? a.hiddenComments.filter((x) => x !== id) : [...a.hiddenComments, id]; status = hidden ? '게시' : '숨김' }, '댓글 상태 변경', () => label + ' · ' + status)
    return '댓글 상태를 변경했어요 (데모)'
  }

  async toggleChat(id: string) {
    const chats = await this.chatUseCase.chats(), works = await this.workRepository.listWorks()
    const chat = chats.find((c) => c.id === id), w = chat && works.find((x) => x.id === chat.workId)
    if (!chat || !w) return null
    chat.enabled = chat.enabled === false
    await this.chatRepository.saveChats(chats)
    await this.log(() => {}, chat.enabled ? '캐릭터챗 운영 재개' : '캐릭터챗 중지', () => w.title + ' · ' + chat.character)
    return chat.enabled ? '캐릭터챗 운영을 재개했어요 (데모)' : '캐릭터챗을 중지했어요 (데모)'
  }

  async addChat(workId: string, character: string) {
    const w = (await this.workRepository.listWorks()).find((x) => x.id === workId)
    if (!w || !isPub(w) || !publicCast(w, Math.max(w.eps.length, 1)).some((c) => c.n === character)) return '공개 작품과 캐릭터를 확인해 주세요'
    const chats = await this.chatUseCase.chats(), existing = chats.find((c) => c.workId === w.id && c.character === character)
    if (existing) { if (existing.enabled !== false) return '이미 운영 중인 캐릭터챗이에요'; existing.enabled = true } else chats.unshift({ id: nid('cchat'), workId: w.id, character, enabled: true })
    await this.chatRepository.saveChats(chats)
    await this.log(() => {}, '캐릭터챗 추가', () => w.title + ' · ' + character)
    return '캐릭터챗을 추가했어요 (데모)'
  }

  async reply(id: string, text: string) {
    const q = (await this.inquiryRepository.list()).find((x) => x.id === id), reply = text.trim()
    if (!q || !reply) return '답변을 입력해 주세요'
    await this.inquiryRepository.save({ ...q, reply, st: '답변 완료' })
    await this.log(() => {}, '문의 답변', () => q.s)
    return '답변을 등록했어요 (데모 · 실제 전송 없음)'
  }

  async addNotice(title: string, body: string) {
    if (!title.trim() || !body.trim()) return '제목과 내용을 입력해 주세요'
    await this.log((a) => { a.notices.unshift([today(), title.trim(), body.trim()]) }, '공지 게시', () => title.trim())
    return '공지를 게시했어요 (데모 · 현재 화면에만 반영)'
  }

  async addEvent(title: string, period: string, body: string) {
    if (!title.trim() || !body.trim()) return '이벤트명과 안내 내용을 입력해 주세요'
    await this.log((a) => { a.events.unshift({ t: title.trim(), p: period.trim() || '기간 미정', st: '예정', d: body.trim(), go: '/', cta: '서비스 둘러보기' }) }, '이벤트 추가', () => title.trim())
    return '이벤트를 추가했어요 (데모 · 현재 화면에만 반영)'
  }

  async toggleEvent(i: number) {
    const a = await this.adminRepository.get()
    if (!a.events[i]) return null
    await this.log((x) => { const e = x.events[i]; e.st = e.st === '진행 중' ? '종료' : '진행 중' }, '이벤트 상태 변경', (x) => x.events[i].t + ' · ' + x.events[i].st)
    return '이벤트 상태를 변경했어요 (데모)'
  }

  /** 목업 data-run-job: 실패 작업만, 실제 실행 없이 기록합니다. */
  async runJob(id: string) {
    const j = (await this.adminRepository.get()).jobs.find((x) => x.id === id)
    if (!j || j.status !== '실패') return null
    await this.log((a) => { Object.assign(a.jobs.find((x) => x.id === id)!, { status: '완료', last: '수동 재시도 흐름 시연 · 실제 작업 없음' }) }, '정기 작업 재시도 시연', () => j.name)
    return '실패 작업의 수동 재시도 흐름을 기록했어요 (실제 작업은 실행하지 않음)'
  }

  async resolveAlert(id: string) {
    const s = await this.creditRepository.get(), al = s.alerts.find((x) => x.id === id)
    if (!al) return null
    al.resolved = true
    await this.creditRepository.save(s)
    await this.log(() => {}, '경고 확인', () => al.task)
    return '조치를 기록했어요. 자동 재처리는 하지 않아요'
  }

  /** 목업 data-adm: 예시 제한 작품(flag1) 조치 */
  async flag(k: 'proof' | 'hide' | 'lift') {
    await this.log((a) => {
      const f = a.flagged
      if (k === 'proof') { f.state = '증빙 요청 중'; f.log.push('· 등록자에게 권리 증빙 요청 (7일)') }
      if (k === 'hide') { f.state = '비공개'; f.log.push('· 비공개 전환') }
      if (k === 'lift') { f.state = '공개'; f.rights = '확인됨'; f.fork = '허용'; f.log.push('· 소명 확인 → 제한 해제') }
    }, '권리 상태 조정', (a) => a.flagged.title + ' · ' + a.flagged.state)
    return '조치를 기록했어요 (데모)'
  }

  /** 목업 data-qact: 신고 처리 결과를 신고자 기록(S.reports)에도 남깁니다. */
  async review(id: string, act: 'ok' | 'hide' | 'keep' | 'restore') {
    const [queue, works, reports] = await Promise.all([this.feedbackRepository.listReview(), this.workRepository.listWorks(), this.feedbackRepository.listReports()])
    const q = queue.find((z) => z.id === id), w = q && works.find((x) => x.id === q.w)
    if (!q || !w) return null
    const r = reports.find((z) => z.id === q.id)
    const set = (status: string, reply: string) => { if (r) Object.assign(r, { status, reply }) }
    if (act === 'ok') { q.status = '문제 없음'; set('처리 완료', '운영팀이 확인했어요. 운영 기준 위반은 아니었어요.') }
    else if (act === 'hide') { q.status = '비공개 조치'; q.beforeHidden = !!w.hidden; w.hidden = true; set('조치 완료', '운영팀이 확인하고 해당 소설을 비공개로 전환했어요.') }
    else if (act === 'restore') {
      if (queue.some((o) => o !== q && o.w === q.w && ['비공개 조치', '소명 제출', '비공개 유지'].includes(o.status))) return '다른 제한이 남아 있어 복원할 수 없어요'
      q.status = '소명 인정'; w.hidden = !!q.beforeHidden; set('처리 완료', '소명이 인정되어 이전 공개 상태로 복원했어요.')
    } else { q.status = '비공개 유지'; set('처리 완료', '소명을 검토한 뒤 비공개 조치를 유지했어요.') }
    await Promise.all([this.feedbackRepository.saveReview(q), this.workRepository.saveWork(w), r && this.feedbackRepository.saveReport(r)])
    await this.log(() => {}, '신고 처리', () => q.type + ' · ' + q.status)
    return '처리 결과를 기록하고 신고자에게 알렸어요 (데모)'
  }

  async saveProfile(nick: string, email: string) {
    const a = await this.adminRepository.get()
    nick = nick.trim(); email = email.trim()
    if (nick.length < 2) return '닉네임은 2자 이상이에요'
    if (!EMAIL.test(email)) return '이메일 형식을 확인해 주세요'
    if (a.admins.some((x) => x.id !== 'primary-admin' && x.email.toLocaleLowerCase() === email.toLocaleLowerCase())) return '이미 등록된 이메일이에요'
    await this.log((x) => { Object.assign(x.profile, { nick, email }); const p = x.admins.find((y) => y.id === 'primary-admin'); if (p) Object.assign(p, { nick, email }) }, '프로필 변경', () => nick + ' · ' + email)
    return '프로필을 저장했어요 (데모 · 현재 화면에만 반영)'
  }

  async addAdmin(nick: string, email: string, permissions: string[]) {
    const a = await this.adminRepository.get()
    nick = nick.trim(); email = email.trim()
    if (nick.length < 2) return '이름은 2자 이상 입력해 주세요'
    if (!EMAIL.test(email)) return '이메일 형식을 확인해 주세요'
    if (a.admins.some((x) => x.email.toLocaleLowerCase() === email.toLocaleLowerCase())) return '이미 등록된 이메일이에요'
    const perms = permissions.filter((p) => ADMIN_PERMISSIONS.some(([k]) => k === p))
    if (!perms.length) return '한 가지 이상 권한을 선택해 주세요'
    await this.log((x) => { x.admins.unshift({ id: nid('admin'), nick, email, permissions: perms, created: today() }) }, '관리자 계정 추가', () => nick + ' · ' + email + ' · ' + perms.length + '개 권한')
    return '관리자 계정을 추가했어요 (데모)'
  }
}
