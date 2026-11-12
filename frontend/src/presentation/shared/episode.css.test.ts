import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./episode.css', import.meta.url), 'utf8')
const sizes = (re: RegExp) => [...css.matchAll(re)].map((m) => Number(m[1]))

describe('episode.css 접근성 계약', () => {
  it('글자 크기는 모두 12px 이상이고 font-size:0으로 숨기지 않는다', () => {
    // font 축약형은 `font:11px var(--mono)`·`font:700 26px var(--story)`처럼 크기 앞에 굵기가 올 수 있다.
    const small = [...sizes(/font-size:\s*([\d.]+)px/g), ...sizes(/font:\s*(?:[\w-]+\s+)*?([\d.]+)px/g)].filter((px) => px < 12)
    expect(small).toEqual([])
    expect(css).not.toMatch(/font-size:\s*0(?![\d.])/)
  })

  it('오류 안내 색은 --danger 토큰에서 만들어 고른 테마와 OS 테마를 함께 따른다 (light-dark()와 색 리터럴을 쓰지 않는다)', () => {
    const alert = css.match(/\.ep-alert\{([^}]*)\}/)?.[1] ?? ''
    for (const prop of ['background', 'color', 'border']) expect(alert, prop).toMatch(new RegExp(`${prop}:[^;]*var\\(--danger\\)`))
    // light-dark()는 storyfork.css 머리말이 쓰지 않기로 한 함수다(옛 브라우저에서 선언이 통째로 버려져 알림 상자의 면·테두리가 사라진다).
    expect(css).not.toMatch(/light-dark\(/)
    expect(alert).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('입력 칸 경계는 3:1 이상인 --line3를 쓰고, 터치 기기에서는 입력 글자를 16px로 올려 iOS 확대를 막는다', () => {
    const fields = css.match(/\.episode-app input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.episode-app textarea,\.episode-app select\{([^}]*)\}/)?.[1] ?? ''
    expect(fields).toMatch(/border:1px solid var\(--line3\)/)
    const coarse = css.match(/@media\(pointer:coarse\)\{([^@]*)\}\s*$/m)?.[1] ?? ''
    expect(coarse).toMatch(/\.episode-app input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\.episode-app textarea,\.episode-app select,[^{]*\{font-size:16px\}/)
    // 큰 제목 입력(28px)은 그대로 둔다.
    expect(coarse).not.toMatch(/ep-create-title/)
  })

  it('전용 상단 헤더 규칙(.ep-header·.ep-brand·.ep-top-*·.ep-dot)과 전용 푸터(.ep-footer)를 남기지 않는다 — 상단과 하단은 공용 Gnb·Footer다', () => {
    expect(css).not.toMatch(/\.ep-(header|brand|top-meta|top-label|dot|footer)\b/)
  })
})

describe('episode.css 작품 관리 히어로 계약', () => {
  it('소설 상세(.whero)가 읽는 --t* 토큰을 이 화면의 전역 토큰에 연결해 라이트·다크가 함께 바뀐다', () => {
    const tokens = css.match(/\.episode-app\{(--tbg:[^}]*)\}/)?.[1] ?? ''
    for (const token of ['--tbg', '--tfg', '--tsub', '--tacc', '--tline', '--tcard', '--tfont', '--tbtn', '--tbtnfg']) {
      expect(tokens, token).toMatch(new RegExp(`${token}:var\\(--`))
    }
  })

  it('히어로는 표지 칸을 고정하고 900px 이하에서는 표지와 정보를 한 열로 쌓는다', () => {
    expect(css).toMatch(/\.episode-app \.ep-hero\{[^}]*grid-template-columns:240px minmax\(0,1fr\)/)
    expect(css).toMatch(/@media\(max-width:900px\)\{[^@]*\.episode-app \.ep-hero\{[^}]*grid-template-columns:1fr/)
  })

  it('옛 작품 헤더(.ep-work-header) 규칙을 남기지 않는다', () => {
    expect(css).not.toContain('ep-work-header')
  })

  it('집필실로 넘긴 원고 작성·AI 이어쓰기·회차 공개 카드의 규칙을 남기지 않는다', () => {
    expect(css).not.toMatch(/\.ep-(writing|editor|ai|publish|proposal|preview|title-label|body-label)\b/)
  })

  it('사이드바를 없애고 본문은 소설 상세 페이지와 같은 최대 폭으로 가운데에 둔다', () => {
    expect(css).not.toMatch(/\.ep-(shell|sidebar|side-title|side-note|new|work|book)\b/)
    expect(css).toMatch(/\.ep-main\{[^}]*max-width:1120px[^}]*margin:0 auto/)
  })

  it('히어로 제목 줄의 편집 버튼은 줄어들지 않고, 글자 단위 줄바꿈(anywhere)이 버튼 최소 폭을 글자 하나로 만들지 않는다', () => {
    // overflow-wrap:anywhere는 flex 항목의 최소 폭 계산에 반영돼 '편집' 버튼이 '편…'으로 잘렸다.
    expect(css).toMatch(/\.ep-title-row \.btn\{[^}]*flex:none/)
    expect(css).not.toMatch(/\.ep-hero-main\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.ep-title-row h1\{[^}]*overflow-wrap:\s*anywhere/)
  })
})

describe('episode.css 작품 관리 화면 정리 계약', () => {
  it('뒤로 가기는 알약 버튼이 아니라 테두리·배경 없는 글자 링크다', () => {
    const rule = css.match(/\.ep-back\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*none/)
    expect(rule).toMatch(/border:\s*0/)
    expect(rule).not.toMatch(/border-radius:\s*999px/)
  })

  it('회차 목록 탭은 탭 바와 같은 열에 왼쪽 정렬하고, 상속 회차 칩도 좁은 화면에서 제목 열 아래로 내린다', () => {
    expect(css).not.toMatch(/\.ep-episodes\{[^}]*(margin:\s*0 auto|max-width)/)
    expect(css).toMatch(/\.ep-list-foot\{[^}]*justify-content:\s*flex-start/)
    expect(css).toMatch(/@media\(max-width:650px\)\{[^@]*\.ep-list \.ep :is\(\.btn,\.chip\)\{[^}]*grid-column:\s*2/)
  })

  it('파일 선택은 기본 입력을 시각적으로만 숨기고(포커스·스크린리더는 유지) 라벨 버튼에 포커스 링을 그린다', () => {
    const input = css.match(/\.ep-file-pick input\[type=file\]\{([^}]*)\}/)?.[1] ?? ''
    expect(input).toMatch(/position:\s*absolute/)
    expect(input).toMatch(/opacity:\s*0/)
    expect(input).not.toMatch(/display:\s*none|visibility:\s*hidden/)
    expect(css).toMatch(/\.ep-file-pick:has\(input:focus-visible\)\{[^}]*outline:/)
  })

  it('포크 삭제는 채운 빨간 버튼이 아니라 외곽선 버튼이고 동작 줄의 오른쪽 끝에 놓인다', () => {
    const rule = css.match(/\.ep-danger\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/background:\s*transparent/)
    expect(rule).toMatch(/color:\s*var\(--danger\)/)
    expect(rule).toMatch(/margin-left:\s*auto/)
  })

  it('설정집 편집 UI를 뺀 뒤 쓰지 않는 규칙(.ep-world*·.ep-setting-row)을 남기지 않는다', () => {
    expect(css).not.toMatch(/\.ep-world\b|\.ep-setting-row\b/)
  })
})
