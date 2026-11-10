import type { StoryEvent, Work } from '../../domain/entities/work'
import { WCATS } from '../../domain/entities/wiki'
import type { ReadingWorkRecord, ReadingWorldRecord } from './HttpEpisodeRepository'

/**
 * Content 작품 응답을 화면의 Work로 바꾼다. 목록·검색·랭킹 카드가 같이 쓴다. likes(공개 좋아요 수)·views(최근 24시간 조회 수)는 공개 응답의
 * 서버 값이고 소유자 응답에서는 0이다. 서버에 없는 댓글 수·갱신 시각은 statisticsSupported:false로 화면이 표시하지 않게 한다.
 * 원작/Fork는 source 유무로 가른다.
 */
export function mapReadingWork(row: ReadingWorkRecord, mine = false): Work {
  const episodes = [...row.episodes].sort((a, b) => a.number - b.number)
  const mapEpisode = (e: typeof episodes[number]) => ({ t: e.title, p: e.body.split('\n\n'), versionId: e.versionId })
  const inherited = episodes.filter(e => e.inherited).map(mapEpisode)
  return {
    id: row.id, slug: row.slug ?? undefined, canonical: true, title: row.title, summary: row.summary, theme: row.theme,
    author: row.authorName, owner: row.ownerId, mine, genre: (row.genres ?? []).join(' · '),
    kind: row.source ? '포크' : '원작', rights: '권리 진술 별도 확인', by: row.authorName,
    tags: row.source ? ['if'] : [], hash: (row.hashtags ?? []).map(t => '#' + t),
    statisticsSupported: false, likes: row.likes, views: row.views, cmts: 0, upd: 0,
    hook: row.hook, hanja: row.hanja ?? undefined, hero: row.hero ?? undefined, heroBg: row.heroBg ?? undefined,
    private: row.visibility !== 'public', forksAllowed: row.allowFork, forkAll: false, forkEps: row.forkableEpisodes,
    forkFrom: row.forkableEpisodes[0] ?? 0, parent: row.source?.workId, parentTitle: row.source?.title, parentDeleted: row.source?.deleted, forkAt: row.source?.episode, dir: row.source?.direction,
    eps: episodes.filter(e => !e.inherited).map(mapEpisode), cast: [], rules: [], events: [],
    wiki: { docs: [], cats: structuredClone(WCATS) },
    ...(row.source ? { snap: { eps: inherited, rules: [], cast: [], events: [], takenAt: 0, srcHash: '' } } : {}),
  }
}

export function withReadingWorld(work: Work, world: ReadingWorldRecord): Work {
  if (world.workId !== work.id) throw new Error('세계관 응답의 작품을 확인할 수 없어요.')
  const docs = world.documents.map(d => ({ id: d.id, cat: d.category, t: d.name, body: d.body,
    alias: d.aliases, tags: d.tags, props: Object.fromEntries(d.properties.map(p => [p.name, p.value])),
    at: {}, img: d.image, knowledge: d.knowledge, ep: d.episode ?? undefined, line: d.line ?? undefined,
    who: d.participants, links: d.links.map(l => ({ to: l.to, k: l.kind })),
  }))
  const cast = world.documents.filter(d => d.category === 'char').map(d => ({ n: d.name, c: d.color,
    d: d.properties.find(p => p.name === '설명')?.value ?? d.body, st: d.properties.find(p => p.name === '상태')?.value ?? '—', knowledge: d.knowledge }))
  const rules = world.documents.filter(d => d.category === 'world').map(d => d.name)
  const events: StoryEvent[] = world.documents.filter(d => d.category === 'event' && d.episode != null)
    .map(d => [d.episode!, d.line ?? 'm', d.name, d.participants])
  return { ...work, cast, rules, events, wiki: { docs, cats: structuredClone(WCATS) },
    ...(work.snap ? { snap: { ...work.snap, cast, rules, events } } : {}),
  }
}
