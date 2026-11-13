export type StudioStep='info'|'cards'|'relations'|'review'
export type StudioFlow={screen:'list'|'editor';step:StudioStep}
export type StudioFlowAction={type:'world';id:string|undefined}|{type:'list'|'resume'}|{type:'step';step:StudioStep}
export const initialWorldStudioFlow:StudioFlow={screen:'list',step:'info'}
export function worldStudioFlow(state:StudioFlow,action:StudioFlowAction):StudioFlow {
 switch(action.type){
  case 'world':return {screen:action.id?'editor':'list',step:'info'}
  case 'list':return {...state,screen:'list'}
  case 'resume':return {...state,screen:'editor'}
  case 'step':return {screen:'editor',step:action.step}
 }
}

/** 작성 모드는 탭 줄 없는 4단계 마법사(기본 정보 → 설정 카드 → 관계 연결 → 검토·저장), 관리 모드는 탭 줄·헤더 저장 영역·헤더 편집 패널이다. */
export type StudioMode='write'|'manage'
/** 새 세계관 만들기가 성공해 이동한 주소에 붙는 표시(`?new=1`). 새로고침해도 마법사가 유지되고, 첫 저장이 성공하거나 마법사를 나가면 `replace`로 지운다. */
export const NEW_WORLD_QUERY='new'
/**
 * 작성 모드는 세계관을 처음 만든 직후(`?new=1`)에만이다. 그 밖의 모든 진입(서재 '관리하기'·직접 주소, 저장 버전이 0인 세계관 포함)은 관리 모드이며
 * 저장 버전이 0이어도 헤더 저장 버튼으로 첫 저장을 할 수 있다.
 */
export const studioMode=(params:{get(name:string):string|null}):StudioMode=>params.get(NEW_WORLD_QUERY)==='1'?'write':'manage'

/**
 * 관리 모드 설정집 화면(게시판)의 보기(주소 `?view=`으로 유지·복원): 설정집(기본, 주소에 없음)·인물 관계도·시간선. 작성 모드는 보기 없이 4단계다.
 * 설정 카드 편집은 보기가 아니라 따로 여는 화면이고 주소의 `?card=<id>`로 정한다.
 */
export const MANAGE_VIEWS=[['book','설정집'],['people','인물 관계도'],['timeline','시간선']] as const
export type ManageView=(typeof MANAGE_VIEWS)[number][0]
/** `?view=` 값. 없거나 모르는 값이면 첫 보기(설정집)다. */
export const parseManageView=(value:string|null):ManageView=>MANAGE_VIEWS.find(([key])=>key===value)?.[0]??'book'

/**
 * 옛 주소의 `?tab=`(설정집·인물 관계도·세계관 탐색·AI 후보 검토·확정 버전 탭)을 새 화면으로 옮긴다: 인물 관계도는 같은 이름의 보기, AI 후보 검토는 시트(`review`),
 * 확정 버전은 편집 화면의 버전 그래프로 갔고 세계관 탐색은 없어졌으므로 나머지는 설정집이다. `tab`이 없으면 null이다(손대지 않는다).
 */
export const legacyTabTarget=(value:string|null):{view:ManageView;review:boolean}|null=>
 value===null?null:{view:value==='people'?'people':'book',review:value==='analysis'}
