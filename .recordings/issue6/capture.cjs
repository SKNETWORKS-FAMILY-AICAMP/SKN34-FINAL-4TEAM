
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const out = path.join(__dirname, 'take-' + Date.now())
fs.mkdirSync(out)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'storyfork-issue6-'))
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,
  '--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-component-update','--disable-extensions','--hide-scrollbars','about:blank'
], { windowsHide: true, stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let seq = 0
const calls = new Map()
let ws, recording = false, recorder
const frames = []
const checks = []
const send = (method, params = {}) => new Promise((resolve,reject) => {
  const id = ++seq
  calls.set(id, { resolve, reject, method })
  ws.send(JSON.stringify({id,method,params}))
})
async function until(fn, label, timeout=12000) {
  const start=Date.now()
  while (Date.now()-start < timeout) {
    const value=await fn()
    if (value) return value
    await sleep(65)
  }
  throw Error('Timeout: '+label)
}
async function evalJs(expression) {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const str = JSON.stringify
async function setCaption(title, detail) {
  await evalJs('window.caption(' + str(title) + ',' + str(detail) + ')')
}
const el = s => 'document.querySelector('+str(s)+')'
const status = () => evalJs(el('#saved')+'?.textContent?.trim()')
async function click(selector, text='') {
  const found = await until(() => evalJs('(() => { const node = [...document.querySelectorAll('+str(selector)+')].find(x => x.getClientRects().length && (!'+str(text)+' || x.textContent.trim() === '+str(text)+')); if (!node) return null; node.scrollIntoView({block:"nearest",inline:"nearest"}); const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()'), selector+' '+text)
  await evalJs('window.mark?.('+found.x+','+found.y+')')
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...found})
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...found})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...found})
}
async function replaceText(selector, text) {
  await click(selector)
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2,commands:['selectAll']})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2})
  await send('Input.insertText',{text})
}
async function screenFrame() {
  const frame=await send('Page.captureScreenshot',{format:'jpeg',quality:92,fromSurface:true})
  const file='frame'+String(frames.length).padStart(5,'0')+'.jpg'
  fs.writeFileSync(path.join(out,file),Buffer.from(frame.data,'base64'))
  frames.push({file, time:Date.now()})
}
async function record() {
  while (recording) {
    const tick=Date.now()
    await screenFrame()
    await sleep(Math.max(0, 75-(Date.now()-tick)))
  }
}
const seen = (s, t) => evalJs('[...document.querySelectorAll('+str(s)+')].some(e=> e.getClientRects().length && e.textContent.includes('+str(t)+'))')
async function sheet() { await click('#pubep'); await until(()=>evalJs('!!document.querySelector("#doPub")'),'publish sheet') }
async function runCheck() {
  await sheet()
  await click('[role="dialog"] button,dialog button','설정 검사 하기')
  await until(()=>evalJs('!document.querySelector("#doPub")'),'check completed')
}
async function main() {
  const portFile=path.join(profile,'DevToolsActivePort')
  const port = await until(()=>fs.existsSync(portFile)&&fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0],'Chrome port')
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()
  ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=({data})=>{
    const message=JSON.parse(data)
    if (message.id) {
      const entry=calls.get(message.id); if (!entry) return
      calls.delete(message.id)
      if (message.error) entry.reject(Error(entry.method+': '+message.error.message))
      else entry.resolve(message.result)
    }
    if (message.method==='Page.javascriptDialogOpening') {
      const {type,message:body}=message.params
      checks.push('Dialog: '+type+' '+body)
      void send('Page.handleJavaScriptDialog',{accept:type==='confirm'&&body.includes('설정 검사')})
    }
  }
  await send('Page.enable')
  await send('DOM.enable')
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:'http://127.0.0.1:5196/#/studio/starlight?view=memo'})
  await until(()=>evalJs('!!document.querySelector("#workMemo, form input[type=email]")'),'memo or login')
  if (await evalJs('!!document.querySelector("form input[type=email]")')) {
    await replaceText('form input[type=email]','writer@storyfork.demo')
    await replaceText('form input[type=password]','sample-password')
    await click('form button[type=submit]','로그인')
  }
  await until(()=>evalJs('!!document.querySelector("#workMemo")'),'memo')
  await evalJs('document.fonts.ready.then(()=>true)')
  await evalJs('('+function () {
    const box=document.createElement('div')
    box.style.cssText='position:fixed;left:28px;bottom:24px;z-index:2147483647;pointer-events:none;background:#15132c;color:white;border:1px solid #aba4d7;border-radius:12px;padding:13px 19px;min-width:430px;box-shadow:0 6px 24px #14102b50;font-family:"Malgun Gothic",sans-serif'
    const tag=document.createElement('div')
    tag.textContent='STORYFORK  ·  이슈 #6 · PR 시연  ·  로컬 예시 데이터'
    tag.style.cssText='color:#d2c8ff;font-size:12px;margin-bottom:5px'
    const headline=document.createElement('div')
    headline.style.cssText='font-size:20px;font-weight:700'
    const detail=document.createElement('div')
    detail.style.cssText='font-size:14px;margin-top:4px;color:#eeeaff'
    box.append(tag,headline,detail)
    const cursor=document.createElement('div')
    cursor.style.cssText='position:fixed;width:22px;height:22px;border-radius:50%;border:2px solid #7c3aed;background:#a78bfa42;z-index:2147483647;pointer-events:none;display:none;transform:translate(-50%,-50%)'
    document.body.append(box,cursor)
    window.saveEvents=[]
    const saved=document.querySelector('#saved')
    new MutationObserver(()=>window.saveEvents.push(saved.textContent.trim())).observe(saved,{subtree:true,childList:true,characterData:true})
    window.caption=(title,desc)=>{headline.textContent=title;detail.textContent=desc}
    window.mark=(x,y)=>{cursor.style.left=x+'px';cursor.style.top=y+'px';cursor.style.display='block'}
  }.toString()+')()')
  await setCaption('01  콘티를 편집하면 저장 표시','콘티에 장면 메모를 입력합니다.')
  recording = true
  recorder = record()
  await sleep(2000)
  await replaceText('#workMemo','다음 장면: 리안이 탑 앞에서 카엘을 만난다.')
  await until(async()=>await status()==='저장 중…','memo saving flash',500)
  checks.push('Memo: 저장 중… visible')
  await until(async()=>await status()==='저장됨','memo saved')
  await sleep(1450)

  await click('.svw a','사전')
  await until(()=>evalJs('!!document.querySelector(".ovcov input[type=file]")'),'cover picker')
  await evalJs('document.querySelector(".ovcov").scrollIntoView({block:"nearest"})')
  await setCaption('02  표지 변경·삭제는 저장 표시 생략','예시 이미지를 선택해 미리보기를 바꿉니다.')
  await sleep(1600)
  await evalJs('window.saveEvents=[]')
  const doc=await send('DOM.getDocument')
  const picker=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.ovcov input[type=file]'})
  assert(picker.nodeId)
  await send('DOM.setFileInputFiles',{nodeId:picker.nodeId,files:[path.resolve(__dirname,'../../frontend/public/default-work-cover.svg')]})
  await until(()=>seen('.ovw button','표지 이미지 지우기'),'cover saved')
  assert.equal(await status(),'저장됨')
  checks.push('Cover upload: preview added, no saving display')
  await sleep(1650)
  await setCaption('02  표지 변경·삭제는 저장 표시 생략','미리보기 삭제 후에도 상단은 ‘저장됨’을 유지합니다.')
  await click('.ovw button','표지 이미지 지우기')
  await until(async()=>!await seen('.ovw button','표지 이미지 지우기'),'cover removed')
  assert.equal(await status(),'저장됨')
  assert(!await evalJs('window.saveEvents.some(x=>x.includes("저장 중"))'))
  checks.push('Cover removal: preview removed, no saving display')
  await sleep(1750)

  await click('.svw a','원고')
  await until(()=>evalJs('!!document.querySelector("#eb")'),'editor')
  await click('button','AI 채팅 열기')
  await until(()=>evalJs('!!document.querySelector("#aiPrompt")'),'AI prompt')
  await setCaption('03  AI 요청은 표시 없이 초안에 보존','AI에게 요청할 문구를 입력합니다.')
  await sleep(1500)
  await evalJs('window.saveEvents=[]')
  await replaceText('#aiPrompt','다음 장면을 차분한 분위기로 이어 써 주세요.')
  assert.equal(await status(),'저장됨')
  assert.match(await evalJs('document.querySelector("#aiPrompt").value'),/차분한 분위기/)
  await sleep(1300)
  await click('.svw a','콘티')
  await until(()=>evalJs('!!document.querySelector("#workMemo")'),'memo again')
  await sleep(600)
  await click('.svw a','원고')
  await until(()=>evalJs('!!document.querySelector("#aiPrompt")'),'prompt after tab switch')
  assert.match(await evalJs('document.querySelector("#aiPrompt").value'),/차분한 분위기/)
  assert(!await evalJs('window.saveEvents.some(x=>x.includes("저장 중"))'))
  checks.push('Prompt: no saving display, retained after tab switch')
  await setCaption('03  AI 요청은 표시 없이 초안에 보존','콘티 탭을 다녀와도 요청 문구가 남습니다.')
  await sleep(1850)
  await click('button','접기')

  const original='리안은 탑 앞에서 잠시 걸음을 멈췄다.'
  await setCaption('04  원문으로 되돌려도 재검사 필요','원고를 입력한 뒤 첫 설정 검사를 실행합니다.')
  await replaceText('#eb',original)
  await sleep(800)
  await runCheck()
  await sheet()
  await until(()=>seen('[role="dialog"] .chip, dialog .chip','통과'),'first check passed')
  checks.push('Initial setting check: 통과')
  await sleep(1500)
  await click('[role="dialog"] button,dialog button','취소')
  await setCaption('04  원문으로 되돌려도 재검사 필요','문장을 바꾸면 기존 검사 결과가 무효가 됩니다.')
  await replaceText('#eb','리안은 탑을 지나 숲으로 향했다.')
  await until(()=>seen('.editor [role=status]','다시 검사해 주세요'),'stale after edit')
  await sleep(1750)
  await setCaption('04  원문으로 되돌려도 재검사 필요','이전 문장을 그대로 입력해도 무효 안내가 남습니다.')
  await replaceText('#eb',original)
  assert.match(await evalJs('document.querySelector("#eb").textContent'),/탑 앞에서 잠시/)
  assert(await seen('.editor [role=status]','다시 검사해 주세요'))
  await sleep(1900)
  await sheet()
  await until(()=>seen('[role="dialog"] .chip, dialog .chip','재검사 필요'),'stale sheet')
  checks.push('Reverted body: stale in editor and publish sheet')
  await sleep(1800)
  await setCaption('05  재검사를 마치면 새 결과로 갱신','설정 검사 하기 → 통과')
  await click('[role="dialog"] button,dialog button','설정 검사 하기')
  await until(()=>evalJs('!document.querySelector("#doPub")'),'recheck completed')
  await sheet()
  await until(()=>seen('[role="dialog"] .chip, dialog .chip','통과'),'recheck passes')
  assert(!await seen('.editor [role=status]','다시 검사해 주세요'))
  checks.push('Recheck: 통과, stale cleared')
  await sleep(2550)
}
main().then(async ()=>{
  recording=false
  await recorder
  const timeline=frames.flatMap((f,i)=>["file '"+f.file+"'",'duration '+(i+1<frames.length ? Math.max(0.016,(frames[i+1].time-f.time)/1000).toFixed(3) : '0.100')])
  timeline.push("file '"+frames.at(-1).file+"'")
  fs.writeFileSync(path.join(out,'timeline.txt'),timeline.join('\n')+'\n')
  fs.writeFileSync(path.join(out,'checks.txt'),checks.join('\n')+'\n')
  console.log(JSON.stringify({out,frames:frames.length,checks}))
}).catch(async error=>{
  recording=false
  if (recorder) await recorder.catch(()=>{})
  try {
    console.error('Location:',await evalJs('location.href'))
    console.error('Page:',(await evalJs('document.body.innerText')).slice(0,1300))
    const screenshot=await send('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(out,'failure.png'),Buffer.from(screenshot.data,'base64'))
  } catch {}
  console.error(error)
  console.error(out)
  process.exitCode=1
}).finally(async ()=>{
  if(ws?.readyState===1) await Promise.race([send('Browser.close').catch(()=>{}),sleep(700)])
  ws?.close()
  browser.kill()
})

