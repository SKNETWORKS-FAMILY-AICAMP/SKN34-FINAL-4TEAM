# 제2장 훼손 구절 복구 대조초안

작성일: 2026-11-13. 대상: William Hunt, History of Italy, Second Edition, Macmillan, 1883.

## 범위와 근거

기존 `02-qa.ko.md` 및 `02-main-prose.ko.draft.md`의 본문 문맥 추정 11곳을 대상으로 한다. Google 스캔의 훼손 면과 Toronto 스캔의 해당 인쇄면을 직접 시각 대조했다. OCR은 위치 탐색에만 사용하고, 아래 영문은 이미지로 확인한 인쇄문이다. 줄바꿈에 따른 단어 분할은 합쳤다. 영어의 역사적 주장이나 추측을 현대 지식으로 정정하지 않았다.

- 기존 스캔: `../source-scan.pdf`, 해당 훼손 면 PDF 41·43·47·49·51 = 인쇄 24·26·30·32·34.
- 대조 스캔: `../source-toronto-1883-scan.pdf`, SHA-256 `65697AE4B66BBF789C5E78214033868D7864B3EDFCDE2B365C5D1700EB0F3CA1`.
- 새 PDF 쪽수는 파일 처음부터 1로 센 값이다. 이 장에서는 인쇄 쪽수 +16이다. 연결 문장 확인을 포함하여 인쇄 23~27·29~35쪽을 이미지로 읽었다.
- 기존 본문·QA·원문은 덮어쓰지 않았다. 아래 한국어는 교체 후보이며 아직 본문에 병합하지 않았다.
- 이번 11곳의 이미지 결손은 대체 스캔에서 해소된다. 역사 감수·번역 최종 교열 완료 또는 책 전체 확정 완역을 뜻하지 않는다.

## 02-01. 제7절, 도시 자치와 평의원단

- 위치: 인쇄 23~24 / 기존 PDF 40~41 / 새 PDF 39~40.
- 이전 표시: `[문맥상 추정: 북부 이탈리아의 큰 도시들은 이전에 누리던 도시 자치의 상당 부분을 어떤 형태로든 지켜 온 것으로 보인다. 제국 초기부터 내부 통치는 상층 계급의 손에 있었다. 이 신분 집단, 곧 데쿠리오 평의원단(Ordo Decurionum)은 제국 재무부에 대해 세금 납부의 책임을 졌다. 따라서 도시를 대표하는 일종의 통치 단체였고, 세금과 전반적인 곤궁 때문에 크게 약해졌더라도 파비아와 그 밖의 큰 도시들에서 여전히 가장 중요한 권력이었을 것이다.]`
- 확인한 영문:

> The large cities of North Italy seem to have kept, under one form or another, a good part of the municipal liberty which they had in earlier times. From the beginning of the Empire their internal government had been in the hands of the higher class. This Order (Ordo Decurionum) was responsible to the Imperial treasury for the taxes; it thus represented the city, and was a sort of governing corporation, and, though it was much weakened by taxation and general distress, it must still have been the foremost power in Pavia and other large cities.

수정 한국어:

북부 이탈리아의 큰 도시들은 이전에 누리던 도시 자치의 상당 부분을 어떤 형태로든 유지해 온 것으로 보인다. 제국 초기부터 도시 내부의 통치는 상층 계급의 손에 있었다. 이 신분 집단, 곧 데쿠리오 평의원단(Ordo Decurionum)은 제국 재무부에 대해 세금 납부의 책임을 졌다. 따라서 도시를 대표하는 일종의 통치 단체였으며, 세금과 전반적인 곤궁 때문에 크게 약해졌더라도 파비아와 다른 큰 도시들에서는 여전히 가장 유력한 세력이었을 것이다.

남은 불확실성: 문자의 결손 없음. `seem`과 `must ... have been`은 저자 자신의 역사적 추론이므로 추정형으로 보존한다.

## 02-02. 제7절, 영주와 도시의 권력

- 위치: 인쇄 24 / 기존 PDF 41 / 새 PDF 40.
- 이전 표시: `[문맥상 추정: 작은 도시들은 대부분 어느 유력한 세속 영주나 주교의 지배 아래 들어갔을 것이다. 밀라노조차 대주교를 견제하는 일이 종종 버거웠다. 영주의 관리는 도시의 민병대를 지휘하고 더 중요한 사건의 재판관을 맡았으며, 그 밖의 일은 시민들이 선출한 관리들이 처리했다. 카롤링거 지배의 해체 때 이탈리아에 닥친 혼란, 왕위를 둘러싼 분쟁, 헝가리인들의 침입은 도시들의 권력과 중요성을 높였다. 도시들은 방어할 수 있는 장소로 만들 수 있거나 이미 오래전에 요새화되어 있었기 때문이다.]`
- 확인한 영문:

> The smaller cities, for the most part, must have fallen under the power either of some great secular lord or bishop, and even Milan had often enough to do to keep her Archbishop in check. The lord's officer commanded the militia of the city, and was judge in the more important cases, while other matters were managed by officers chosen by the citizens. The troubles which came upon Italy at the break up of the Carolingian dominion, the disputes for the throne and the invasion of the Hungarians, made the cities rise in power and importance, as places which either could be made capable of defence, or had been already fortified in older times.

수정 한국어:

작은 도시들은 대부분 어느 유력한 세속 영주나 주교의 지배 아래 들어갔을 것이다. 밀라노조차 대주교를 견제하는 데 종종 애를 먹었다. 영주의 관리는 도시 민병대를 지휘하고 더 중요한 사건의 재판관을 맡았으며, 그 밖의 일은 시민들이 선출한 관리들이 처리했다. 카롤링거 지배의 해체 때 이탈리아에 닥친 혼란, 왕위를 둘러싼 분쟁, 헝가리인들의 침입은 도시들의 권력과 중요성을 높였다. 도시들은 방어할 수 있게 만들 수 있는 곳이거나 이미 오래전에 요새화된 곳이었기 때문이다.

남은 불확실성: 문자 결손 없음. 작은 도시들의 복속에 관한 추정형은 원문의 표현이다.

## 02-03. 제7절, 집정관·평의회·시민총회

- 위치: 인쇄 24~25 / 기존 PDF 41~42 / 새 PDF 40~41.
- 이전 표시: `[문맥상 추정: 11세기에는 일반적으로 시민들이 선출한 둘 이상의 집정관이 통치를 맡았다. 그들의 임무는 사법을 집행하고, 민병대를 소집·지휘하며, 도시의 평의회들을 주재하는 것이었다. 이 초기 공화국들에는 대체로 두 개의 평의회가 있었다. 작은 평의회는 도시의 법률과 정책을 집행했으며, 훗날 콘실리오 디 크레덴차(Consiglio di Credenza)라고 불렸다. 다른 평의회는 더 많은 구성원으로 이루어졌고 대평의회 또는 원로원이라고 불렸다. 새로운 조치들은 이 큰 평의회에서 토론했다. 도시의 최고 권력은 시민 전체 자신에게 있었다. 중대한 일이 있을 때는 도시의 공공 종을 울렸고, 모든 시민이 도시청사 앞 광장의 ‘의회’에 모였다. 오토 3세가 죽자 이 자치도시들은 중요성을 얻었다. 왕관을 두고 또다시 분쟁이 일어났기 때문이다.]`
- 확인한 영문:

> In the eleventh century the government was generally carried on by two or more Consuls, chosen by the people. Their duties were to dispense justice, to call out and head the militia, and to preside over the councils of the city. Each of these infant republics had generally two councils. The smaller one carried out the laws and policy of the city, and in after-time was called the Consiglio di Credenza. The other consisted of more members, and was called the Great Council or Senate. In this larger Council new measures were debated. The highest power in the city was in the whole body of the citizens themselves. On great occasions the common bell of the city was tolled, and all the citizens gathered together in “Parliament” in the square of the city-palace. These municipalities gained importance at the death of Otto the Third, for then there was another dispute for the crown.

수정 한국어:

11세기에는 대체로 시민들이 선출한 둘 이상의 집정관이 통치를 맡았다. 그들의 임무는 사법을 집행하고, 민병대를 소집·지휘하며, 도시의 평의회들을 주재하는 것이었다. 이 초기 공화국들에는 대체로 두 개의 평의회가 있었다. 작은 평의회는 도시의 법률과 정책을 집행했고, 훗날 콘실리오 디 크레덴차(Consiglio di Credenza)라고 불렸다. 다른 평의회는 구성원이 더 많았으며 대평의회 또는 원로원이라고 불렸다. 새로운 조치들은 이 큰 평의회에서 토론했다. 도시의 최고 권력은 시민 전체 자신에게 있었다. 중대한 일이 있을 때는 도시의 공공 종을 울렸고, 모든 시민이 도시청사 앞 광장의 ‘의회’에 모였다. 오토 3세가 죽자 왕관을 둘러싼 분쟁이 다시 일어났고, 이 자치도시들의 중요성도 커졌다.

남은 불확실성: 문자 결손 없음. `Parliament`는 이 대목의 시민 집회를 가리키며 현대 의회 제도로 바꾸지 않는다.

## 02-04. 제8절, 밀라노의 내분

- 위치: 인쇄 26 / 기존 PDF 43 / 새 PDF 42.
- 이전 표시: `[문맥상 추정: 황제가 없는 틈에 내분은 제지받지 않고 계속되었다. 밀라노는 한동안 귀족들과, 란초라는 귀족이 이끄는 민중 사이의 전쟁으로 어지러웠다. 아버지의 뒤를 이은 하인리히 3세는 이 전쟁에 개입하기를 거부했다.]`
- 확인한 영문:

> The absence of the Emperor enabled civil discord to go on unchecked. Milan was for some time disturbed by a war between the nobles and the people headed by a noble called Lanzo. In this war Henry the Third, who succeeded his father, refused to interfere.

수정 한국어:

황제가 없는 틈에 내분은 제지받지 않고 계속되었다. 밀라노는 한동안 귀족들과, 란초라는 귀족이 이끄는 민중 사이의 전쟁으로 어지러웠다. 아버지의 뒤를 이은 하인리히 3세는 이 전쟁에 개입하기를 거부했다.

남은 불확실성: 문자 결손 없음. 새 OCR의 `Laiuzo`가 아니라 인쇄된 이름 `Lanzo`를 이미지로 확인했다.

## 02-05. 제8절, 레오 9세의 개혁

- 위치: 인쇄 26~27 / 기존 PDF 43~44 / 새 PDF 42~43.
- 이전 표시: `[문맥상 추정: 투스쿨룸 가문 출신 교황들 아래에서 교황권은 낮은 상태로 떨어졌다. 황제 하인리히 3세가 독일인 교황들을 현명하게 임명하면서 교황권이 다시 일어났다. 이곳의 기후는 그가 처음 임명한 두 교황에게 치명적이었다. 세 번째 교황인 그의 친족 레오 9세는 개혁을 시작했고, 그 개혁은 시간이 지나면서 교황권을 제국의 경쟁자가 될 정도로 강하게 만들었다. 교회를 약하게 만든 두 가지 주요 원인은 성직매매와 성직자의 결혼이었다. 성직매매는 그 직업의 신성함을 빼앗고 세속 권력이 성직 임명에 간섭할 수 있게 했다. 성직자의 결혼은 교회 성직록을 세습하게 만드는 경향이 있었고, 평신도의 성직자에 대한 존경심을 줄였으며, 사제들이 권력을 위한 투쟁에 전념하는 것을 방해했다. 레오는 이 두 관행을 모두 맹렬하게 공격했다. 누구도 성직매매를 옹호하지 않았지만, 너무 널리 퍼져 있어서 신속하게 뿌리 뽑을 수는 없었다. 이에 대한 공격은 점차 서임권 투쟁으로 합쳐졌다. 성직자에게 독신을 강제하려는 시도는]`.
- 범위: 기존 대괄호는 문장 중간에서 끝난다. 아래는 문장을 완결하려고 다음 쪽의 `gave rise ... Milan`까지 함께 제시한다. 뒤의 성 암브로시우스 문장부터는 교체 대상이 아니다.
- 확인한 영문:

> The Papacy sank low under the Tusculan Popes. It was raised by the wise appointments of German Popes by the Emperor Henry the Third. The climate proved fatal to his first two Popes; the third, his own kinsman, Leo the Ninth, began a work of reformation, which, in time, made the Papacy so strong that it became the rival of the Empire. The two main causes of weakness in the Church were simony and the marriage of the clergy. Simony robbed it of its sanctity as a profession and enabled the temporal power to interfere with its preferments. The marriage of the clergy tended to make ecclesiastical benefices hereditary, lessened the veneration of the laity for the priesthood, and hindered the priests from devoting themselves to a struggle for power. Both these customs were vigorously attacked by Leo. No defence was offered for simony, but it was too wide-spread to be quickly rooted out, and the attack upon it gradually was merged in the War of the Investitures. The attempt to enforce clerical celibacy gave rise to a bitter struggle in Milan.

수정 한국어:

투스쿨룸 가문 출신 교황들 아래에서 교황권은 쇠락했다. 황제 하인리히 3세가 독일인 교황들을 현명하게 임명하면서 교황권은 다시 일어났다. 이곳의 기후는 그가 처음 임명한 두 교황에게 치명적이었다. 세 번째 교황인 그의 친족 레오 9세는 개혁을 시작했고, 시간이 지나면서 이 개혁은 교황권을 제국의 경쟁자가 될 만큼 강하게 만들었다. 교회를 약화시킨 두 가지 주요 원인은 성직매매와 성직자의 결혼이었다. 성직매매는 성직의 신성함을 빼앗고 세속 권력이 성직 임명에 간섭할 수 있게 했다. 성직자의 결혼은 교회 성직록을 세습하게 만드는 경향이 있었고, 평신도들의 성직자에 대한 존경심을 줄였으며, 사제들이 권력을 위한 투쟁에 전념하는 것을 방해했다. 레오는 두 관행을 모두 맹렬히 공격했다. 누구도 성직매매를 옹호하지는 않았지만 너무 널리 퍼져 있어서 신속히 뿌리 뽑을 수는 없었다. 이에 대한 공격은 점차 서임권 투쟁에 합쳐졌다. 성직자에게 독신을 강제하려는 시도는 밀라노에서 격렬한 투쟁을 일으켰다.

남은 불확실성: 문자 결손 없음. 성직자의 결혼 및 개혁에 대한 가치 판단은 저자의 주장이다.

## 02-06. 제10절, 참주정의 출현

- 위치: 인쇄 29~30 / 기존 PDF 46~47 / 새 PDF 45~46.
- 이전 표시: `[문맥상 추정: 이 도시들이 잠시 자유를 누린 뒤, 시민들은 사악한 조언을 듣고 절대적 지배자들의 멍에 아래 들어갔다. 그리스에서 부르던 말로는 참주들이었다. 곧 한때 공화국이던 국가에서 어떻게든 지배권을 얻은 사람들이라는 뜻이다. 그들은 시민들의 칼을, 더 흔하게는 시민들의 돈으로 고용한 용병들의 칼을 이용하여 다른 지역을 병합했다. 그리하여 이탈리아는 여러 독립된 영주령으로 갈라졌다.]`
- 확인한 영문:

> After these cities had for a short time been free, the citizens listened to evil counsels, and fell under the yoke of absolute rulers, or, as they were called in Greece, tyrants; that is to say, men who in some way or other got the lordship over a state which had once been a commonwealth. These men used the swords of the citizens, or more often of mercenaries hired by their money, to annex other places, and thus Italy became split up into separate lordships.

수정 한국어:

이 도시들이 잠시 자유를 누린 뒤, 시민들은 사악한 조언에 귀를 기울이다가 절대적 지배자들의 멍에 아래 들어갔다. 그리스에서 부르던 말로 하면 참주들, 곧 한때 공화국이던 나라의 지배권을 어떻게든 차지한 사람들이었다. 그들은 시민들의 칼을, 더 흔하게는 시민들의 돈으로 고용한 용병들의 칼을 이용해 다른 지역을 병합했다. 그리하여 이탈리아는 여러 개의 별도 영주령으로 갈라졌다.

남은 불확실성: 문자 결손 없음. `evil counsels`라는 도덕적 평가는 원문에 실제로 있다.

## 02-07. 제10절, 피렌체

- 위치: 인쇄 30 / 기존 PDF 47 / 새 PDF 46.
- 이전 표시: `[문맥상 추정: 롬바르디아 공화국들이 쇠퇴하고 참주들의 수중에 떨어지기 시작했을 때, 피렌체는 위대한 역정의 초기 단계에 있었다. 이 고귀한 토스카나 도시는 오랫동안 이탈리아 자유의 보루였으며, 거의 마지막으로 멍에 아래 들어간 도시였다.]`
- 확인한 영문:

> When the Lombard republics began to decay, and to fall under Tyrants, Florence was in an early stage of her career of greatness. This noble Tuscan city was for a long time the bulwark of Italian freedom, and was almost the last to fall under the yoke.

수정 한국어:

롬바르디아 공화국들이 쇠퇴하며 참주들의 수중에 떨어지기 시작했을 때, 피렌체는 위대한 역사의 초기 단계에 있었다. 이 고귀한 토스카나 도시는 오랫동안 이탈리아 자유의 보루였으며, 거의 마지막으로 멍에 아래 들어간 도시였다.

남은 불확실성: 문자 결손 없음. 피렌체를 높이는 표현과 상대적 시기 평가는 저자의 것이다.

## 02-08. 제11절, 힐데브란트의 정책

- 위치: 인쇄 30~31 / 기존 PDF 47~48 / 새 PDF 46~47.
- 이전 표시: `[문맥상 추정: 하인리히 3세가 교황권에 가져온 개혁은 교황권이 황제의 왕좌에 맞서도록 무장시켰다. 그는 교황을 만드는 사람이 됨으로써 개혁을 이루었다. 교황들은 주인에게서 벗어날 힘이 생기기만을 기다렸다. 하인리히가 죽기 전부터 죽은 뒤까지 여러 해 동안, 로마의 궁정은 대부제 힐데브란트가 관리했다. 그는 정치적 능력이 뛰어나고, 자존심이 강했으며, 자신의 직분과 관련된 모든 일에서 야심을 품고, 굽히지 않는 의지를 가진 사람이었다. 그는 성직자 집단을 하나로 결합한 영적 군대로 만들려 했다. 이 군대는 오직 교회 및 지상의 교회 수장의 정치적 권력을 키우는 데 전념해야 했다. 이를 위해 그는 성직자에게 독신을 강제하고, 교회의 임명을 모든 세속 권력에서 해방함으로써 성직자 집단의 지위를 높이려 했다. 그가 보기에 결혼한 사제는 축첩의 죄를 지은 사람이었다. 또 성직록에 딸린 세속 재산, 곧 토지나 수입을 세속 영주에게서 받은 사람은 성직매매의 죄를 지은 사람이었다. 레오 9세 때 그가 성직자의 결혼을 공격한 일은 많은 성직자를 그에게서 돌아서게 했다. 두 번째 교리는 토지의 소유에 기초한 모든 세속 권력의 근본을 겨냥했다. 만약 그것이 완전히 성공했다면, 기독교 세계 전체에 세속 정부로부터 독립하고 막대한 부를 소유한 하나의 신분 집단이 생겼을 것이다.]`
- 확인한 영문:

> The reform which Henry the Third brought about in the Papacy armed it against the Imperial throne. He worked its reform by becoming a maker of Popes, and the Popes only waited for strength to rid themselves of a master. For many years both before and after the death of Henry, the Court of Rome was managed by the Archdeacon Hildebrand, a man of great political talent, proud, ambitious in all matters which concerned his order, and of an unbending will. He aimed at making the priesthood a united spiritual army, devoted solely to the advancement of the political power of the Church, and of the Head of the Church upon earth. To this end he strove to raise the position of the priesthood by enforcing the celibacy of the clergy and by freeing ecclesiastical appointments from all lay power. In his eyes a married priest was guilty of concubinage; and one who received the temporalities, the lands or revenues, of his benefice from a lay lord, was guilty of simony. The attack which he made upon the marriage of the clergy in the time of Leo the Ninth turned away a large number of them from him. The second doctrine struck at the root of all lay power, which was based upon the lordship of land. If it had been fully successful, it would have created throughout Christendom an order independent of all secular government, and possessed of vast wealth.

수정 한국어:

하인리히 3세가 교황권에 가져온 개혁은 교황권이 황제의 왕좌에 맞설 힘을 갖추게 했다. 그는 교황들을 임명하는 사람이 됨으로써 개혁을 이루었고, 교황들은 그 주인에게서 벗어날 힘이 생기기만을 기다렸다. 하인리히의 죽음 전후 여러 해 동안 로마의 궁정은 대부제 힐데브란트가 운영했다. 그는 정치적 재능이 뛰어나고 자존심이 강했으며, 성직자 계층과 관련된 모든 일에 야심을 품고 굽히지 않는 의지를 가진 사람이었다. 그는 성직자들을 하나로 결합된 영적 군대로 만들고자 했다. 이 군대는 오직 교회와 지상의 교회 수장의 정치적 권력을 키우는 데 전념해야 했다. 이를 위해 성직자에게 독신을 강제하고 교회의 임명을 모든 세속 권력에서 해방함으로써 성직자들의 지위를 높이려 했다. 그가 보기에 결혼한 사제는 축첩의 죄를 지은 사람이었다. 또 성직록에 딸린 세속 재산, 곧 토지나 수입을 세속 영주에게서 받은 사람은 성직매매의 죄를 지은 사람이었다. 레오 9세 때 성직자의 결혼을 공격한 일은 많은 성직자를 그에게서 돌아서게 했다. 두 번째 교리는 토지 지배에 기초한 모든 세속 권력의 근본을 겨냥했다. 그것이 완전히 성공했다면, 기독교 세계 전체에 모든 세속 정부로부터 독립하고 막대한 부를 소유한 하나의 신분 집단이 생겼을 것이다.

변경 요점: 기존 ‘자신의 직분’은 `his order`를 개인 직책처럼 읽게 하므로 ‘성직자 계층’으로 구체화했다. `Head of the Church`, `raise the position`은 모두 인쇄문에서 확인된다.

남은 불확실성: 문자 결손 없음. 힐데브란트의 동기와 정책 결과에 대한 평가는 여전히 역사 감수 대상이다.

## 02-09. 제12절, 로마 포위와 하인리히 대관

- 위치: 인쇄 32 / 기존 PDF 49 / 새 PDF 48.
- 이전 표시: `[문맥상 추정: 노르만인 위스카르에게 영토를 침공당한 동방 황제 알렉시오스는 하인리히와 동맹을 맺고 많은 돈을 제공했다. 그러나 치비텔라 전투 이래 교황권의 굳건한 동맹자였던 노르만인들은 처음에는 그레고리오를 도울 수 없었다. 로베르가 동방에서 전쟁을 벌이고 있었기 때문이다. 포위가 여러 차례 중단되던 때 가운데 한 번, 황제의 군대가 토스카나를 휩쓸었고 백작부인의 지지자 몇몇이 교황 편을 떠났다. 하인리히는 강의 오른쪽 기슭에 있는 레오 성벽 구역을 점령했다. 마침내 로마인들은 그에게 성문을 열었다. 1084년 주님 수난 성지 주일에 왕이 세운 교황 기베르트가 축성되어 클레멘스 3세라는 칭호를 취했다. 그 보답으로 그는 하인리히 왕에게 로마인들의 황제라는 제관을 씌웠다.]`
- 확인한 영문:

> The Eastern Emperor, Alexios, whose dominions were invaded by the Norman Wiscard, made an alliance with Henry, and supplied him largely with money. The Normans, however, who since the battle of Civitella had been the firm allies of the Papacy, could not help Gregory at first, for Robert was warring in the East. In one of the many intervals of the siege the Emperor's troops overran Tuscany, and several of the adherents of the Countess deserted the Pope's cause. Henry took the Leonine city which lies on the right bank of the river, and, at last, the Romans opened their gates to him. On Palm Sunday, 1084, the King's Pope, Guibert, was consecrated and took the title of Clement the Third, and, in return, he crowned King Henry as Emperor of the Romans.

수정 한국어:

노르만인 위스카르에게 영토를 침공당한 동방 황제 알렉시오스는 하인리히와 동맹을 맺고 많은 돈을 제공했다. 한편 치비텔라 전투 이래 교황권의 굳건한 동맹자였던 노르만인들은 처음에는 그레고리오를 도울 수 없었다. 로베르가 동방에서 전쟁을 벌이고 있었기 때문이다. 포위가 여러 차례 중단되던 때 가운데 한 번, 황제의 군대가 토스카나를 휩쓸었고 백작부인의 지지자 몇몇이 교황 편을 떠났다. 하인리히는 강 오른쪽 기슭의 레오 성벽 구역을 점령했고, 마침내 로마인들은 그에게 성문을 열었다. 1084년 주님 수난 성지 주일, 왕이 세운 교황 기베르트가 축성되어 클레멘스 3세라는 칭호를 취했다. 그 보답으로 그는 하인리히 왕에게 로마인들의 황제로서 제관을 씌웠다.

남은 불확실성: 문자 결손 없음. 대관의 날짜와 사건 관계는 원문 그대로이며 별도 역사 감수가 필요하다.

## 02-10. 제13절, 교황의 동맹자

- 위치: 인쇄 34 / 기존 PDF 51 / 새 PDF 50.
- 이전 표시: `[문맥상 추정: 이 투쟁 내내 노르만인들은 교황들의 충실한 동맹자이자 봉신으로 남았다. 그레고리오 7세, 우르바노 2세, 파스칼 2세는 차례로 그들의 영토에서 피난처를 찾았다. 콘라트의 대관 이후로 대부분의 롬바르디아 도시들은 교황 측으로 기울었다. 그러나 토스카나에 독일군이 주둔해 있었기 때문에 적극적인 도움을 많이 주지는 못했다.]`
- 확인한 영문:

> The Normans throughout the struggle continued the faithful allies and vassals of the Popes. Gregory the Seventh, Urban the Second, and Paschal the Second, each in turn found shelter in their dominions. From the time of the coronation of Conrad, most of the Lombard cities were inclined to the Papal side, but the presence of a German army in Tuscany prevented much active help being given.

수정 한국어:

이 투쟁 내내 노르만인들은 교황들의 충실한 동맹자이자 봉신으로 남았다. 그레고리오 7세, 우르바노 2세, 파스칼 2세는 차례로 그들의 영토에서 피난처를 찾았다. 콘라트의 대관 이후 대부분의 롬바르디아 도시들은 교황 측으로 기울었지만, 토스카나에 독일군이 주둔해 있었기 때문에 적극적인 도움을 많이 줄 수는 없었다.

남은 불확실성: 문자 결손 없음.

## 02-11. 제14절, 보름스 협약

- 위치: 인쇄 34~35 / 기존 PDF 51~52 / 새 PDF 50~51.
- 이전 표시: `[문맥상 추정: 마침내 서임 문제는 보름스에서 해결되었다. 양측이 무언가를 양보했지만 실질적인 이득은 교황 측에 있었다. 황제는 반지와 지팡이로 서임하는 권리를 포기하고 교회에 자유 선거의 권리를 인정했다. 반면 교황은 독일 교회의 세속 재산을 황제에게서 받아야 한다는 점, 곧 그 교회가 사실상 국가교회가 되어야 한다는 점을 인정했다.]`
- 확인한 영문:

> At last the question of Investitures was decided at Worms. Each party gave up something: the substantial gain was on the Pope's side. The Emperor surrendered the right of Investiture by ring and staff, and granted the right of free election to the clergy. On the other hand, the Pope granted that the temporalities of the Church in Germany should be received from the Emperor, that it should in fact become a National Church.

수정 한국어:

마침내 서임 문제는 보름스에서 해결되었다. 양측이 무언가를 양보했지만 실질적인 이득은 교황 측에 있었다. 황제는 반지와 지팡이로 서임하는 권리를 포기하고 성직자들에게 자유 선거의 권리를 인정했다. 반면 교황은 독일 교회의 세속 재산을 황제에게서 받아야 한다는 점, 곧 그 교회가 사실상 국가교회가 되어야 한다는 점을 인정했다.

변경 요점: `ring and staff`를 직접 확인했다. 자유 선거 권리의 대상은 원문 `the clergy`에 맞춰 기존 ‘교회’에서 ‘성직자들’로 좁혔다.

남은 불확실성: 문자 결손 없음. `National Church`라는 저자의 요약을 현대 협약 해석으로 대체하지 않는다.

## 후속 반영 시 유의

대상 11곳은 대체 스캔에 근거한 복구 후보가 마련되었으나 기존 본문의 추정 표시는 그대로 남아 있다. 장 전체 재검수나 자동 표지 제거를 수행하지 않았다. 476년 이전 고대사·1874년 이후 현대사의 범위 공백, 19세기 원저의 편향과 사실 오류 가능성, 전문가 검수 미완료 및 파생 세계관과 원문 번역의 분리는 그대로 유지한다. 앱·DB·학습 코퍼스 통합, 커밋, 푸시는 하지 않았다.
