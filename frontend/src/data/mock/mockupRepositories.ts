import type { Draft, SavedSetting, Work, World, WritingEpisode } from '../../domain/entities/content'
import { newSetting, type SettingItem, type StudioSetting } from '../../domain/entities/studioWorld'
import type { AuthRepository, AuthUser } from '../../domain/repositories/AuthRepository'
import type { EpisodeRepository } from '../../domain/repositories/EpisodeRepository'
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
    visibility: 'private', allowFork: true, allowForkPublication: true, source: null, episodes: [], draft: { title: '', body: '', revision: 0 },
    creationType: 'ORIGINAL', genres: ['고전 영웅'], hashtags: ['#활빈당'], hasWritingEpisode: true,
  }
  const episodes: WritingEpisode[] = [
    { number: 1, draft: { title: '아버지라 부르지 못한 밤', body: HONG_BODY, revision: 1 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: now(), checkpointStatus: 'READY', hasDraft: true },
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
      const episode: WritingEpisode = { number: episodes.length + 1, draft: { title, body: '', revision: 1 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: now(), checkpointStatus: 'READY', hasDraft: true }
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

/** 시연 ② 세계관: 슬라이드 19의 홍길동전 인물·부모 관계를 미리 넣어 둡니다. */
export function createMockupWorldStudioRepository() {
  const relation = (id: string, title: string, subjectId: string, targetId: string, text: string, quote: string) =>
    card(id, title, text, { kind: 'relation', category: 'basic', entityType: null, subjectId, targetId, predicate: 'child_of', evidence: [{ sourceId: 'hong-1', quote }] })
  return new InMemoryWorldStudioRepository([{
    id: '00000000-0000-4000-8000-00000000b001', name: '홍길동전', description: '조선 세종 시절, 서자로 태어난 길동이 활빈당을 이끄는 이야기.', version: 1, analysis: null,
    settings: [
      card('gildong', '홍길동', '홍 승상의 서자. 총명하지만 아버지를 아버지라 부르지 못해 괴로워한다.'),
      card('hongmun', '홍문', '홍 승상. 집안의 법도를 중시하며 길동의 호칭을 제지한다.'),
      card('chunseom', '춘섬', '홍 승상 댁의 시비이자 길동의 어머니.'),
      card('hong-house', '홍 승상 댁', '길동이 태어나 자란 곳.', { kind: 'entity', category: 'space', entityType: 'location' }),
      card('rule-seoja', '적서 차별', '서자는 아버지를 아버지, 형을 형이라 부를 수 없다.', { kind: 'rule', category: 'society', entityType: null }),
      relation('rel-father', '홍길동의 아버지', 'gildong', 'hongmun', '홍길동의 아버지는 홍문(홍 승상)이다.', '일홈을 길동이라'),
      relation('rel-mother', '홍길동의 어머니', 'gildong', 'chunseom', '홍길동의 어머니는 춘섬이다.', '춘섬이 아들을 낳으니'),
    ],
  }])
}
