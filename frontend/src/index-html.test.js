import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const demo = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const includes = (text) => expect(demo.includes(text), `missing documented demo content: ${text}`).toBe(true)

describe('STORYFORK HTML demo follows documented product flows', () => {
  it('separates free feedback from optional story-error verification and content reports', () => {
    includes('스토리 오류 검증 시뮬레이션')
    includes('유해 콘텐츠')
    includes('w.settings?.typoAuto')
    includes("type==='질문'")
    includes('유해 콘텐츠 1차 필터')
    includes('댓글·단순 오류·스토리 오류·질문·제안')
  })

  it('provides in-app notifications, required categories, and all-read behavior', () => {
    includes('#/notifications')
    includes('모두 읽음')
    includes('작가 소식')
    includes('크레딧 정책 안내')
    includes('권리·보안')
    includes('90일 보관')
  })

  it('offers documented manuscript image and EPUB flows plus illustration proposals', () => {
    includes('이미지 삽입')
    includes('.epub')
    includes('일러스트 생성')
    includes('저장·발행·내보내기에는 포함되지 않아요')
  })

  it('requires separate author confirmation before publishing autonomous drafts when enabled', () => {
    includes('data-auto="requireReview"')
    includes('일반 발행 흐름에서 공개해 주세요')
    includes('하루 최대 1회')
    includes('A.failures>=3')
    includes('A.failures=0')
    includes('유해 콘텐츠 필터·권리 확인을 연결하지 않았어요')
  })

  it('shows the documented withdrawal grace period without simulating deletion', () => {
    includes('탈퇴 후 30일 동안')
    includes('다시 로그인하면 복구')
    includes('실제 탈퇴나 데이터 변경이 일어나지 않아요')
  })

  it('does not expose emotional reaction controls on chapter pages', () => {
    expect(demo).not.toContain('data-act="react"')
    includes('data-act="like"')
  })

  it('shows scheduled operations and explicit retry controls in the admin demo', () => {
    includes('정기 작업')
    includes('data-run-job')
    includes('자동 재처리하지 않아요')
  })
})
