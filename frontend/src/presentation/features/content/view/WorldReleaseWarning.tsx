import { useId } from 'react'
import { Sheet } from '../../../shared/Sheet'

type Props = {
  known: boolean
  deletion?: { title: string; description: string }
  onPrivate: () => void
  onKeep: () => void
  onCancel: () => void
}

export function WorldReleaseWarning({ known, deletion, onPrivate, onKeep, onCancel }: Props) {
  const message = useId()
  const title = deletion?.title ?? '세계관 연결을 해제할까요?'
  const action = deletion ? '삭제' : '해제'
  const consequence = deletion ? '작품을 삭제하면 세계관 연결이 해제돼' : '연결을 해제하면'
  const warning = known
    ? `이 세계관은 공개 상태예요. ${consequence} 작가 전용이던 설정 카드까지 모든 설정이 독자에게 공개돼요.`
    : `이 세계관의 공개 여부를 확인하지 못했어요. 공개 세계관이라면 ${deletion ? '작품을 삭제할 때 세계관 연결이 해제돼' : '연결을 해제할 때'} 작가 전용이던 설정 카드까지 모든 설정이 독자에게 공개돼요.`
  return (
    <Sheet sid='U21' label={title} role='alertdialog' describedBy={deletion ? `${message}-deletion ${message}` : message} onClose={onCancel}>
      <h3 className='wrap-anywhere'>{title}</h3>
      {deletion && <p id={`${message}-deletion`}>{deletion.description}</p>}
      <p id={message}>{warning}</p>
      <div className='rowend'>
        {known && <button type='button' className='btn pri' data-autofocus='' onClick={onPrivate}>세계관을 비공개로 바꾸고 {action}</button>}
        <button type='button' className='btn' onClick={onKeep}>공개 그대로 {action}</button>
        <button type='button' className='btn' data-autofocus={known ? undefined : ''} onClick={onCancel}>취소</button>
      </div>
    </Sheet>
  )
}
