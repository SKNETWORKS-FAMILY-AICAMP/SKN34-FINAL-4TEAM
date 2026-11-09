import React from 'react'
import {createRoot} from 'react-dom/client'
import {Provider} from 'react-redux'
import {asValue} from 'awilix/browser'
import {appContainer} from './src/app/appContainer'
import {createAppStore} from './src/app/store'
import {WritingStudio} from './src/presentation/features/studio/view/WritingStudio'
import './src/index.css'
const versions=[1,2].map(n=>({id:`v${n}`,episode:1,title:`예시 원고 ${n}`,body:`원고 ${n}`,revision:n,savedAt:'2026-11-05T00:00:00Z'}))
const calls=[]
const api={
 async writingList(){return [{number:1,draft:{title:'예시 회차',body:'저장된 초안',revision:2},versions,publishedVersionId:null,inherited:false,hasDraft:true}]},
 async world(){return {id:'qa121',name:'예시 세계관',revision:0,mode:'own',basis:null,draft:null,drafts:[],settings:[],history:[],sourceToken:'',changes:[]}},
}
for(const name of ['writeEpisode','restoreEpisode','publishEpisode','revertSetting']) api[name]=async()=>{calls.push(name);throw Error('실제 저장 요청 금지')}
appContainer.register({episodeUseCase:asValue(api)})
window.qa121={calls}
createRoot(document.getElementById('root')).render(<Provider store={createAppStore()}><WritingStudio id="qa121"/></Provider>)

const guide=document.createElement('aside')
guide.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff;color:#111;border-bottom:2px solid #6D4AE0;padding:12px 20px;font:16px/1.55 sans-serif;pointer-events:none'
guide.innerHTML='<strong>#121 수정 후 · 버전 관리 명칭과 접근성 이름 정렬</strong><div>이전: 저장 버전 · 공개 → 변경: 원고 버전 · 비교 · 공개</div><div id="dialog-name" style="color:#5234ba;font-weight:700"></div><small>실제 WritingStudio·Sheet / 예시 데이터 / API·DB 미연결 / 실제 저장·공개·복원 없음</small>'
document.body.prepend(guide)
new ResizeObserver(()=>{document.body.style.paddingTop=guide.offsetHeight+'px'}).observe(guide)
const update=()=>{const label=document.querySelector('[role="dialog"]')?.getAttribute('aria-label')??'닫힘';const el=document.getElementById('dialog-name');const value='현재 시트 접근성 이름: '+label;if(el.textContent!==value)el.textContent=value}
new MutationObserver(update).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label']})
update()
