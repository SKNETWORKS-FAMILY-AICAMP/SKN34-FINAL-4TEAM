import { pairedPrompt } from './llmOpsEvalTable'
import { OperationsRejected } from './operations'

/** 한 번에 올릴 수 있는 크기(#868 계약): 500줄·2MB. 넘으면 서버가 413(또는 400)으로 막으므로 올리기 전에 먼저 알립니다. */
export const DATASET_MAX_LINES = 500
export const DATASET_MAX_BYTES = 2 * 1024 * 1024
/** 문항 목록은 한 쪽에 20개씩 읽습니다. */
export const DATASET_PAGE_SIZE = 20

/** 업로드 줄 한 개의 모양(#868): `{input, expectedOutput, metadata?}`. input은 객체이고 expectedOutput은 비어 있지 않아야 하며, 문항 id는 서버가 붙이므로 줄에 둘 수 없습니다. */
export type DatasetLine = { input: Record<string, unknown>; expectedOutput: unknown; metadata?: Record<string, unknown> }
export type DatasetError = { line: number; message: string }
/** total은 빈 줄을 뺀 줄 수, lines는 검사를 통과한 줄, errors는 통과하지 못한 줄(파일의 줄 번호)입니다. */
export type DatasetParse = { total: number; lines: DatasetLine[]; errors: DatasetError[] }
/** 세트 종류(#868): 평가 게이트(프롬프트의 짝 세트)·최적화 풀(optimize.<게이트 세트>)·범용(그 밖). */
export type DatasetKind = 'gate' | 'pool' | 'general'
export const DATASET_KINDS: readonly (readonly [DatasetKind, string])[] = [['gate', '평가 게이트'], ['pool', '최적화 풀'], ['general', '범용']]
export const datasetKindLabel = (kind: DatasetKind) => DATASET_KINDS.find(([key]) => key === kind)?.[1] ?? kind
export const POOL_PREFIX = 'optimize.'
export const poolOf = (gate: string) => POOL_PREFIX + gate
/**
 * 평가 게이트 세트에 문항을 올리면 그 세트의 마지막 문항이 새로 만들어져 지금까지의 기준 Run이 무효가 되고, 다음 평가가 기준 버전을 먼저 다시 평가한다(#868, 비용 발생).
 * 서버가 올린 응답의 notice로 같은 문구를 주고, 올리기 전에는 이 문구를 먼저 보인다(서버 DatasetService의 GATE_NOTICE와 같고 시험이 소스로 대조한다).
 */
export const GATE_UPLOAD_NOTICE = 'gate 세트에 올리면 다음 평가에서 기준 버전을 다시 평가해요(비용 발생)'
const isGate = (name: string) => pairedPrompt(name) !== null
/** 세트 종류를 이름으로 정합니다(서버 datasetKind와 같다): 후보 등록 게이트의 짝 세트가 gate, optimize.<게이트>가 pool, 그 밖은 general입니다(게이트가 없는 optimize.…도 general). */
export const datasetKindOf = (name: string): DatasetKind => (isGate(name) ? 'gate' : name.startsWith(POOL_PREFIX) && isGate(name.slice(POOL_PREFIX.length)) ? 'pool' : 'general')

/**
 * 서버 목록의 한 행: 세트 이름·종류·짝 프롬프트(없으면 null)·문항 수·마지막 문항 시각(없으면 null)·설명(없으면 null).
 * lastItemAt은 그 세트의 마지막 문항이 만들어진 시각(문항 시각의 최댓값)이라, 그보다 먼저 시작한 평가 Run은 마지막 문항을 보지 못한 점수라 기준이 아닙니다(평가 서비스와 같은 값).
 */
export type EvalDataset = { name: string; kind: DatasetKind; prompt: string | null; itemCount: number; lastItemAt: string | null; description: string | null }
/** 업로드 응답: 만든 문항 수, 올린 세트의 종류, 서버가 화면에 알리라는 안내(gate에 올렸을 때만, 그 밖은 null). */
export type DatasetUploadResult = { created: number; kind: DatasetKind; notice: string | null }
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
const isText = (value: unknown): value is string => typeof value === 'string'
const filled = (value: unknown): value is string => isText(value) && value.trim() !== ''
const isEmpty = (value: unknown) => value == null || (isText(value) ? !value.trim() : Array.isArray(value) ? !value.length : isObject(value) && !Object.keys(value).length)
const listOf = (fields: Record<string, (value: unknown) => boolean>) => (value: unknown) =>
  Array.isArray(value) && value.every((row) => isObject(row) && Object.entries(fields).every(([key, ok]) => ok(row[key])))
const texts = (value: unknown) => Array.isArray(value) && value.every(isText)
const flag = (value: unknown) => typeof value === 'boolean'

// 아래 규칙은 서버 DatasetRules(운영 서비스)와 문구·순서까지 같다. 서버가 AI의 채점 코드(app/evaluation/service·simulation·extraction.py)와 seed 항목에서 읽어 정한 규칙이고,
// 채점기가 거절할 문항이 한 줄이라도 들어가면 그 세트의 이후 평가가 모두 실패하기 때문에 올리기 전에 거절합니다(서버가 다시 검사하며 다르면 서버가 정본).
type Scorer = 'qa' | 'act' | 'narrate' | 'extraction' | 'geval'
/** 세트 이름으로 채점기를 고르는 평가 서비스와 같은 규칙: qa.는 Ragas, 시뮬레이션 둘과 추출 세트는 코드 채점, 그 밖은 GEval. 풀은 짝 게이트와 같다. */
const scorerOf = (set: string): Scorer => {
  const base = datasetKindOf(set) === 'pool' ? set.slice(POOL_PREFIX.length) : set
  return base.startsWith('qa.') ? 'qa' : base === 'simulation.act' ? 'act' : base === 'simulation.narrate' ? 'narrate' : base === 'extraction.extract' ? 'extraction' : 'geval'
}

const NARRATION_SETS = ['narration', 'monologue']
function inputProblem(scorer: Scorer, input: Record<string, unknown>): string | null {
  switch (scorer) {
    case 'qa':
      if (!filled(input.question)) return 'input.question이 필요해요.'
      return Array.isArray(input.contexts) && input.contexts.length > 0 && input.contexts.every(filled) ? null : 'input.contexts(글 목록)가 필요해요.'
    case 'act':
      return isObject(input.data) ? null : 'input.data(객체)가 필요해요.'
    case 'narrate':
      if (!isObject(input.data)) return 'input.data(객체)가 필요해요.'
      return NARRATION_SETS.includes(input.set as string) ? null : 'input.set은 narration 또는 monologue여야 해요.'
    case 'extraction':
      return Number.isInteger(input.number) && (input.number as number) >= 1 && isText(input.title) && isText(input.body) ? null : 'input에는 number(1 이상 정수)·title·body가 필요해요.'
    default:
      return null
  }
}

/** 추출 정답표(app/evaluation/extraction.py의 Gold)의 정해진 칸. core는 진짜 true·false입니다. */
type Mention = { name: string; kind: string; aliases: string[]; core: boolean }
type Gold = { mentions: Mention[]; statements: { document: string; core: boolean }[]; relationships: { source: string; target: string; core: boolean }[] }
const GOLD = {
  mentions: listOf({ name: isText, kind: isText, aliases: texts, core: flag }),
  statements: listOf({ kind: isText, document: isText, quote: isText, core: flag }),
  relationships: listOf({ source: isText, target: isText, label: isText, core: flag }),
}
const isGold = (value: unknown): value is Gold => isObject(value) && Object.entries(GOLD).every(([key, ok]) => ok(value[key]))
const SETTING_DOCUMENTS = ['identity', 'soul', 'goal']   // 진술이 실리는 인물 문서(memory는 줄거리라 설정이 아니다)
const MIN_OBJECT_MENTIONS = 2   // 물건은 회차 글에 이만큼 이상 나와야 설정으로 센다
/** 파이썬 str.count와 같다(채점기가 이름을 세는 방법): 겹치지 않게 앞에서부터 세고, 빈 글은 글자 수보다 한 번 더 나온다. */
const occurrences = (text: string, part: string) => (part === '' ? [...text].length + 1 : text.split(part).length - 1)

/**
 * 채점기가 recall을 정할 수 있는 정답표인가: 설정에 드는 core 정답이 하나 이상 있어야 합니다(없으면 그 항목은 채점 때 실패한다). 설정은 물건이 아니거나 본문에 이름·별칭이 두 번 이상 나온 대상,
 * identity·soul·goal 문서의 진술, 두 끝점이 모두 설정 대상이고 한쪽이 인물인 관계입니다(extraction.py의 partition과 같다).
 */
function hasSettingCore(body: string, { mentions, statements, relationships }: Gold) {
  const isSetting = ({ name, kind, aliases }: Mention) => kind !== 'object' || Math.max(...[name, ...aliases].map((word) => occurrences(body, word))) >= MIN_OBJECT_MENTIONS
  const byName = new Map(mentions.map((mention) => [mention.name, mention]))   // 같은 이름이 둘이면 뒤의 대상이다(채점기의 by_name과 같다)
  return mentions.some((mention) => mention.core && isSetting(mention)) || statements.some((statement) => statement.core && SETTING_DOCUMENTS.includes(statement.document)) ||
    relationships.some(({ source, target, core }) => {
      const ends = [byName.get(source), byName.get(target)]
      return core && ends.every((end): end is Mention => end !== undefined) && ends.every(isSetting) && ends.some((end) => end?.kind === 'character')
    })
}
const goldProblem = (body: string, gold: unknown) => (!isGold(gold) ? 'expectedOutput이 정답표(mentions·statements·relationships) 모양이 아니에요.' : hasSettingCore(body, gold) ? null : '정답표에 설정에 드는 core 정답이 하나 이상 있어야 해요.')

/** 추출은 정답표, 그 밖의 세트는 모두 글입니다. */
const expectedProblem = (scorer: Scorer, input: Record<string, unknown>, expected: unknown) =>
  scorer === 'extraction' ? goldProblem(input.body as string, expected) : isText(expected) ? null : 'expectedOutput은 글이어야 해요.'

/** 루브릭 입력(simulation.py의 _judge_inputs): 인물 글(나레이션은 빈 글), 장면 줄 {by, text}, 사실 {id, text}. */
const judgeFits = (judge: unknown) => isObject(judge) && isText(judge.character) && listOf({ by: isText, text: isText })(judge.scene) && listOf({ id: isText, text: isText })(judge.facts)
const metadataProblem = (scorer: Scorer, metadata: Record<string, unknown> | undefined) =>
  scorer === 'geval' ? (filled(metadata?.criteria) ? null : 'metadata.criteria가 필요해요.')
    : scorer === 'act' || scorer === 'narrate' ? (judgeFits(metadata?.judge) ? null : 'metadata.judge(character·scene·facts)가 필요해요.')
      : null
/** 풀을 읽는 코드가 train·val만 읽으므로 split이 있으면 그 둘이어야 합니다(없으면 서버가 정함). */
const splitProblem = (metadata: Record<string, unknown> | undefined) => {
  const split = metadata?.split
  return split == null || split === 'train' || split === 'val' ? null : 'metadata.split은 train 또는 val이어야 해요.'
}

/**
 * 줄의 첫 문제(서버 lineProblem과 같은 순서): input의 세트별 칸 → expectedOutput 있음 → expectedOutput의 모양(추출은 정답표) → metadata의 세트별 칸 → 풀의 split.
 * 올릴 세트(set)를 모르면 세트별 규칙은 보지 않고 expectedOutput이 있는지만 봅니다.
 */
function lineProblem(set: string | undefined, { input, expectedOutput, metadata }: DatasetLine) {
  const scorer = set === undefined ? null : scorerOf(set)
  return (scorer && inputProblem(scorer, input))
    || (isEmpty(expectedOutput) ? 'expectedOutput이 필요해요.' : null)
    || (scorer && expectedProblem(scorer, input, expectedOutput))
    || (scorer && metadataProblem(scorer, metadata))
    || (set !== undefined && datasetKindOf(set) === 'pool' ? splitProblem(metadata) : null)
}

const LINE_KEYS = ['input', 'expectedOutput', 'metadata']
/** 줄 하나(서버 DatasetService.line과 같은 순서): JSON 한 값(뒤에 글이 붙으면 오류) → JSON 객체 → 알 수 없는 칸(문항 id도, 오타도) → input 있음 → metadata 객체(null은 없는 것과 같음) → input 객체 → 세트별 규칙. */
function checkLine(raw: string, set: string | undefined): DatasetLine | string {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return 'JSON으로 읽을 수 없어요.' }
  if (!isObject(value)) return '줄 하나가 JSON 객체여야 해요.'
  const extra = Object.keys(value).filter((key) => !LINE_KEYS.includes(key))
  if (extra.length) return `알 수 없는 칸이 있어요: ${extra.join(', ')}`
  const { input, expectedOutput, metadata } = value
  if (input == null) return 'input이 필요해요.'
  if (metadata != null && !isObject(metadata)) return 'metadata는 JSON 객체여야 해요.'
  if (!isObject(input)) return 'input은 JSON 객체여야 해요.'
  const line: DatasetLine = { input, expectedOutput, ...(metadata == null ? {} : { metadata }) }
  return lineProblem(set, line) ?? line
}

/** 키 순서·공백이 달라도 같은 JSON이면 같은 글이 되게 객체의 키를 정렬해 만든 글(파일 안 중복 input 찾기용). */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v))

/**
 * JSONL 본문을 줄마다 검사합니다(서버가 다시 검사하고 다르면 서버가 정본). 줄 구분은 CRLF·LF·CR이고 빈 줄은 건너뛰고 세지 않으며 한 줄의 문제는 첫 문제 하나만 알립니다.
 * 올릴 세트(set)가 정해져 있으면 그 세트 종류의 필수 칸까지 봅니다. 질문 검사는 서버처럼 모든 줄의 형식이 맞은 뒤에만 합니다: 같은 input이 파일 앞 줄에 이미 있으면 뒤의 줄이 오류입니다.
 * 이미 세트에 있는 input(짝 세트 포함)과의 중복은 서버만 알아 올릴 때 줄 오류로 돌아옵니다.
 */
export function parseDatasetJsonl(text: string, set?: string): DatasetParse {
  const errors: DatasetError[] = [], checked: { line: number; item: DatasetLine }[] = []
  let total = 0
  text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((raw, index) => {
    if (!raw.trim()) return
    total++
    const result = checkLine(raw, set)
    if (typeof result === 'string') errors.push({ line: index + 1, message: result })
    else checked.push({ line: index + 1, item: result })
  })
  if (errors.length) return { total, lines: checked.map(({ item }) => item), errors }
  const first = new Map<string, number>(), lines: DatasetLine[] = []
  for (const { line, item } of checked) {
    const key = canonical(item.input), earlier = first.get(key)
    if (earlier === undefined) { first.set(key, line); lines.push(item) } else errors.push({ line, message: `파일의 ${earlier}번째 줄과 input이 같아요.` })
  }
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
