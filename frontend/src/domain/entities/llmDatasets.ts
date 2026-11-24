import { z } from 'zod'

const ID = 'id는 비어 있지 않은 글자여야 해요.'
/**
 * 평가 데이터셋 문항 한 줄의 모양(#857): 서버 시드(`backend/ai-service/app/evaluation/seed.py`)가 읽는 `{id, input, expectedOutput?, metadata}` 그대로입니다.
 * id가 Langfuse 항목의 고정 id라 같은 id를 다시 올리면 덮어씁니다. 알 수 없는 칸(`expected_output` 같은 오타)은 조용히 버리지 않고 오류로 알립니다.
 * 업로드 파일은 외부 입력이라 Zod로 검사하며, 이 검사는 Data·Presentation·React를 import하지 않는 순수 규칙이라 domain에 둡니다.
 */
const ITEM = z.strictObject({
  id: z.string({ error: ID }).min(1, { error: ID }),
  input: z.unknown().refine((value) => value !== undefined && value !== null, { error: 'input이 필요해요.' }),
  expectedOutput: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown(), { error: 'metadata는 JSON 객체여야 해요.' }),
}, { error: '줄 하나가 JSON 객체여야 해요.' })

export type DatasetItem = z.infer<typeof ITEM>
export type DatasetError = { line: number; message: string }
/** total은 빈 줄을 뺀 줄 수, items는 검사를 통과한 문항, errors는 통과하지 못한 줄(파일의 줄 번호)입니다. */
export type DatasetParse = { total: number; items: DatasetItem[]; errors: DatasetError[] }
/** 평가 데이터셋 목록의 한 행: 세트 이름·짝 프롬프트(없으면 null)·문항 수·출처. */
export type EvalDataset = { name: string; prompt: string | null; items: number; source: string }

export const isJsonlFile = (fileName: string) => /\.jsonl$/i.test(fileName)

/** JSONL 본문을 줄마다 검사합니다. 빈 줄은 건너뛰고 한 줄의 문제는 첫 문제 하나만 알리며, 같은 id가 다시 나오면 뒤쪽 줄을 오류로 하고 처음 것만 남깁니다. */
export function parseDatasetJsonl(text: string): DatasetParse {
  const items: DatasetItem[] = [], errors: DatasetError[] = [], firstLine = new Map<string, number>()
  let total = 0
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    total++
    const line = index + 1, fail = (message: string) => errors.push({ line, message })
    let value: unknown
    try { value = JSON.parse(raw) } catch { return fail('JSON으로 읽을 수 없어요.') }
    const parsed = ITEM.safeParse(value)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return fail(issue.code === 'unrecognized_keys' ? `알 수 없는 칸이 있어요: ${issue.keys.join(', ')}` : issue.message)
    }
    const same = firstLine.get(parsed.data.id)
    if (same) return fail(`id가 ${same}번째 줄과 같아요.`)
    firstLine.set(parsed.data.id, line)
    items.push(parsed.data)
  })
  return { total, items, errors }
}

/** 문항 목록의 한 줄 요약: input을 공백을 접어 한 줄로 보이고 80자를 넘으면 …로 줄입니다. */
export const itemSummary = (item: DatasetItem) => {
  const line = (typeof item.input === 'string' ? item.input : JSON.stringify(item.input)).replace(/\s+/g, ' ').trim()
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}
