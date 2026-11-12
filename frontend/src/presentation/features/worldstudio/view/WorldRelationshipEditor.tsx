import CharacterCards from './CharacterCards'
import { buildSettingRelationshipMap } from '../viewmodel/characterMap'
import { pickRelationNode } from '../viewmodel/relationPick'
import { useWorldMapViewModel } from '../viewmodel/useWorldMapViewModel'
import './world-map.css'
import { cardTypeOf, cardTypes } from '../../../../domain/entities/studioCards'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CardDeletionConfirm } from './CardDeletionConfirm'
import { RelationPairEditor } from './RelationPairEditor'
import { relationLabel } from '../../../../domain/entities/studioRelations'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
type VM = ReturnType<typeof useWorldStudioViewModel>

/** 범례의 선 모양: 실선(구조 관계), 점선(감정), 화살표(방향이 있는 관계). 색은 그래프 간선과 같은 토큰이다. */
const LineKey = ({ tone, dashed, arrow }: { tone: 'edge' | 'emotion'; dashed?: boolean; arrow?: boolean }) => (
  <svg className={'relationship-key ' + tone} viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
    <line x1="1" y1="5" x2={arrow ? 21 : 27} y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '4 3' : undefined} />
    {arrow && <path d="M21 1.5 27 5 21 8.5z" fill="currentColor" />}
  </svg>
)

/**
 * 관계 연결 단계. 왼쪽은 공개 인물관계도와 같은 어두운 면 위의 인물·설정 카드 그래프(범례·관계 라벨)이고, 카드를 차례로 두 번 누르면 오른쪽 '관계 추가' 폼의
 * 주체·대상이 채워지며 관계 작성이 열린다(`pickRelationNode`). 오른쪽에는 관계 추가 폼, 열린 관계 작성 패널, 관계 목록 표(편집·삭제)가 있다.
 * 관계는 기존 초안·적용 흐름 그대로 '편집본에 적용'으로 반영하고 세계관 저장으로 서버에 저장한다.
 */
export function WorldRelationshipEditor({ studio }: { studio: VM }) {
  const map = useWorldMapViewModel(studio.editing!.settings, buildSettingRelationshipMap)
  const [choosing, setChoosing] = useState(false)
  const section = useRef<HTMLElement>(null), cancelConnect = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef('')
  useEffect(() => {
    if (choosing) cancelConnect.current?.focus()
    else if (returnFocus.current) {
      section.current?.querySelector<HTMLButtonElement>(`[data-id="${returnFocus.current}"] button[aria-label$="관계 연결"]`)?.focus()
      returnFocus.current = ''
    }
  }, [choosing])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const people = studio.editing!.settings.filter((s) =>
    cardTypes.some((type) => type.id === cardTypeOf(s.item))
  )
  const [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [open, setOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null)
  const handledRequest = useRef(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const validDeletion = !!deleteConfirm && people.some((s) =>
    s.item.id === deleteConfirm && s.item.kind === 'entity' && s.item.entityType === 'character'
  )
  const deletion = deleteConfirm && validDeletion ? studio.cardDeletionInfo(deleteConfirm) : null
  useEffect(() => { if (deleteConfirm && !validDeletion) setDeleteConfirm(null) }, [deleteConfirm, validDeletion])
  const selectPair = useCallback((nextSource: string, nextTarget: string, nextOpen: boolean) => {
    // 열린 패널과 같은 두 인물(방향 무관)을 다시 고르면 작성 중인 초안을 그대로 둔다.
    if (open && nextOpen && nextSource === target && nextTarget === source) return true
    if (open && (nextSource !== source || nextTarget !== target) && !studio.confirmRelationDiscard()) return false
    setSource(nextSource)
    setTarget(nextTarget)
    setOpen(nextOpen)
    setChoosing(false)
    map.select(nextSource || null)
    return true
  }, [open, source, target, studio])
  useEffect(() => {
    const request = studio.relationRequest
    if (!request || request.seq === handledRequest.current) return
    handledRequest.current = request.seq
    const item = studio.editing?.settings.find((row) => row.item.id === request.id && row.item.kind === 'relation')?.item
    if (!item?.subjectId || !item.targetId) return
    const samePair = open && (item.subjectId === source && item.targetId === target || item.subjectId === target && item.targetId === source)
    if (samePair || selectPair(item.subjectId, item.targetId, true)) setFocusRequest(request)
  }, [studio.relationRequest, studio.editing?.settings, open, source, target, selectPair])
  const stopChoosing = () => { returnFocus.current = source; setChoosing(false) }
  // 그래프의 카드 본문을 누를 때: 첫 번째는 주체, 두 번째는 대상(폼이 채워지고 관계 작성이 열린다). 열린 초안은 selectPair가 확인을 거친다.
  const pick = (id: string) => {
    const next = pickRelationNode({ source, choosing }, id)
    if (selectPair(next.source, next.target, next.open)) setChoosing(next.choosing)
  }
  // 목록에서 지우는 것도 '편집본에 적용'과 같은 경로(applyRelations)다. 저장 전까지는 서버에 닿지 않는다. 열린 초안이 있으면 버릴지 먼저 묻고 패널을 닫는다.
  const removeRelation = (id: string, label: string) => {
    if (open && !studio.confirmRelationDiscard()) return
    if (!window.confirm(`${label} 관계를 삭제할까요? 세계관을 저장해야 반영돼요.`)) return
    if (studio.applyRelations([], [id])) { setOpen(false); setChoosing(false) }
  }
  const relations = studio.editing!.settings.filter((s) => s.item.kind === 'relation')
  const name = (id: string | null) =>
    people.find((s) => s.item.id === id)?.item.title || '선택 안 함'
  return (
    <section ref={section} className='world-map relationship-editor' aria-label='관계 편집' onKeyDown={(e) => { if (choosing && e.key === 'Escape') stopChoosing() }}>
      <p className='small muted'>구조적 관계와 방향별 감정을 따로 작성합니다.</p>
      <fieldset className='world-fields' disabled={studio.busy}>
        <legend className='sr-only'>관계 대상 선택</legend>
        <div className='relationship-service-layout'>
          <div className='relationship-stage'>
            <div className='relationship-toolbar'>
              <h4>인물관계도</h4>
              <button className='btn pri sm' type='button' onClick={()=>{if(!studio.confirmRelationDiscard())return;const id=studio.addCard('character');if(id)studio.editCard(id)}}>인물 추가</button>
              <button className='btn sm' type='button' onClick={()=>setLayoutVersion(v=>v+1)}>배치 정돈</button>
            </div>
            <div className='relationship-hint' role='status'>{choosing?<>{name(source)}의 연결 상대를 고르세요.<button ref={cancelConnect} className='btn sm' type='button' onClick={stopChoosing}>연결 취소</button></>:'카드를 차례로 두 번 누르면 관계를 이을 수 있어요. 실선은 구조 관계, 점선은 감정이에요. 위치는 저장되지 않아요.'}</div>
            <CharacterCards key={layoutVersion} vm={map} editing={{busy:studio.busy,selectedRelations:open?studio.editing!.settings.filter(s=>s.item.kind==='relation'&&((s.item.subjectId===source&&s.item.targetId===target)||(s.item.subjectId===target&&s.item.targetId===source))).map(s=>s.item.id):[],targetSource:choosing?source:null,onPick:pick,onSelect:id=>{if(choosing){selectPair(source,id,true)}else if(studio.confirmRelationDiscard()){studio.editCard(id)}},onConnect:id=>{if(selectPair(id,'',false))setChoosing(true)},onRelation:id=>studio.editRelation(id)}}/>
            <ul className='relationship-legend' aria-label='범례'>
              <li><LineKey tone='edge' />구조 관계</li>
              <li><LineKey tone='emotion' dashed />감정(방향별)</li>
              <li><LineKey tone='edge' arrow />방향이 있는 관계</li>
            </ul>
          </div>
          <div className='relationship-service-form'>
            <section className='relationship-add' aria-label='관계 추가'>
              <h4>관계 추가</h4>
              <p className='small muted'>그래프에서 카드를 차례로 두 번 누르거나, 아래에서 두 설정을 고르세요.</p>
              <div className='world-form-row'>
                <label className='field'>
                  관계 주체<select
                    className='inp'
                    value={source}
                    onChange={(e) => selectPair(e.target.value, target, false)}
                  >
                    <option value=''>선택하세요</option>
                    {people.map((s) => (
                      <option key={s.item.id} value={s.item.id}>
                        {s.item.title || '이름 없는 설정'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='field'>
                  관계 대상<select
                    className='inp'
                    value={target}
                    onChange={(e) => selectPair(source, e.target.value, false)}
                  >
                    <option value=''>선택하세요</option>
                    {people.map((s) => (
                      <option key={s.item.id} value={s.item.id}>
                        {s.item.title || '이름 없는 설정'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className='relationship-actions'>
                <button
                  className='btn pri'
                  type='button'
                  disabled={!source || !target || source === target}
                  onClick={() => setOpen(true)}
                >
                  관계 작성
                </button>
                <button
                  className='btn'
                  type='button'
                  disabled={!people.some((s) =>
                    s.item.id === source && s.item.entityType === 'character'
                  )}
                  onClick={() => setDeleteConfirm(source)}
                >
                  선택한 인물 삭제
                </button>
                {studio.deletedCard?.person && (
                  <button
                    className='btn'
                    type='button'
                    onClick={() => {
                      if (open && !studio.confirmRelationDiscard()) return
                      const id = studio.undoCardDeletion()
                      if (id) { setSource(id); setOpen(false); setChoosing(false) }
                    }}
                  >
                    인물 삭제 되돌리기
                  </button>
                )}
              </div>
              {people.length < 2 && (
                <p>설정 카드에서 설정 두 개을 먼저 추가하세요. 관계 없이도 저장할 수 있습니다.</p>
              )}
              {deletion && (
                <CardDeletionConfirm
                  deletion={deletion}
                  onDelete={() => {
                    if (open && !studio.confirmRelationDiscard()) return
                    if (studio.deleteCard(deletion.card.item.id)) {
                      setDeleteConfirm(null)
                      setSource('')
                      setTarget('')
                      setOpen(false)
                      setChoosing(false)
                    }
                  }}
                  onCancel={() => setDeleteConfirm(null)}
                />
              )}
            </section>
            {open && (
              <div className='relationship-pair'>
                <RelationPairEditor
                  key={source + '|' + target}
                  studio={studio}
                  source={source}
                  target={target}
                  focusRequest={focusRequest}
                  onClose={() => setOpen(false)}
                />
              </div>
            )}
            <section className='relationship-list' aria-label='관계 목록'>
              <h4>관계 목록 <span className='small muted'>{relations.length}개</span></h4>
              {!relations.length
                ? <p>아직 연결한 관계가 없습니다.</p>
                : (
                  <table className='relationship-table world-compact'>
                    <caption className='sr-only'>저장할 관계 목록</caption>
                    <thead>
                      <tr><th scope='col'>주체</th><th scope='col'>관계</th><th scope='col'>대상</th><th scope='col'><span className='sr-only'>편집·삭제</span></th></tr>
                    </thead>
                    <tbody>
                      {relations.map((s) => {
                        const label = relationLabel(s.item), full = `${name(s.item.subjectId)} · ${label} · ${name(s.item.targetId)}`
                        return (
                          <tr key={s.item.id}>
                            <td>{name(s.item.subjectId)}</td>
                            <td>{label}</td>
                            <td>{name(s.item.targetId)}</td>
                            <td className='relationship-row-actions'>
                              <button className='btn sm' type='button' aria-label={`${full} 편집`} onClick={() => selectPair(s.item.subjectId ?? '', s.item.targetId ?? '', true)}>편집</button>
                              <button className='btn sm relationship-remove' type='button' aria-label={`${full} 삭제`} onClick={() => removeRelation(s.item.id, full)}>삭제</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
            </section>
          </div>
        </div>
      </fieldset>
    </section>
  )
}
