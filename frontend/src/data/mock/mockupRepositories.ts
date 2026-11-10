import type { Draft, SavedSetting, Work, World, WritingEpisode } from '../../domain/entities/content'
import { manuscriptText } from '../../domain/entities/media'
import { newSetting, type SettingItem, type StudioSetting } from '../../domain/entities/studioWorld'
import type { AuthRepository, AuthUser } from '../../domain/repositories/AuthRepository'
import type { EpisodeRepository } from '../../domain/repositories/EpisodeRepository'
import type { FeedbackReportRepository } from '../../domain/repositories/FeedbackReportRepository'
import type { ManuscriptRepository } from '../../domain/repositories/ManuscriptRepository'
import type { MediaRepository } from '../../domain/repositories/MediaRepository'
import type { NotificationRepository } from '../../domain/repositories/NotificationRepository'
import { InMemoryWorldStudioRepository } from '../world-studio/InMemoryWorldStudioRepository'

/**
 * 발표용 오프라인 목업 빌드(`vite build --mode mockup`) 전용 대역.
 * ponytail: 서버 인증·알림을 흉내 내지 않고 데모 회원만 돌려줍니다. 실제 앱 빌드에는 등록되지 않습니다.
 */
const writer: AuthUser = { id: 'demo-writer', email: 'writer@storyfork.demo', nickname: '연화봉러', operator: false }
const admin: AuthUser = { id: 'primary-admin', email: 'admin@storyfork.demo', nickname: '관리자', operator: true }

export const mockupAuthRepository: AuthRepository = {
  login: async (email) => (email === admin.email ? admin : { ...writer, email: email || writer.email }),
  refresh: async () => writer,
  logout: async () => {},
  forgotPassword: async () => {},
  resetPassword: async () => {},
  sessions: async () => [{ id: 'demo', deviceLabel: '발표용 브라우저', createdAt: new Date().toISOString(), current: true }],
  revokeSession: async () => {},
  logoutAll: async () => {},
}

export const mockupNotificationRepository: NotificationRepository = {
  list: async () => ({ items: [], nextCursor: null }),
  unreadCount: async () => 0,
  markRead: async () => {},
  markAllRead: async () => {},
  remove: async () => {},
  getPrefs: async () => ({ read: true, creator: true }),
  savePrefs: async (prefs) => prefs,
}

const demoUnsupported = () => Promise.reject(new Error('데모에서는 지원하지 않아요.'))

/**
 * 원고 가져오기와 EPUB·발행본 내보내기는 성공을 흉내 내지 않고 데모 미지원 오류로 답합니다.
 * 데모 집필실의 TXT 초안 내보내기만 메모리 원고로 실제 파일을 만듭니다(이미지 표식 제외).
 */
export function createMockupManuscriptRepository(writing: Pick<EpisodeRepository, 'list' | 'writingList'>): ManuscriptRepository {
  return {
    preview: demoUnsupported,
    confirm: demoUnsupported,
    exportManuscript: async (workId, query, signal) => {
      if (query.format !== 'txt' || query.source !== 'draft') return demoUnsupported()
      const whole = query.episode === undefined
      const own = (await writing.writingList(workId, signal)).filter((e) => !e.inherited && (whole || e.number === query.episode))
      if (!own.length) throw new Error('내보낼 수 있는 회차가 없어요.')
      const title = whole ? (await writing.list(signal)).find((w) => w.id === workId)?.title ?? '원고' : own[0].draft.title
      const chapters = own.map((e) => `${e.draft.title}\n\n${manuscriptText(e.draft.body)}`).join('\n\n\n')
      return { blob: new Blob(['\uFEFF', whole ? `${title}\n\n\n${chapters}` : chapters], { type: 'text/plain;charset=utf-8' }), filename: `${title.replace(/[\\/:*?"<>|]/g, '_')}.txt` }
    },
  }
}

/** 설정 첨부 이름 변경과 회차 이미지 목록·대체 텍스트·공개 설명 조회도 같습니다. 나머지 첨부 동작은 기존 HTTP 저장소 그대로입니다. */
export const mockupUnsupportedMedia: Pick<MediaRepository, 'rename' | 'listEpisodeImages' | 'updateEpisodeImageAlt' | 'publicEpisodeImageAlts'> = {
  rename: demoUnsupported, listEpisodeImages: demoUnsupported, updateEpisodeImageAlt: demoUnsupported, publicEpisodeImageAlts: demoUnsupported,
}

/**
 * 정본(서버) 작품이 없는 발표용 빌드·테스트의 제보 저장소: 목록은 비어 있고 쓰기는 데모 미지원 오류로 답합니다(성공을 흉내 내지 않음).
 * 데모 작품의 피드백은 기존 메모리 경로(FeedbackRepository)가 그대로 맡습니다.
 */
export const mockupFeedbackReportRepository: FeedbackReportRepository = {
  create: demoUnsupported, listEpisode: async () => [], listMine: async () => [], listInbox: async () => [],
  setVisibility: demoUnsupported, correct: demoUnsupported, withdraw: demoUnsupported, check: demoUnsupported, answer: demoUnsupported, setStatus: demoUnsupported,
}

const now = () => new Date().toISOString()
const HONG_BODY = '조선국 세종 시절에 한 재상이 있으니, 성은 홍이요 명은 문이라.\n\n하루는 시비 춘섬이 아들을 낳으니 일홈을 길동이라 하였다. 길동이 점점 자라 팔 세가 되매 총명이 과인하여 하나를 들으면 백을 통하였다.\n\n그러나 길동은 아버지를 아버지라 부르지 못하고, 형을 형이라 부르지 못하니 밤마다 달을 보며 탄식하였다.'

const setting = (id: string, name: string, category: SavedSetting['category'], content: string, evidence: string): SavedSetting => ({
  id, versionId: `${id}-v1`, name, category, content, evidence, tags: [], visibility: 'public', fromEpisode: 1, toEpisode: null, knownBy: [],
})
const confirmedWorld = (id: string): World => {
  const settings = [
    setting('gildong', '홍길동', '인물', '홍 승상의 서자. 아버지를 아버지라 부르지 못한다.', '일홈을 길동이라'),
    setting('hongmun', '홍문', '인물', '홍 승상. 집안의 법도를 중시한다.', '성은 홍이요 명은 문이라'),
    setting('father', '홍길동 → 홍문', '관계', '홍길동의 아버지는 홍문이다.', '일홈을 길동이라'),
    setting('seoja', '적서 차별', '규칙', '서자는 아버지를 아버지라 부를 수 없다.', '아버지를 아버지라 부르지 못하고'),
  ]
  return { id, name: '홍길동전', revision: 1, mode: 'own', basis: null, draft: null, settings, drafts: [], history: settings, sourceToken: 'mockup', changes: [] }
}

/** 시연 ① 작가 집필: 서버 원고 작업실의 자동저장·버전 저장·복원·발행만 메모리로 흉내 냅니다. */
export function createMockupWritingRepository() {
  const work: Work = {
    id: '00000000-0000-4000-8000-00000000a001', title: '홍길동전 다시 쓰기', summary: '아버지를 아버지라 부르지 못한 소년의 이야기를 작가가 이어 씁니다.',
    visibility: 'private', allowFork: true, allowForkPublication: true, source: null, episodes: [], draft: { title: '', body: '', revision: 0 }, revision: 0,
    creationType: 'ORIGINAL', genres: ['고전 영웅'], hashtags: ['#활빈당'], hasWritingEpisode: true,
  }
  const episodes: WritingEpisode[] = [
    { number: 1, draft: { title: '아버지라 부르지 못한 밤', body: HONG_BODY, revision: 1 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: now(), checkpointStatus: 'READY', hasDraft: true, checkpoints: [] },
  ]
  const find = (number: number) => {
    const episode = episodes.find((e) => e.number === number)
    if (!episode) throw new Error('데모 회차를 찾을 수 없어요.')
    return episode
  }
  const addVersion = (episode: WritingEpisode, draft: Draft) => {
    episode.versions.push({ id: crypto.randomUUID(), episode: episode.number, title: draft.title, body: draft.body, revision: draft.revision, savedAt: now() })
  }
  const touch = (episode: WritingEpisode, draft: Pick<Draft, 'title' | 'body'>) => {
    episode.draft = { title: draft.title, body: draft.body, revision: episode.draft.revision + 1 }
    episode.updatedAt = now()
    return episode
  }
  return {
    list: async () => [structuredClone(work)],
    publicList: async () => [],
    writingList: async (_id: string) => structuredClone(episodes),
    createEpisode: async (_id: string, title: string) => {
      const episode: WritingEpisode = { number: episodes.length + 1, draft: { title, body: '', revision: 1 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: now(), checkpointStatus: 'READY', hasDraft: true, checkpoints: [] }
      episodes.push(episode)
      return structuredClone(episode)
    },
    writeEpisode: async (_id: string, number: number, draft: Draft, version: boolean) => {
      const episode = touch(find(number), draft)
      if (version) addVersion(episode, episode.draft)
      return structuredClone(episode)
    },
    // 슬라이드 24: 복원은 기존 버전을 지우지 않고 복원본을 새 버전으로 추가합니다.
    restoreEpisode: async (_id: string, number: number, _revision: number, versionId: string) => {
      const episode = find(number)
      const source = episode.versions.find((v) => v.id === versionId)
      if (!source) throw new Error('복원할 버전을 찾을 수 없어요.')
      addVersion(touch(episode, source), episode.draft)
      return structuredClone(episode)
    },
    publishEpisode: async (_id: string, number: number, _revision: number, versionId: string, rights: boolean) => {
      if (!rights) throw new Error('발행 권리를 확인해 주세요.')
      const episode = find(number)
      if (!episode.versions.some((v) => v.id === versionId)) throw new Error('발행할 버전을 찾을 수 없어요.')
      episode.publishedVersionId = versionId
      return structuredClone(episode)
    },
    orderScope: async (_id: string, number: number) => ({ number, candidateNumbers: [], reasons: ['데모에서는 순서 검토를 실행하지 않아요.'], executable: false as const }),
    // 시연 ② 확정 설정 확인: 집필실 '설정 버전 이력'에 보이는 확정 설정입니다.
    world: async (id: string) => structuredClone(confirmedWorld(id)),
    revertSetting: async () => { throw new Error('발표용 목업에서는 설정 복원을 막아 두었어요.') },
    deleteDraft: async () => { throw new Error('발표용 목업에서는 삭제를 막아 두었어요.') },
    deleteEpisode: async () => { throw new Error('발표용 목업에서는 삭제를 막아 두었어요.') },
  } satisfies Partial<EpisodeRepository>
}

const card = (id: string, title: string, text: string, extra: Partial<SettingItem> = {}): StudioSetting => ({
  userCategory: '설정', tags: [],
  item: { ...newSetting('people').item, id, title, text, authorText: text, ...extra },
})

/**
 * 시연 ② 세계관: 슬라이드 19의 홍길동전 인물·부모 관계에 설정집·시간선·AI 후보 검토용 장소·사건·후보를 더해 둡니다.
 * 후보는 AI 실행 결과가 아니라 발표용 예시이며, 확정 설정·설정집에는 포함되지 않습니다.
 */
export function createMockupWorldStudioRepository() {
  const relation = (id: string, title: string, subjectId: string, targetId: string, predicate: string, text: string, quote: string) =>
    card(id, title, text, { kind: 'relation', category: 'basic', entityType: null, subjectId, targetId, predicate, evidence: [{ sourceId: 'hong-1', quote }] })
  const place = (id: string, title: string, text: string, relatedIds: string[] = []) => card(id, title, text, { kind: 'entity', category: 'space', entityType: 'location', relatedIds })
  const fact = (id: string, kind: SettingItem['kind'], category: SettingItem['category'], title: string, text: string, relatedIds: string[]) => card(id, title, text, { kind, category, entityType: null, relatedIds })
  const event = (id: string, title: string, text: string, timeText: string, afterId: string | null, relatedIds: string[]) => card(id, title, text, { kind: 'event', category: 'history', entityType: null, timeText, afterId, relatedIds })
  const candidate = (id: string, title: string, text: string, subjectId: string, quote: string): SettingItem => ({
    ...newSetting().item, id, kind: 'fact', title, text, subjectId, relatedIds: ['event-2'], origin: 'extraction', authorText: null, decision: 'pending', evidence: [{ sourceId: 'event-2', quote }],
  })
  return new InMemoryWorldStudioRepository([{
    id: '00000000-0000-4000-8000-00000000b001', name: '홍길동전', description: '조선 세종 시절, 신분 질서와 가족의 정이 부딪치는 홍 승상 댁. 서자로 태어난 길동은 아버지를 아버지라 부르지 못한다.', version: 1,
    settings: [
      card('gildong', '홍길동', '홍 승상의 서자. 공손한 말투를 쓰지만 출생 신분에 따른 차별에 민감하다. 아버지에게 인정받고 싶다. 2화에서 어머니에게 떠날 뜻을 밝혔으며 아직 집을 떠나지 않았다.'),
      card('hongmun', '홍문', '홍 승상. 집안의 법도를 중시하며 다른 식구 앞에서 부자 호칭을 허용하지 않는다. 아들의 총명함을 아끼는 마음과 신분 질서 사이에서 갈등한다.'),
      card('chunseom', '춘섬', '홍 승상 댁의 시비이자 길동의 어머니. 아들의 설움을 이해하지만 떠난 뒤의 안전을 걱정한다.'),
      place('hong-house', '홍 승상 댁', '길동이 태어나 자란 곳. 뜰과 춘섬의 방, 대문이 주요 장면의 배경이다.'),
      place('courtyard', '달빛이 드는 뜰', '1화에서 길동이 검을 거두고 홍문에게 아버지라 부르고 싶다고 말한 장소.', ['hong-house']),
      place('room', '춘섬의 방', '2화에서 길동이 떠날 뜻을 밝힌 장소. 등잔과 바느질감이 놓여 있다.', ['hong-house']),
      fact('rule-seoja', 'rule', 'society', '적서 차별', '서자는 아버지를 아버지, 형을 형이라 부를 수 없다.', ['gildong', 'hongmun']),
      fact('speech', 'fact', 'culture', '집안의 말투와 예절', '길동은 부모 앞에서 자신을 소자라 칭한다. 감정이 격해져도 공손한 말투를 유지한다.', ['gildong', 'hongmun', 'chunseom']),
      fact('magic', 'undetermined', 'special', '길동의 도술 보유 여부', '1·2화에서는 도술 습득과 사용을 확정하지 않았다. 후속 장면에서 도술을 쓰려면 근거를 먼저 설정한다.', ['gildong']),
      fact('conflict', 'fact', 'conflict', '가족의 인정과 집안의 법도', '길동은 아버지의 인정을 원하고 홍문은 신분 질서를 지키려 한다. 춘섬은 길동의 안전을 우선한다.', ['gildong', 'hongmun', 'chunseom', 'rule-seoja']),
      event('event-1', '길동이 홍문에게 호칭을 청하다', '“소자도 아버지라 부르고 싶습니다.” 홍문은 방문 쪽을 돌아보더니 목소리를 낮췄다. “집안사람이 듣는다.”', '1화 · 밤', null, ['gildong', 'hongmun', 'courtyard', 'rule-seoja']),
      event('event-2', '길동이 춘섬에게 떠날 뜻을 밝히다', '“제가 떠나면 어머니께 화가 돌아갈까 두렵습니다.” 길동이 말했다. 춘섬이 바느질감을 내려놓았다.', '2화 · 이튿날', 'event-1', ['gildong', 'chunseom', 'room']),
      relation('rel-father', '홍길동의 아버지', 'gildong', 'hongmun', 'child_of', '홍길동의 아버지는 홍문(홍 승상)이다.', '일홈을 길동이라'),
      relation('rel-mother', '홍길동의 어머니', 'gildong', 'chunseom', 'child_of', '홍길동의 어머니는 춘섬이다.', '춘섬이 아들을 낳으니'),
      relation('rel-trust', '어머니를 믿는 길동', 'gildong', 'chunseom', 'trusts', '길동은 떠날 뜻을 춘섬에게 먼저 털어놓는다.', '어머니께 먼저 찾아가리라'),
      relation('rel-wary', '아버지 앞에서 조심하는 길동', 'gildong', 'hongmun', 'wary_of', '길동은 집안의 법도를 앞세우는 홍문 앞에서 말을 아낀다.', '집안사람이 듣는다'),
    ],
    analysis: { id: 'hong-review', status: 'review', issues: [], candidates: [
      candidate('review-mother', '춘섬은 길동의 출발 계획을 알고 있다', '2화에서 길동은 춘섬에게 집을 떠날 뜻을 밝혔다.', 'chunseom', '“제가 떠나면 어머니께 화가 돌아갈까 두렵습니다.” 길동이 말했다.'),
      candidate('review-departed', '길동은 이미 집을 떠났다', '길동은 2화 말에 홍 승상 댁을 떠났다.', 'gildong', '“떠나는 날까지도 혼자 정할 셈이냐.” 길동은 대답 대신 방 안으로 들어와 등잔 맞은편에 앉았다.'),
    ] },
  }])
}
