import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'

import { isSameOrigin, navigateScript, navigationDecision, tapDestination } from './webview.ts'

const BASE = 'http://localhost:5173'

describe('isSameOrigin', () => {
  it('scheme·host·port가 모두 같을 때만 같은 origin이다(대소문자·경로·쿼리는 무시)', () => {
    assert.equal(isSameOrigin('http://localhost:5173/work/1?x=1#a', BASE), true)
    assert.equal(isSameOrigin('HTTP://LOCALHOST:5173/', BASE), true)
    assert.equal(isSameOrigin('http://localhost:5173', 'http://localhost:5173/app/'), true)
    assert.equal(isSameOrigin('http://localhost:5174/', BASE), false)
    assert.equal(isSameOrigin('https://localhost:5173/', BASE), false)
    assert.equal(isSameOrigin('http://127.0.0.1:5173/', BASE), false)
  })

  it('비슷하게 생긴 주소(호스트 뒤에 덧붙인 도메인·userinfo)를 같은 origin으로 보지 않는다', () => {
    assert.equal(isSameOrigin('http://localhost:5173.evil.test/', BASE), false)
    assert.equal(isSameOrigin('http://localhost:5173@evil.test/', BASE), false)
    assert.equal(isSameOrigin('//localhost:5173/', BASE), false)
    assert.equal(isSameOrigin('/work/1', BASE), false)
  })
})

describe('navigationDecision (WebView 안의 이동)', () => {
  it('같은 origin과 about:blank는 WebView에서 연다', () => {
    assert.equal(navigationDecision('http://localhost:5173/work/1', BASE), 'allow')
    assert.equal(navigationDecision('about:blank', BASE), 'allow')
  })

  it('다른 origin의 http(s)·mailto·tel은 시스템(브라우저·메일·전화)으로 보낸다', () => {
    assert.equal(navigationDecision('https://example.com/a', BASE), 'external')
    assert.equal(navigationDecision('http://localhost:5174/', BASE), 'external')
    assert.equal(navigationDecision('mailto:help@example.com', BASE), 'external')
    assert.equal(navigationDecision('tel:+8212345678', BASE), 'external')
  })

  it('그 밖의 scheme(javascript·file·data·intent·앱 scheme)은 열지 않는다', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'intent://x#Intent;end', 'storyfork://x', 'itms-apps://x']) {
      assert.equal(navigationDecision(url, BASE), 'block', url)
    }
  })
})

describe('tapDestination (알림을 눌렀을 때 WebView가 갈 주소)', () => {
  it('알림 데이터를 웹 noticeTarget 규칙의 경로로 바꿔 우리 origin 주소로 만든다', () => {
    assert.equal(tapDestination({ kind: 'creation', targetType: 'work', targetId: 'w 1' }, BASE), 'http://localhost:5173/work/w%201')
    assert.equal(tapDestination({ kind: 'credit', targetType: 'credit-expiry' }, BASE), 'http://localhost:5173/me/pay')
    assert.equal(tapDestination({ kind: 'ai-tool', targetType: 'world', targetId: 'w1' }, 'https://storyfork.example/'), 'https://storyfork.example/worldstudio/w1')
  })

  it('이동 대상이 없거나 형식이 다르면 이동하지 않는다', () => {
    assert.equal(tapDestination(undefined, BASE), null)
    assert.equal(tapDestination({ kind: 'result', targetType: null, targetId: null }, BASE), null)
    assert.equal(tapDestination({ kind: 'unknown', targetType: 'work', targetId: 'w1' }, BASE), null)
    assert.equal(tapDestination('/work/1', BASE), null)
  })
})

describe('navigateScript (탭을 눌렀을 때 웹 라우터로 이동)', () => {
  /** 웹 페이지 전역(location·history·dispatchEvent·PopStateEvent)을 흉내 내 스크립트를 실행하고 기록을 돌려준다. */
  const run = (script: string, current = { pathname: '/', search: '' }) => {
    const pushed: unknown[][] = []
    const events: string[] = []
    const page = {
      location: current,
      history: { pushState: (...args: unknown[]) => { pushed.push(args) } },
      PopStateEvent: class { type: string; constructor(type: string) { this.type = type } },
      dispatchEvent: (event: { type: string }) => { events.push(event.type) },
    }
    const result = vm.runInNewContext(script, page)
    return { pushed, events, result }
  }

  it('주소 기록에 경로를 더하고 popstate를 보내 웹 라우터가 새로고침 없이 화면을 바꾸게 한다', () => {
    const { pushed, events } = run(navigateScript('/notifications'))
    assert.deepEqual(pushed, [[null, '', '/notifications']])
    assert.deepEqual(events, ['popstate'])
  })

  it('이미 그 경로(쿼리 포함)에 있으면 아무것도 하지 않는다', () => {
    const { pushed, events } = run(navigateScript('/lib?tab=write'), { pathname: '/lib', search: '?tab=write' })
    assert.deepEqual(pushed, [])
    assert.deepEqual(events, [])
    assert.equal(run(navigateScript('/lib'), { pathname: '/lib', search: '?tab=write' }).pushed.length, 1) // 쿼리가 다르면 간다
  })

  it('경로의 따옴표·역슬래시·줄바꿈이 스크립트를 깨거나 다른 코드가 되지 않는다', () => {
    const path = '/a"b\\c\n</script>'
    assert.deepEqual(run(navigateScript(path)).pushed, [[null, '', path]])
  })

  it('끝에 true를 남긴다(react-native-webview는 마지막 식이 값이 아니면 iOS에서 조용히 실패한다)', () => {
    assert.equal(run(navigateScript('/')).result, true)
  })
})
