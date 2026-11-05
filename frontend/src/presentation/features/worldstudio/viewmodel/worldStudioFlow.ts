export type StudioStep='info'|'cards'|'relations'|'review'
export type StudioFlow={screen:'list'|'editor';step:StudioStep}
export type StudioFlowAction={type:'open'|'list'|'resume'}|{type:'step';step:StudioStep}
export const initialWorldStudioFlow:StudioFlow={screen:'list',step:'info'}
export function worldStudioFlow(state:StudioFlow,action:StudioFlowAction):StudioFlow {
 switch(action.type){
  case 'open':return {screen:'editor',step:'info'}
  case 'list':return {...state,screen:'list'}
  case 'resume':return {...state,screen:'editor'}
  case 'step':return {screen:'editor',step:action.step}
 }
}
