import { promptLabel } from '../../../../domain/entities/promptNames'

/** 프롬프트 이름 표시(#857): 한국어 표시 이름이 주이고 코드는 작은 보조 글씨입니다. 표에 없는 코드(옛 이름·데모 이름)는 코드 하나만 보입니다. */
export function PromptName({ code }: { code: string }) {
  const label = promptLabel(code)
  return <>{label}{label !== code && <>{' '}<small className="prompt-code">{code}</small></>}</>
}
