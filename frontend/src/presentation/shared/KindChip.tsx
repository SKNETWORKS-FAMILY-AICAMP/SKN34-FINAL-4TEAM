import { CARD_COLORS, type CardKind } from './worldBoard'
import './worldBoard.css'

/** 설정 카드 유형 칩: 그 묶음 색 점과 카드 자신의 유형 이름(능력·사물 …). 색은 그래프·범례와 같다. 게시판 CSS(색 점)를 함께 불러온다. */
export const KindChip = ({ kind, label }: { kind: CardKind; label: string }) => <span className="chip"><i className="dot" style={{ background: CARD_COLORS[kind] }} />{label}</span>
