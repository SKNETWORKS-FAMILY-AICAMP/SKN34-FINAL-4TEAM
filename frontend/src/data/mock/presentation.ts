import story from './hongPresentation.json'
import { presentationPortraits } from '../../app/presentationPortraits'
import { WCATS, type Doc } from '../../domain/entities/wiki'
import { createMockDb } from './InMemoryRepositories'
import { newEpisodeDraft } from '../../domain/entities/draft'
import { makeFork, type StoryEvent } from '../../domain/entities/work'
import { authorEdit, newSetting, type SettingItem, type StudioWorld } from '../../domain/entities/studioWorld'
import { putRelation } from '../../domain/entities/studioRelations'
import type { WorldStudioRepository } from '../../domain/repositories/WorldStudioRepository'

const events: StoryEvent[] = [
  [1, 'm', '길동이 홍문에게 호칭을 청하다', ['길동', '홍문']],
  [2, 'm', '길동이 춘섬에게 떠날 뜻을 밝히다', ['길동', '춘섬']],
]

export function presentationDb() {
  const db = createMockDb()
  const work = db.works.find(w => w.id === 'hong')!
  Object.assign(work, {
    title: story.title, summary: story.summary, hook: story.hook, by: '홍길동전 · 발표용 각색',
    owner: 'me', author: '중간발표 작가', upd: 1, worldIds: [story.world.id], forkFrom: 2,
    forksAllowed: true, forkEps: [2], castFrom: {길동: 1, 홍문: 1, 춘섬: 2},
    ...structuredClone({cast: story.cast, eps: story.eps, rules: story.rules, events}),
  })
  const world = initialWorld()
  const people = world.settings.filter(s => s.item.entityType === 'character')
  work.cast = work.cast.map(c => ({
    ...c, d:people.find(s => s.item.id === c.n)!.item.text,
    knowledge:[{text:c.n === '홍문' ? '길동은 자신을 아버지라고 부르고 싶어 한다.' : '길동은 아직 집을 떠나지 않았으며 춘섬에게 출발할 뜻을 밝혔다.', knownAt:c.n === '홍문' ? 1 : 2, publicAt:c.n === '홍문' ? 1 : 2}],
  }))
  work.synopsis = '집안의 신분 질서에 막힌 길동은 홍문에게 부자 호칭을 청한다. 뜻을 이루지 못한 그는 춘섬에게 출발 계획을 털어놓는다. 3화에서는 어머니의 걱정을 남긴 채 대문을 나서는 선택을 그린다.'
  work.memo = '장면 1 · 춘섬의 방\n등잔과 바느질감. 길동은 문턱에서 잠시 멈춘다.\n\n장면 2 · 이른 새벽의 대문\n춘섬이 주먹밥을 보퉁이에 넣는다. 길동은 첫 장날에 소식을 전하겠다고 약속한다.\n\n집필 확인\n길동의 공손한 말투 유지. 도술 사용은 미정. 춘섬의 걱정이 대사와 행동에 드러나도록 한다.'
  work.narrativeOrder = [...events.map(e => e[2]), '새벽에 열린 대문 · 집필 예정']
  const docs: Doc[] = world.settings.map(({item, tags}) => {
    const eventIndex = events.findIndex(e => e[2] === item.title)
    const cat = item.entityType === 'character' ? 'char' : item.entityType === 'location' ? 'place' : item.kind === 'event' ? 'event' : 'world'
    return {
      id:item.id, cat, t:item.title, alias:[], tags, img:cat === 'char' ? presentationPortraits[item.title] : undefined,
      props:{분류:item.kind, ...(item.kind === 'rule' ? {종류:'규칙', 설정검사:'사용'} : {})},
      at:{}, body:item.text,
      ...(eventIndex >= 0 ? {ep:eventIndex+1, line:'m', who:events[eventIndex][3], links:eventIndex === 0 ? [{to:'event-2', k:'계기'}] : []} : {}),
      ...(cat === 'char' ? {knowledge:work.cast.find(c => c.n === item.title)?.knowledge} : {}),
    }
  })
  docs.push({
    id:'planned-departure', cat:'event', t:'새벽에 열린 대문 · 집필 예정',
    alias:[], tags:['미발행', '3화 계획'], props:{상태:'집필 예정'}, at:{},
    body:story.draft.paras.join('\n\n'), ep:3, line:'m', who:['길동','춘섬'],
    links:[{to:'event-2', k:'이전 사건'}],
  })
  work.wiki = {cats:structuredClone(WCATS), docs}
  db.chat['hong/길동'] = [
    ['나', '왜 아버지 앞에서 말을 멈췄어?'],
    ['길동', '아버지라 부르고 싶었지만 집안사람이 듣는다는 말씀에 입을 다물었습니다.', '1화 · 홍문과의 대화'],
    ['나', '이제 어떻게 할 생각이야?'],
    ['길동', '어머니께 떠날 뜻은 말씀드렸습니다. 제가 떠난 뒤 어머니께 화가 돌아갈까 두렵습니다.', '2화 · 춘섬에게 밝힌 뜻'],
  ]
  db.chat['hong/홍문'] = [
    ['나', '길동을 어떻게 생각하세요?'],
    ['홍문', '총명한 아이지. 아비라 부르고 싶다는 마음을 알면서도 집안의 법도 때문에 말을 막았네.', '1화 · 호칭을 제지한 장면'],
  ]
  db.chat['hong/춘섬'] = [
    ['나', '길동의 출발 계획을 들으셨나요?'],
    ['춘섬', '오늘 들었지요. 떠나는 날까지 혼자 정하려는 듯하여, 우선 방 안에 앉아 이야기하자 했습니다.', '2화 · 등잔 맞은편에 앉는 장면'],
  ]
  db.works = [work, ...db.works.filter(w => w !== work), makeFork(work, 2, structuredClone(story.fork))]
  db.drafts.hong = {...newEpisodeDraft(work), ...structuredClone(story.draft)}
  db.worlds.unshift(structuredClone(story.world))
  db.notifications.unshift({id:'hong-review-notice', type:'결과', title:'홍길동전 세계관 검토 후보 2개', text:'출발 계획과 실제 출발 여부를 원문과 대조해 주세요.', target:'/worlds/hong-world', read:false, at:'오늘'})
  db.progress.last = {hong: 2, ...db.progress.last}
  db.progress.read.hong = [1, 2]
  db.comments.hong2 = [['달빛독자', '춘섬이 붙잡은 이 하룻밤이 길동의 선택을 바꿀까요?', 7]]
  return db
}

function initialWorld(): StudioWorld {
  const profiles: Record<string, string> = {
    길동:'홍문과 춘섬의 아들. 공손한 말투를 쓰지만 출생 신분에 따른 차별에 민감하다. 아버지에게 인정받고 싶다. 2화에서 어머니에게 떠날 뜻을 밝혔으며 아직 집을 떠나지 않았다.',
    홍문:'길동의 아버지. 집안의 법도를 중시하며 다른 식구 앞에서 부자 호칭을 허용하지 않는다. 아들의 총명함을 아끼는 마음과 신분 질서 사이에서 갈등한다.',
    춘섬:'길동의 어머니. 아들의 설움을 이해하지만 떠난 뒤의 안전을 걱정한다. 2화에서 길동의 출발 계획을 처음 듣는다.',
  }
  let settings = story.cast.map(c => ({
    ...authorEdit(newSetting('people'), {id:c.n, title:c.n, text:profiles[c.n]}),
    userCategory:'주요 인물', tags:['홍문의 집', '2화 기준'],
  }))
  // Build through the same relation helper as the editor, including direction and validation.
  settings = putRelation(settings, {subjectId:'길동', targetId:'홍문', predicate:'child_of', polarity:'asserted'})
  settings = putRelation(settings, {subjectId:'길동', targetId:'춘섬', predicate:'child_of', polarity:'asserted'})
  settings = putRelation(settings, {subjectId:'길동', targetId:'춘섬', predicate:'trusts', polarity:'asserted'})
  settings = putRelation(settings, {subjectId:'길동', targetId:'홍문', predicate:'wary_of', polarity:'asserted'})

  const entries: Partial<SettingItem>[] = [
    {id:'house', kind:'entity', entityType:'location', category:'space', title:'홍문의 집', text:'홍문과 춘섬, 길동이 사는 집. 뜰과 춘섬의 방, 대문이 주요 장면의 배경이다.'},
    {id:'courtyard', kind:'entity', entityType:'location', category:'space', title:'달빛이 드는 뜰', text:'1화에서 길동이 검을 거두고 홍문에게 아버지라 부르고 싶다고 말한 장소.', relatedIds:['house']},
    {id:'room', kind:'entity', entityType:'location', category:'space', title:'춘섬의 방', text:'2화에서 길동이 떠날 뜻을 밝힌 장소. 등잔과 바느질감이 놓여 있다.', relatedIds:['house']},
    {id:'period', kind:'fact', category:'space', title:'시대와 생활 공간', text:'조선 세종 때를 배경으로 한 발표용 각색. 현재 이야기는 홍문의 집 안에서 진행된다.', relatedIds:['house']},
    {id:'address-rule', kind:'rule', category:'society', title:'호칭을 가르는 신분 질서', text:story.rules[0], relatedIds:['길동','홍문']},
    {id:'speech', kind:'fact', category:'culture', title:'집안의 말투와 예절', text:'길동은 부모 앞에서 자신을 소자라 칭한다. 감정이 격해져도 공손한 말투를 유지한다.', relatedIds:['길동','홍문','춘섬']},
    {id:'magic', kind:'undetermined', category:'special', title:'길동의 도술 보유 여부', text:'현재 1·2화에서는 도술 습득과 사용을 확정하지 않았다. 후속 장면에서 갑자기 도술을 사용하려면 근거를 먼저 설정한다.', relatedIds:['길동']},
    {id:'conflict', kind:'fact', category:'conflict', title:'가족의 인정과 집안의 법도', text:'길동은 아버지의 인정을 원하고 홍문은 신분 질서를 지키려 한다. 춘섬은 길동의 안전을 우선한다.', relatedIds:['길동','홍문','춘섬','address-rule']},
    {id:'event-1', kind:'event', category:'history', title:events[0][2], text:story.eps[0].p[1], timeText:'1화 · 밤', relatedIds:['길동','홍문','courtyard','address-rule']},
    {id:'event-2', kind:'event', category:'history', title:events[1][2], text:story.eps[1].p[1], timeText:'2화 · 이튿날', afterId:'event-1', relatedIds:['길동','춘섬','room']},
    {id:'departure-note', kind:'note', category:'basic', title:'3화 집필 메모', text:'원작은 길동의 출발, Fork는 춘섬과 하루 더 의논하는 전개를 준비한다. 두 방향 모두 2화까지 확정한 인물 관계와 사건을 출발점으로 삼는다.', relatedIds:['event-2']},
  ]
  settings.push(...entries.map(patch => ({
    ...authorEdit(newSetting(), patch), userCategory:'연재 설정', tags:['홍길동전'],
  })))
  const candidate = authorEdit(newSetting(), {
    id:'review-mother', kind:'fact', title:'춘섬은 길동의 출발 계획을 알고 있다',
    text:'2화에서 길동은 춘섬에게 집을 떠날 뜻을 밝혔다.', subjectId:'춘섬', relatedIds:['길동','event-2'],
  }).item
  const disputed = authorEdit(newSetting(), {
    id:'review-departed', kind:'fact', title:'길동은 이미 집을 떠났다',
    text:'길동은 2화 말에 홍문의 집을 떠났다.', subjectId:'길동', relatedIds:['house','event-2'],
  }).item
  return {
    id:story.world.id, name:story.world.name, description:story.world.description, version:1, settings,
    analysis:{id:'hong-review', status:'review', issues:[],
      candidates:[
        {...candidate, origin:'extraction', authorText:null, decision:'pending',
          evidence:[{sourceId:'event-2', quote:story.eps[1].p[1]}]},
        {...disputed, origin:'extraction', authorText:null, decision:'pending',
          evidence:[{sourceId:'event-2', quote:story.eps[1].p[2]}]},
      ],
    },
  }
}
export class PresentationWorldRepository implements WorldStudioRepository {
  private readonly worlds = new Map([[story.world.id, initialWorld()]])
  async connect() {}
  async capabilities() { return {aiEnabled:true} }
  async listStudio() { return structuredClone([...this.worlds.values()]) }
  async list() {
    return (await this.listStudio()).map(w => ({
      id:w.id, name:w.name, description:w.description, public:w.id === story.world.id,
      rules:w.settings.filter(s => s.item.kind === 'rule').map(s => s.item.text),
    }))
  }
  async read(id:string) {
    const w = this.worlds.get(id)
    if (!w) throw new Error('세계관을 찾을 수 없습니다.')
    return structuredClone(w)
  }
  async create(name:string, description:string) {
    const world:StudioWorld = {id:crypto.randomUUID(), name, description, version:1, settings:[], analysis:null}
    this.worlds.set(world.id, world)
    return structuredClone(world)
  }
  async saveStudio(w:StudioWorld) {
    if (this.worlds.get(w.id)?.version !== w.version) throw new Error('세계관 버전이 변경되었습니다. 다시 열어 주세요.')
    const saved = structuredClone({...w, version:w.version + 1})
    this.worlds.set(w.id, saved)
    return structuredClone(saved)
  }
  async analyze(w:StudioWorld) {
    const quote = w.description.trim() || w.name
    const item = authorEdit(newSetting(), {title:'배경 요약', text:quote}).item
    const candidate:SettingItem = {...item, origin:'extraction', authorText:null, decision:'pending',
      evidence:[{sourceId:w.id, quote}]}
    return this.saveStudio({...w, analysis:{id:crypto.randomUUID(), status:'review', candidates:[candidate], issues:[]}})
  }
  async approve(w:StudioWorld, ids:string[], edits:SettingItem[]) {
    const run = w.analysis
    if (!run || !ids.length || ids.some(id => !run.candidates.some(c => c.id === id && c.decision === 'pending'))) {
      throw new Error('검토할 후보를 선택해 주세요.')
    }
    const candidates = run.candidates.map(c => ids.includes(c.id)
      ? {...(edits.find(e => e.id === c.id) ?? c), decision:'approved' as const} : c)
    const rows = candidates.filter(c => ids.includes(c.id)).map(item => ({item, userCategory:'설정', tags:[]}))
    return this.saveStudio({...w, settings:[...w.settings,...rows], analysis:{...run, candidates}})
  }
  async save() { throw new Error('세계관 작업실에서 저장해 주세요.') }
  async remove() { throw new Error('세계관 이력 삭제는 지원하지 않습니다.') }
}
