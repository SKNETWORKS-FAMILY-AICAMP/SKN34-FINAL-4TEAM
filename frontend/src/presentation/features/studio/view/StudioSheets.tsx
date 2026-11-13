import { toast } from '../../../shared/events'
import { Sheet } from '../../../shared/Sheet'

type Field = { name: string; label: string; req?: boolean; opts?: [string, string][]; value?: string; checks?: string[] }

/** 목업 formSheet(title, fields, onOk): 사전·보드의 짧은 입력 시트. 필수 항목이 비면 토스트만 띄웁니다. */
export function FormSheet({ title, fields, onOk, onClose, ok = '추가' }: { title: string; fields: Field[]; onOk: (o: Record<string, string>, fd: FormData) => void; onClose: () => void; ok?: string }) {
  return (
    <Sheet sid="U38" label={title} onClose={onClose}>
      <div className="sh-h"><h3>{title}</h3><button type="button" className="x" aria-label="닫기" onClick={onClose}>✕</button></div>
      <form id="fsf" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        const o = Object.fromEntries(fields.map((f) => [f.name, String(fd.get(f.name) ?? '').trim()]))
        if (fields.some((f) => f.req && !o[f.name])) return toast('필수 항목을 입력해 주세요')
        onClose()
        onOk(o, fd)
      }}>
        {fields.map((f, i) => f.checks ? <div className="field" key={f.name}>{f.label}<div className="pick2">{f.checks.map((c) => <label className="ckp" key={c}><input type="checkbox" name={f.name} value={c} /> {c}</label>)}</div></div> : <label className="field" key={f.name}>{f.label}{f.opts
          ? <select className="inp" name={f.name} defaultValue={f.value} data-autofocus={i === 0 || undefined}>{f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : <input className="inp" name={f.name} defaultValue={f.value} maxLength={40} required={f.req} data-autofocus={i === 0 || undefined} />}</label>)}
        <div className="rowend"><button className="btn" type="button" onClick={onClose}>취소</button><button className="btn pri" type="submit">{ok}</button></div>
      </form>
    </Sheet>
  )
}
