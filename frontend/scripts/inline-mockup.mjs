// 발표용 목업: dist/mockup의 JS·CSS를 index.html에 넣어 file://로 바로 여는 단일 파일(mockup/index.html)을 만듭니다.
import { readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/mockup/', import.meta.url)
let html = readFileSync(new URL('index.html', dist), 'utf8')
const read = (path) => readFileSync(new URL(path.replace(/^\.\//, ''), dist), 'utf8')

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`)
// 함수형 치환: 번들 안의 `$&` 같은 문자열이 치환 패턴으로 해석되지 않게 합니다. `</script` 는 HTML 파서가 끊지 않도록 이스케이프합니다.
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">${read(src).replaceAll('</script', '<\\/script')}</script>`)
if (/(?:src|href)="\.\/assets\//.test(html)) throw new Error('인라인하지 못한 자산이 남았습니다.')

// Windows 입력 HTML과 번들 텍스트의 줄바꿈을 배포 파일에서 통일합니다.
html = html.replace(/\r\n?/g, '\n')
writeFileSync(new URL('../mockup/index.html', import.meta.url), html)
console.log(`mockup/index.html ${(html.length / 1024).toFixed(0)}KB`)
