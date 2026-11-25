import { OperationsRejected } from './operations'

/** 한 번에 올릴 수 있는 크기(#868 계약): 500줄·2MB. 넘으면 서버가 413(또는 400)으로 막으므로 올리기 전에 먼저 알립니다. */
export const DATASET_MAX_LINES = 500
export const DATASET_MAX_BYTES = 2 * 1024 * 1024
/** 문항 목록은 한 쪽에 20개씩 읽습니다. */
export const DATASET_PAGE_SIZE = 20

/** 업로드 줄 한 개의 모양(#868): `{input, expectedOutput, metadata?}`. 문항 id는 서버가 붙입니다. */
export type DatasetLine = { input: unknown; expectedOutput: unknown; metadata?: Record<string, unknown> }
export type DatasetError = { line: number; message: string }
/** total은 빈 줄을 뺀 줄 수, lines는 검사를 통과한 줄, errors는 통과하지 못한 줄(파일의 줄 번호)입니다. */
export type DatasetParse = { total: number; lines: DatasetLine[]; errors: DatasetError[] }
/** 서버 목록의 한 행: 세트 이름·짝 프롬프트(없으면 null)·문항 수·설명(없으면 null). */
export type EvalDataset = { name: string; prompt: string | null; itemCount: number; description: string | null }
/** 서버가 돌려주는 문항(id는 서버가 붙인 값). */
export type DatasetItem = { id: string; input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }

/**
 * 올릴 수 없는 줄이 있다는 오류(서버의 400 DATASET_INVALID와 올리기 전 검사가 같은 오류): 한 줄이라도 틀리면 아무것도 올리지 않으므로(전부 아니면 무)
 * 어느 줄이 왜 틀렸는지를 줄 목록으로 들고 있습니다.
 */
export class DatasetInvalid extends OperationsRejected {
  readonly errors: DatasetError[]
  constructor(errors: DatasetError[]) {
    super(errors.length ? `형식이 맞지 않는 줄이 ${errors.length}개 있어요. 고친 뒤 다시 올려 주세요.` : '형식이 맞지 않아요. 파일을 확인한 뒤 다시 올려 주세요.')
    this.errors = errors
  }
}

export const isJsonlFile = (fileName: string) => /\.jsonl$/i.test(fileName)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * JSONL 본문을 줄마다 검사합니다(서버가 다시 검사하므로 사람이 곧바로 고칠 수 있는 입력 오류만 먼저 알립니다): 줄 하나가 JSON 객체이고 input·expectedOutput 칸이 있어야 하며
 * metadata는 있으면 JSON 객체(null은 없는 것과 같음)입니다. 빈 줄은 건너뛰고 한 줄의 문제는 첫 문제 하나만 알립니다.
 */
export function parseDatasetJsonl(text: string): DatasetParse {
  const lines: DatasetLine[] = [], errors: DatasetError[] = []
  let total = 0
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    total++
    const line = index + 1, fail = (message: string) => errors.push({ line, message })
    let value: unknown
    try { value = JSON.parse(raw) } catch { return fail('JSON으로 읽을 수 없어요.') }
    if (!isObject(value)) return fail('줄 하나가 JSON 객체여야 해요.')
    if (!('input' in value)) return fail('input이 필요해요.')
    if (!('expectedOutput' in value)) return fail('expectedOutput이 필요해요.')
    const { input, expectedOutput, metadata } = value
    if (metadata != null && !isObject(metadata)) return fail('metadata는 JSON 객체여야 해요.')
    lines.push(metadata == null ? { input, expectedOutput } : { input, expectedOutput, metadata })
  })
  return { total, lines, errors }
}

/** 크기 제한을 넘으면 그 이유(어느 쪽이 넘었는지), 안이면 null입니다. */
export function datasetLimitError(lines: number, bytes: number) {
  if (lines > DATASET_MAX_LINES) return `줄이 ${lines}개라 너무 많아요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.`
  if (bytes > DATASET_MAX_BYTES) return '파일이 2MB를 넘어요. 500줄·2MB까지 올릴 수 있으니 나눠서 올려 주세요.'
  return null
}

/** 문항 목록의 한 줄 요약: input을 공백을 접어 한 줄로 보이고 80자를 넘으면 …로 줄입니다. */
export const itemSummary = (item: Pick<DatasetItem, 'input'>) => {
  const line = (typeof item.input === 'string' ? item.input : JSON.stringify(item.input) ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 80 ? line.slice(0, 80) + '…' : line
}
