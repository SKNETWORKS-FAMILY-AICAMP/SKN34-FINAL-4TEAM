import { OperationsRejected } from './operations'

/** 한 번에 올릴 수 있는 크기(#868 계약): 500줄·2MB. 넘으면 서버가 413(또는 400)으로 막으므로 올리기 전에 먼저 알립니다. */
export const DATASET_MAX_LINES = 500
export const DATASET_MAX_BYTES = 2 * 1024 * 1024
/** 문항 목록은 한 쪽에 20개씩 읽습니다. */
export const DATASET_PAGE_SIZE = 20

/** 업로드 줄 한 개의 모양(#868 정확 구현 계약): `{input, expectedOutput, metadata?}`. input은 객체이고 expectedOutput은 비어 있지 않아야 하며, 문항 id는 서버가 붙이므로 줄에 둘 수 없습니다. */
export type DatasetLine = { input: Record<string, unknown>; expectedOutput: unknown; metadata?: Record<string, unknown> }
export type DatasetError = { line: number; message: string }
/** total은 빈 줄을 뺀 줄 수, lines는 검사를 통과한 줄, errors는 통과하지 못한 줄(파일의 줄 번호)입니다. */
export type DatasetParse = { total: number; lines: DatasetLine[]; errors: DatasetError[] }
/** 세트 종류(#868 정확 구현 계약 1): 평가 게이트(프롬프트의 짝 세트)·최적화 풀(optimize.<게이트 세트>)·범용(그 밖). */
export type DatasetKind = 'gate' | 'pool' | 'general'
export const DATASET_KINDS: readonly (readonly [DatasetKind, string])[] = [['gate', '평가 게이트'], ['pool', '최적화 풀'], ['general', '범용']]
export const datasetKindLabel = (kind: DatasetKind) => DATASET_KINDS.find(([key]) => key === kind)?.[1] ?? kind
export const POOL_PREFIX = 'optimize.'
/** 평가 게이트 세트(후보 등록 게이트의 짝)에 문항을 올리면 그 세트의 점수 기준이 바뀌어 기준 Run을 다시 만든다(#868 정확 구현 계약 6·8). */
export const GATE_UPLOAD_NOTICE = '평가 게이트 세트에 올리면 다음 평가에서 기준 버전을 다시 평가해요(비용 발생).'
export const poolOf = (gate: string) => POOL_PREFIX + gate
/** 서버가 종류를 주지 않은 응답(계약 1의 정의 그대로): 짝 프롬프트가 있으면 게이트, optimize.로 시작하면 풀, 그 밖은 범용입니다. */
export const datasetKindOf = ({ name, prompt }: { name: string; prompt: string | null }): DatasetKind => (prompt ? 'gate' : name.startsWith(POOL_PREFIX) ? 'pool' : 'general')

/** 서버 목록의 한 행: 세트 이름·종류·짝 프롬프트(없으면 null)·문항 수·설명(없으면 null). */
export type EvalDataset = { name: string; kind: DatasetKind; prompt: string | null; itemCount: number; description: string | null }
/** 서버가 돌려주는 문항: id는 서버가 붙인 값이고 나머지는 Langfuse에 저장된 JSON 그대로(없으면 null)입니다. */
export type DatasetItem = { id: string; input?: unknown; expectedOutput?: unknown; metadata?: unknown }

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

/**
 * 파일 바이트를 UTF-8 글자로 읽습니다(맨 앞 BOM은 버림). UTF-8이 아니면 null입니다: 서버도 UTF-8만 받고,
 * 느슨하게 읽어(깨진 글자 �로 바꿔) 보내면 평가 데이터에 깨진 글자가 저장되기 때문입니다.
 */
export function decodeUtf8(bytes: BufferSource): string | null {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const LINE_KEYS = ['input', 'expectedOutput', 'metadata']

const isText = (value: unknown): value is string => typeof value === 'string'
const filled = (value: unknown): value is string => isText(value) && value.trim() !== ''
const isEmpty = (value: unknown) => value == null || (isText(value) ? !value.trim() : Array.isArray(value) ? !value.length : isObject(value) && !Object.keys(value).length)
const listOf = (fields: Record<string, (value: unknown) => boolean>) => (value: unknown) =>
  Array.isArray(value) && value.every((row) => isObject(row) && Object.entries(fields).every(([key, ok]) => ok(row[key])))
const texts = (value: unknown) => Array.isArray(value) && value.every(isText)
const flag = (value: unknown) => typeof value === 'boolean'
/** 추출 정답표(app/evaluation/extraction.py의 Gold)의 정해진 칸. */
const GOLD = {
  mentions: listOf({ name: isText, kind: isText, aliases: texts, core: flag }),
  statements: listOf({ kind: isText, document: isText, quote: isText, core: flag }),
  relationships: listOf({ source: isText, target: isText, label: isText, core: flag }),
}

type Item = { input: Record<string, unknown>; expectedOutput: unknown; metadata?: Record<string, unknown> }

// 세트 종류별 필수 칸(#868 정확 구현 계약 3): 회귀 평가의 채점 코드(app/evaluation/service·simulation·extraction.py)가 읽는 칸 그대로입니다. 어긋나면 채점 때 그 문항이 실패합니다.
const simulation = (kind: 'act' | 'narrate') => ({ input, expectedOutput, metadata }: Item) => {
  if (!isObject(input.data)) return 'input.data(객체)가 필요해요.'
  if (kind === 'narrate' && input.set !== 'narration' && input.set !== 'monologue') return 'input.set은 narration 또는 monologue여야 해요.'
  if (!filled(expectedOutput)) return 'expectedOutput은 비어 있지 않은 글이어야 해요.'
  const judge = metadata?.judge
  if (!isObject(judge)) return 'metadata.judge(character·scene·facts)가 필요해요.'
  if (!isText(judge.character)) return 'metadata.judge.character는 글이어야 해요.'
  if (!listOf({ by: isText, text: isText })(judge.scene)) return 'metadata.judge.scene은 {by, text}(글) 목록이어야 해요.'
  if (!listOf({ id: isText, text: isText })(judge.facts)) return 'metadata.judge.facts는 {id, text}(글) 목록이어야 해요.'
  return null
}
const extraction = ({ input, expectedOutput }: Item) => {
  if (!(Number.isInteger(input.number) && (input.number as number) >= 1 && isText(input.title) && isText(input.body))) return 'input에는 number(1 이상 정수)·title·body(글)가 필요해요.'
  const gold = isObject(expectedOutput) && Object.entries(GOLD).every(([key, ok]) => ok(expectedOutput[key])) ? expectedOutput : null
  const core = gold && Object.keys(GOLD).some((key) => (gold[key] as { core: boolean }[]).some((row) => row.core))
  return core ? null : 'expectedOutput은 정답표({mentions, statements, relationships} 목록의 정해진 칸, core 정답 하나 이상)여야 해요.'
}
const qa = ({ input }: Item) => (filled(input.question) && Array.isArray(input.contexts) && input.contexts.length > 0 && input.contexts.every(filled) ? null : 'input에는 question(글)과 contexts(글 목록)가 필요해요.')
const general = ({ metadata }: Item) => (filled(metadata?.criteria) ? null : 'metadata.criteria(글)가 필요해요.')

/** 세트 이름으로 채점 방식을 가르는 AI(app/evaluation/service.py)와 같은 규칙입니다: qa. → Ragas, simulation.act·narrate, extraction.extract, 그 밖은 GEval(metadata.criteria). */
const checkFor = (name: string) => (name.startsWith('qa.') ? qa : name === 'simulation.act' ? simulation('act') : name === 'simulation.narrate' ? simulation('narrate') : name === 'extraction.extract' ? extraction : general)

/** 세트에 올릴 수 없는 이유(없으면 null). 최적화 풀(optimize.<게이트>)은 그 게이트와 같은 모양이고, 풀을 읽는 코드가 train·val만 읽으므로 metadata.split이 있으면 그 둘이어야 합니다(없으면 서버가 정함). */
function itemProblem(set: string, item: Item) {
  const pool = set.startsWith(POOL_PREFIX)
  const problem = checkFor(pool ? set.slice(POOL_PREFIX.length) : set)(item)
  const split = item.metadata?.split
  return problem ?? (pool && split != null && split !== 'train' && split !== 'val' ? 'metadata.split은 train 또는 val이어야 해요.' : null)
}

/** 키 순서·공백이 달라도 같은 JSON이면 같은 글이 되게 객체의 키를 정렬해 만든 글(파일 안 중복 input 찾기용). */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))

/**
 * JSONL 본문을 줄마다 검사합니다(서버가 다시 검사하고 다르면 서버가 정본): JSON 한 값(뒤에 글이 붙으면 오류) → JSON 객체 → input·expectedOutput·metadata 밖의 칸은 오류(문항 id도, 오타도) →
 * input 필수·객체 → expectedOutput 필수(null·빈 값 불가) → metadata는 있으면 JSON 객체(null은 없는 것과 같음) → 올릴 세트(set)가 정해져 있으면 그 세트 종류의 필수 칸 → 파일 안에서 같은 input이면 뒤의 줄 오류.
 * 줄 구분은 CRLF·LF·CR, 빈 줄은 건너뛰고 세지 않으며, 한 줄의 문제는 첫 문제 하나만 알립니다. 이미 세트에 있는 input(짝 세트 포함)과의 중복은 서버만 압니다.
 */
export function parseDatasetJsonl(text: string, set?: string): DatasetParse {
  const lines: DatasetLine[] = [], errors: DatasetError[] = [], seen = new Map<string, number>()
  let total = 0
  text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    total++
    const line = index + 1, fail = (message: string) => errors.push({ line, message })
    let value: unknown
    try { value = JSON.parse(raw) } catch { return fail('JSON으로 읽을 수 없어요.') }
    if (!isObject(value)) return fail('줄 하나가 JSON 객체여야 해요.')
    const extra = Object.keys(value).filter((key) => !LINE_KEYS.includes(key))
    if (extra.length) return fail(`알 수 없는 칸이 있어요: ${extra.join(', ')}`)
    const { input, expectedOutput, metadata } = value
    if (input == null) return fail('input이 필요해요.')
    if (!isObject(input)) return fail('input은 JSON 객체여야 해요.')
    if (isEmpty(expectedOutput)) return fail('expectedOutput이 필요해요.')
    if (metadata != null && !isObject(metadata)) return fail('metadata는 JSON 객체여야 해요.')
    const item = { input, expectedOutput, ...(metadata == null ? {} : { metadata }) }
    const problem = set === undefined ? null : itemProblem(set, item)
    if (problem) return fail(problem)
    const key = canonical(input), first = seen.get(key)
    if (first !== undefined) return fail(`같은 input이 ${first}번째 줄에 이미 있어요.`)
    seen.set(key, line)
    lines.push(item)
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
