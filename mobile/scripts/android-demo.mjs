import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// 로컬 CI용 공개 fixture. 원격 Firebase·SNS에는 연결하지 않는다.
const app = 'com.storyfork.app'
const output = process.argv[2]
assert(output, '시연 결과 경로가 필요합니다.')
const recording = '/sdcard/storyfork-943.mp4'
const member = 'b832d965-0352-4eb1-b896-7a307ba09a68'
const summary = '곧 소멸되는 크레딧이 있어요'
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 15000 }).trim()
await mkdir(output, { recursive: true })

async function waitFor(label, read, timeout = 35000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try { const result = await read(); if (result) return result } catch { /* 부팅·화면 이동 중이면 다시 조회한다. */ }
    await delay(500)
  }
  throw new Error(label)
}

function tapText(pattern) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/storyfork-ui.xml')
  const xml = adb('shell', 'cat', '/sdcard/storyfork-ui.xml')
  const row = xml.match(/<node\b[^>]+>/g)?.find(node => pattern.test(node.match(/\btext="([^"]*)"/)?.[1] ?? ''))
  const bounds = [...(row?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1) ?? [])].map(Number)
  if (bounds.length !== 4) return false
  const [x1, y1, x2, y2] = bounds
  adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)))
  return true
}

async function connectWebView() {
  let targets = []
  const page = await waitFor('Android WebView의 개발 연결을 열 수 없어요.', async () => {
    const pid = adb('shell', 'pidof', app).split(' ')[0]
    if (!pid) return null
    adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`)
    targets = await (await fetch('http://127.0.0.1:9222/json/list')).json()
    return targets.find(view => view.url.startsWith('http://127.0.0.1:5173') && view.webSocketDebuggerUrl)
  }, 55000).catch(error => {
    console.error('WebView targets:', targets.map(view => view.url))
    throw error
  })
  return new WebSocket(page.webSocketDebuggerUrl)
}

let command = 0
function evaluate(socket, expression) {
  return new Promise((resolve, reject) => {
    const id = ++command
    const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('WebView 응답 시간 초과')) }, 8000)
    function receive(event) {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      clearTimeout(timeout)
      socket.removeEventListener('message', receive)
      if (message.error || message.result.exceptionDetails) reject(new Error('WebView 명령 실패'))
      else resolve(message.result.result.value)
    }
    socket.addEventListener('message', receive)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}

adb('shell', 'wm', 'size', '720x1280')
adb('shell', 'wm', 'density', '300')
adb('shell', 'input', 'keyevent', '82')
adb('reverse', 'tcp:5173', 'tcp:5173')
adb('shell', 'am', 'start', '-W', '-n', `${app}/.MainActivity`)
const socket = await connectWebView()
if (socket.readyState !== WebSocket.OPEN) {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
}
const run = expression => evaluate(socket, expression)
await run("location.assign('/notifications')")
await waitFor('로그인 폼이 표시되지 않았어요.', () => run("Boolean(document.querySelector('input[type=password]'))"))
const capture = spawn('adb', ['shell', 'screenrecord', '--time-limit', '175', recording], { stdio: 'ignore' })
const captureDone = new Promise(resolve => capture.once('close', resolve))
const stages = []

try {
  await delay(900)
  await run(`(() => {
    for (const [field, value] of [['email','writer@example.test'], ['password','StoryforkDev123!']]) {
      const input = document.querySelector('input[type=' + field + ']');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
  })()`)
  await run("document.querySelector('input[type=password]').form.requestSubmit()")
  await waitFor('로그인해야 알림함이 열립니다.', () => run("location.pathname === '/notifications' && document.body.innerText.includes('알림함')"))
    .catch(async error => {
      console.error(await run(`({ path: location.pathname, alert: document.querySelector('#login-error')?.innerText,
        auth: performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.startsWith('/api/v1/auth/'))
          .map(entry => [new URL(entry.name).pathname, entry.responseStatus]) })`))
      throw error
    })
  await waitFor('Android 알림 권한 요청이 표시되지 않았어요.', () => tapText(/^Allow$/), 14000)
  stages.push('WebView 로그인과 Android 알림 권한')
  await delay(2400)

  const published = await fetch('http://127.0.0.1:15672/api/exchanges/%2F/storyfork.events/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('storyfork:ci-mobile-broker').toString('base64') },
    body: JSON.stringify({
      properties: { content_type: 'application/json' }, routing_key: 'core.credit.expiring', payload_encoding: 'string',
      payload: JSON.stringify({
        schemaVersion: 1, eventId: randomUUID(), type: 'core.credit.expiring', occurredAt: new Date().toISOString(),
        recipientId: member, target: { type: 'credit-expiry', id: new Date().toISOString().slice(0, 10) },
      }),
    }),
  })
  assert(published.ok && (await published.json()).routed === true, 'Core에 알림 사건이 전달되지 않았어요.')
  await waitFor('SSE를 통해 알림함에 새 알림이 표시되지 않았어요.', () => run(`document.body.innerText.includes(${JSON.stringify(summary)})`))
  await delay(1600)
  adb('shell', 'cmd', 'statusbar', 'expand-notifications')
  await waitFor('Android 알림 목록에서 새 STORYFORK 알림을 찾지 못했어요.', () => tapText(/^곧 소멸되는 크레딧이 있어요$/))
  stages.push('실제 Core 사건과 SSE로 Android 로컬 알림 생성')
  await waitFor('알림을 눌러도 크레딧 화면이 열리지 않았어요.', () => run("location.pathname === '/me/pay'"))
  await delay(2500)
  stages.push('Android 알림 탭으로 기존 웹 크레딧 화면 이동')

  await run("location.assign('/notifications')")
  const noticeRow = `Array.from(document.querySelectorAll('.notice-list li')).find(row => row.innerText.includes(${JSON.stringify(summary)}))`
  await waitFor('알림이 웹 알림함에서 읽음으로 보이지 않아요.', () => run(`Boolean((${noticeRow})?.querySelector('.ibx:not(.on)'))`))
  await delay(1600)
  await run(`(${noticeRow}).querySelector('button[aria-label^="알림 삭제"]').click()`)
  await waitFor('알림 삭제가 화면에 반영되지 않았어요.', () => run(`!(${noticeRow})`))
  await delay(1700)
  stages.push('같은 웹 세션으로 읽음과 삭제 확인')
  await writeFile(`${output}/verification.json`, JSON.stringify({ stages, delivery: 'SSE → Android local notification' }, null, 2))
} finally {
  socket.close()
  try { adb('shell', 'pkill', '-INT', 'screenrecord') } catch { /* 이미 녹화 시간이 끝난 경우 */ }
  await captureDone
  adb('pull', recording, `${output}/storyfork-943-android.mp4`)
}
