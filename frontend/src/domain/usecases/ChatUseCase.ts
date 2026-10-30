import type { CharacterChat, ChatLine } from '../entities/chat'
import { epsOf, firstEp, forkList, isPub, nid, ofKind, publicCast, sorter, visibleEpisode, type Role, type Work } from '../entities/work'
import type { ChatRepository } from '../repositories/ChatRepository'
import type { ReadingRepository, WorkRepository } from '../repositories/WorkRepository'

/** 목업 CHAT: 인물별 첫인사와 [알게 되는 회차, 질문, 답] 예시 (실제 AI 응답 아님) */
const CHAT: Record<string, { hi: string; q: [number, string, string][] }> = {
  '성진': { hi: '소승 성진이라 합니다. 무엇이 궁금하십니까?', q: [[1, '용궁에서 왜 술을 마셨어요?', '용왕께서 거듭 권하시니 끝내 거절하지 못했습니다. 계율을 어긴 것이 내내 마음에 걸립니다.'], [2, '돌다리에서 무슨 일이 있었어요?', '선녀들이 길을 비켜 주지 않아 복숭아꽃 한 가지를 던져 길을 청했습니다. 그 뒤로 마음이 고요하지 않습니다.'], [3, '스승님께 벌을 받고 어떤 마음이었어요?', '부끄러웠습니다. 잠시 세상의 부귀를 그렸을 뿐인데, 스승님은 그 마음을 이미 알고 계셨습니다.']] },
  '육관대사': { hi: '연화봉의 육관이다. 물을 것이 있으면 물어라.', q: [[1, '성진을 왜 용궁에 보냈나요?', '동정호 용왕께 감사의 뜻을 전해야 했느니라. 제자들 가운데 성진이 가장 믿음직하였다.'], [3, '성진을 왜 인간 세상으로 보냈나요?', '마음이 이미 산 밖에 가 있었느니라. 원하는 곳에서 스스로 깨닫게 하려 함이다.']] },
  '팔선녀': { hi: '위부인의 심부름을 다녀오는 길이랍니다.', q: [[2, '왜 돌다리를 비켜 주지 않았어요?', '스님께 정말 신통력이 있는지 궁금했지요. 작은 장난이었답니다.'], [2, '받은 구슬은 어떻게 했어요?', '하나씩 소중히 품고 구름을 탔지요.']] },
  '양소유': { hi: '회남 수주현의 양소유라 하오.', q: [[4, '연화봉을 기억하나요?', '연화봉이라… 처음 듣는 곳이오. 어딘가 그리운 이름이긴 하오만.']] },
  '리안': { hi: '저는 견습 서약사 리안이에요.', q: [[1, '왜 별빛 탑에 왔어요?', '스승님 오르벤이 사라진 지 석 달이에요. 남기신 서한 한 장을 들고 찾아왔어요.'], [2, '서고에서 무엇을 들었어요?', '봉인 아래에서 속삭임이 들렸어요. 스승님 이름을 부르는 것 같았어요.']] },
  '카엘': { hi: '탑을 지키는 카엘이오.', q: [[1, '왜 밤에 문을 안 열어 줬어요?', '해가 진 뒤에는 문이 열리지 않소. 탑의 규칙이오.'], [3, '세라핀을 왜 막았어요?', '탑 안에서는 어떤 마법도 허락되지 않소. 그 사절의 눈길이 수정에 머물러 있었소.']] },
  '세라핀': { hi: '재의 왕국 사절, 세라핀이야.', q: [[3, '리안을 왜 도우려고 해요?', '오르벤의 제자라면 알 텐데. 수정이 꺼지면 탑도, 우리 왕국도 무사하지 못해.']] },
  '도윤': { hi: '배달부 도윤이야. 편지 있어?', q: [[1, '그 편지는 어디로 가요?', '주소가 지워져 있어. 봉투엔 ‘집’이라는 한 단어뿐이야.']] },
  '하람': { hi: '7구역의 하람이야.', q: [[2, '그 편지가 왜 중요해?', '우리 엄마 글씨야. 삼 년 동안 아무 소식도 없었어.']] },
  '길동': { hi: '홍 판서 댁의 길동입니다.', q: [[1, '왜 아버지라 부르지 못해요?', '서자로 태어났기 때문입니다. 대장부로 태어나 이보다 더한 설움이 어디 있겠습니까.']] },
  '홍 판서': { hi: '홍 판서일세.', q: [[1, '길동을 어떻게 생각하세요?', '총명한 아이지. 하나를 들으면 열을 알아. 그래서 더 마음이 무겁네.']] },
}
const HOLD = '그건 아직 말할 수 없어요. 소설을 조금 더 읽고 다시 물어봐 주세요.'

/** 목업 characterChats(): 저장된 목록이 없으면 공개 원작의 공개 인물마다 하나씩 엽니다. */
export async function chatsOf(chatRepository: ChatRepository, works: Work[]): Promise<CharacterChat[]> {
  const saved = await chatRepository.listChats()
  if (saved) return saved
  const all = works.filter((w) => isPub(w) && !w.parent)
    .flatMap((w) => publicCast(w, Math.max(w.eps.length, 1)).map((c) => ({ id: nid('cchat'), workId: w.id, character: c.n, enabled: true })))
  await chatRepository.saveChats(all)
  return all
}

export type ChatFilter = { kind: string; work: string; character: string; sort: string }

/** 목업 chatListPage()·chatPage()·chatReply(): U27 캐릭터 챗. 읽은 회차까지 공개된 원고에서만 답을 찾습니다. */
export class ChatUseCase {
  private readonly workRepository: WorkRepository
  private readonly readingRepository: ReadingRepository
  private readonly chatRepository: ChatRepository
  constructor(workRepository: WorkRepository, readingRepository: ReadingRepository, chatRepository: ChatRepository) {
    this.workRepository = workRepository
    this.readingRepository = readingRepository
    this.chatRepository = chatRepository
  }

  private async context() {
    const [works, progress] = await Promise.all([this.workRepository.listWorks(), this.readingRepository.getProgress()])
    const chats = (await chatsOf(this.chatRepository, works)).filter((c) => c.enabled !== false)
    const base = (w: Work) => Math.max(progress.last[w.id] || 0, 1)
    return { works, progress, chats, base }
  }

  async list(f: ChatFilter) {
    const { works, chats, base } = await this.context()
    const st = { ...f }
    const all = chats.flatMap((c) => {
      const w = works.find((x) => x.id === c.workId)
      const character = w && isPub(w) ? publicCast(w, base(w)).find((x) => x.n === c.character) : undefined
      return w && character ? [{ w, character, parent: works.find((x) => x.id === w.parent) }] : []
    })
    const byKind = all.filter((x) => ofKind(st.kind, x.w))
    const ws = [...new Map(byKind.map((x) => [x.w.id, x.w])).values()].sort((a, b) => a.title.localeCompare(b.title, 'ko'))
    if (st.work !== 'all' && !ws.some((w) => w.id === st.work)) st.work = 'all'
    const byWork = byKind.filter((x) => st.work === 'all' || x.w.id === st.work)
    const characters = [...new Set(byWork.map((x) => x.character.n))].sort((a, b) => a.localeCompare(b, 'ko'))
    if (st.character !== 'all' && !characters.includes(st.character)) st.character = 'all'
    const compare = sorter(st.sort)
    const listed = byWork.filter((x) => st.character === 'all' || x.character.n === st.character)
      .sort((a, b) => compare(a.w, b.w) || a.w.title.localeCompare(b.w.title, 'ko') || a.character.n.localeCompare(b.character.n, 'ko'))
    return { st, works: ws, characters, listed }
  }

  /** 대화할 수 없는 작품·인물이면 null (목록으로 돌아갑니다). */
  async page(wid: string, cn: string | undefined) {
    const { works, progress, chats, base } = await this.context()
    const worlds = await this.workRepository.listWorlds()
    const chatWorks = works.filter((w) => isPub(w) && chats.some((c) => c.workId === w.id && publicCast(w, base(w)).some((x) => x.n === c.character)))
    const w = chatWorks.find((x) => x.id === wid)
    if (!w) return null
    const entries = chats.filter((c) => c.workId === wid)
    const read = Math.max(progress.last[wid] || 0, 0), b = base(w)
    const cs = publicCast(w, b).filter((c) => entries.some((e) => e.character === c.n))
    if (cn && !cs.some((c) => c.n === cn)) return null
    const cur = cn ? cs.find((c) => c.n === cn) : cs[0]
    const key = wid + '/' + cur?.n
    let log = await this.chatRepository.getLog(key)
    if (!log && cur) { log = [[cur.n, (CHAT[cur.n] ?? { hi: '안녕하세요.' }).hi]]; await this.chatRepository.saveLog(key, log) }
    const FL = forkList(w, worlds).filter((n) => n <= b)
    return {
      w, chatWorks, cs, cur, read, base: b, key, log: log ?? [],
      questions: cur ? (CHAT[cur.n]?.q ?? []) : [],
      forkAt: FL.length ? FL[FL.length - 1] : forkList(w, worlds)[0],
    }
  }

  /** 목업 bindChat의 data-cq·#chf와 chatReply(): 질문과 답을 돌려줍니다. 기록은 append로 남깁니다. */
  async answer(wid: string, cn: string, input: { q: number } | { text: string }, role: Role): Promise<{ question: string; reply: [string, string] } | null> {
    const { works, base } = await this.context()
    const w = works.find((x) => x.id === wid)
    if (!w) return null
    const b = base(w)
    if ('q' in input) {
      const q = CHAT[cn]?.q[input.q]
      if (!q) return null
      return { question: q[1], reply: q[0] > b ? [`그건 아직 말할 수 없어요. ${q[0]}화를 읽고 다시 물어봐 주세요.`, `스포일러 방지 · ${b}화까지 읽은 기준`] : [q[2], `근거 · ${q[0]}화`] }
    }
    const text = input.text.trim()
    const eps = epsOf(w)
    const keys = (text.match(/[가-힣]{2,}/g) ?? []).map((x) => x.replace(/(은|는|이|가|을|를|의|에|도|요|에서|했어|해요|어요)$/, '')).filter((x) => x.length >= 2 && x !== cn)
    const hit = (from: number, to: number) => {
      let best: { pp: string; n: number } | null = null, sc = 0
      for (const [i, e] of eps.slice(from, to).entries()) {
        if (!visibleEpisode(w, e, role)) continue
        for (const pp of e.p) { const c = keys.filter((k) => pp.includes(k)).length; if (c > sc) { sc = c; best = { pp, n: from + i + 1 } } }
      }
      return best
    }
    const spoiler: [string, string] = [HOLD, `스포일러 방지 · ${b}화까지 읽은 기준`]
    if (w.cast.some((c) => firstEp(w, c.n) > b && text.includes(c.n))) return { question: text, reply: spoiler }
    const now = hit(0, b)
    if (now) return { question: text, reply: [`${b}화까지의 소설로 보면… “${now.pp.length > 70 ? now.pp.slice(0, 70) + '…' : now.pp}”`, `근거 · ${now.n}화`] }
    if (hit(b, eps.length)) return { question: text, reply: spoiler }
    return { question: text, reply: ['공개된 소설 안에서는 답을 찾지 못했어요. 지어내서 대답하지 않을게요.', '근거 없음'] }
  }

  async append(key: string, line: ChatLine) {
    await this.chatRepository.saveLog(key, [...(await this.chatRepository.getLog(key)) ?? [], line])
  }
}
