import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import vm from 'node:vm'

import { BACKGROUND_SCRIPT, DEFAULT_LOOK, lookOf } from './appearance.ts'

const message = (color: string) => JSON.stringify({ type: 'storyfork.background', color })

describe('lookOf (웹 배경색 → 앱이 칠할 색)', () => {
  it('웹 라이트·다크 테마의 배경(--bg #F8F9FA·#121214)을 읽고 어두운지 판정한다', () => {
    assert.deepEqual(lookOf(message('rgb(248, 249, 250)')), { background: 'rgb(248, 249, 250)', dark: false })
    assert.deepEqual(lookOf(message('rgb(18, 18, 20)')), { background: 'rgb(18, 18, 20)', dark: true })
    assert.deepEqual(DEFAULT_LOOK, lookOf(message('rgb(248, 249, 250)'))) // 웹이 알려 주기 전 기본값은 웹 라이트 테마다
  })

  it('불투명한 rgba()와 공백 구분 표기도 읽고, 어두움은 밝기 기준으로 가른다', () => {
    assert.deepEqual(lookOf(message('rgba(18, 18, 20, 1)')), { background: 'rgb(18, 18, 20)', dark: true })
    assert.deepEqual(lookOf(message('rgb(251 248 241 / 100%)')), { background: 'rgb(251, 248, 241)', dark: false })
    assert.equal(lookOf(message('rgb(60, 60, 70)'))?.dark, true)
    assert.equal(lookOf(message('rgb(200, 200, 210)'))?.dark, false)
    assert.equal(lookOf(message('rgb(255, 0, 0)'))?.dark, true) // 순수한 빨강(밝기 76)은 어둡다고 본다
  })

  it('투명하거나 읽을 수 없는 색, 다른 메시지는 무시한다(앱은 이전 색을 그대로 둔다)', () => {
    for (const color of ['rgba(0, 0, 0, 0)', 'transparent', 'rgba(18, 18, 20, 0.5)', 'rgb(300, 0, 0)', 'color(srgb 0.97 0.97 0.98)', '#f8f9fa', 'red', '']) {
      assert.equal(lookOf(message(color)), null, color)
    }
    assert.equal(lookOf('not json'), null)
    assert.equal(lookOf(JSON.stringify({ type: 'storyfork.logout' })), null)
    assert.equal(lookOf(JSON.stringify({ type: 'storyfork.background' })), null)
    assert.equal(lookOf(JSON.stringify({ type: 'storyfork.notifications', userId: 'u1', items: [] })), null)
  })
})

describe('BACKGROUND_SCRIPT (WebView 안에서 body 배경색을 앱에 알린다)', () => {
  /** 웹 페이지 전역을 흉내 내 스크립트를 실행한다. 배경색은 colors[idx]이고 observe 콜백을 직접 부를 수 있다. */
  const run = (colors: string[]) => {
    const posted: string[] = []
    const observed: unknown[] = []
    let notify: () => void = () => {}
    let idx = 0
    const page: Record<string, unknown> = {
      document: { body: { name: 'body' }, documentElement: { name: 'html' } },
      getComputedStyle: () => ({ backgroundColor: colors[Math.min(idx, colors.length - 1)] }),
      MutationObserver: class {
        constructor(callback: () => void) { notify = callback }
        observe(target: unknown) { observed.push(target) }
      },
      matchMedia: () => ({ addEventListener: (_type: string, listener: () => void) => { page.osChange = listener } }),
      ReactNativeWebView: { postMessage: (data: string) => { posted.push(data) } },
    }
    page.window = page
    const result = vm.runInNewContext(BACKGROUND_SCRIPT, page)
    return { posted, observed, page, result, change: (to: number, fire = notify) => { idx = to; fire() }, get notify() { return notify } }
  }

  it('실행하자마자 현재 배경색을 보내고 끝에 true를 남긴다', () => {
    const { posted, result } = run(['rgb(248, 249, 250)'])
    assert.deepEqual(posted, [message('rgb(248, 249, 250)')])
    assert.equal(result, true)
  })

  it('테마 속성이 바뀌어 색이 달라졌을 때만 다시 보낸다(같은 색은 되풀이하지 않는다)', () => {
    const page = run(['rgb(248, 249, 250)', 'rgb(248, 249, 250)', 'rgb(18, 18, 20)'])
    page.change(1) // 다른 속성이 바뀌었지만 색은 같다
    assert.equal(page.posted.length, 1)
    page.change(2)
    assert.deepEqual(page.posted, [message('rgb(248, 249, 250)'), message('rgb(18, 18, 20)')])
  })

  it('html·body 속성(data-theme·class)과 OS 다크 모드 변경을 지켜본다', () => {
    const page = run(['rgb(248, 249, 250)', 'rgb(18, 18, 20)'])
    assert.deepEqual(page.observed, [{ name: 'html' }, { name: 'body' }])
    assert.equal(typeof page.page.osChange, 'function') // OS 다크 모드 변경 리스너가 등록됐다
    page.change(1, page.page.osChange as () => void)
    assert.equal(page.posted.length, 2)
  })
})
