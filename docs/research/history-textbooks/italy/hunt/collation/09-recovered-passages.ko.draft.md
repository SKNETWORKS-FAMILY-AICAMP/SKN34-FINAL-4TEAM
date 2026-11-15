# 제9장 훼손 구절 복구 대조초안

작성일: 2026-11-13. William Hunt, History of Italy, Second Edition, Macmillan, 1883.

## 범위와 근거

기존 본문·QA의 문맥 추정 7곳을 같은 판의 Toronto 스캔 이미지와 대조했다. OCR은 탐색에만 사용하고 아래 인쇄면을 직접 확인했다. 기존 Google 스캔의 손상 위치도 비교했다. 기존 본문·QA·원문은 덮어쓰지 않았다.

- 기존 스캔: `../source-scan.pdf`.
- 대조 스캔: `../source-toronto-1883-scan.pdf`, SHA-256 `65697AE4B66BBF789C5E78214033868D7864B3EDFCDE2B365C5D1700EB0F3CA1`.
- PDF 쪽수는 파일 처음부터 1로 센 위치다. 아래 위치에서 기존 PDF는 인쇄 쪽+17, 새 PDF는 인쇄 쪽+16이다.
- 영문은 인쇄면의 행갈이와 행 끝 하이픈만 연결했다. 서체·따옴표 모양은 일반 텍스트로 정리했다.

## 09-01. 제8절, 시에나의 항복

- 위치: 인쇄181~182 / 기존 PDF198~199 / 새 PDF197~198.
- 이전 표시: `[문맥상 추정: 8월 피에로는 키아나의 정면 전투에서 패했다. 이후 시에나는 극심한 궁지에 몰렸다. 먹을 수 있는 것은 무엇이든 비싸게 팔렸다. 주민들과 프랑스 동맹군은 항복하기 전에 도시의 말·개와 다른 동물들을 모두 먹었다. 15개월의 포위 끝에 도시는 1555년 4월 항복했다. 수비대는 군사적 예우를 받으며 퇴거했다. 많은 시에나인이 함께 떠나 몬탈치노에 정착했다. 제국 수비대가 입성했고, 2년 뒤 공작은 도시의 완전한 주권을 얻었다.]`

확인한 영문:

> In August, Piero was defeated in a pitched battle on the Chiana. After this defeat Siena was reduced to great straits. Everything which could possibly be eaten was sold at a high price. All the horses and dogs and other animals in the city were eaten up before the people or their French allies would yield. The city surrendered in April, 1555, after a siege of fifteen months. The garrison marched out with the honours of war. A large number of the Sienese went with them, and settled at Montalcino. An Imperial garrison entered Siena, and two years afterwards the Duke received the full sovereignty of the city.

수정 한국어(병합 전 교체 후보):

8월 피에로는 키아나의 정면 전투에서 패했다. 이후 시에나는 극심한 궁지에 몰렸다. 먹을 수 있는 것은 무엇이든 비싸게 팔렸다. 주민들과 프랑스 동맹군은 항복하기 전에 도시의 말·개와 다른 동물들을 모두 먹었다. 15개월의 포위 끝에 도시는 1555년 4월 항복했다. 수비대는 군사적 예우를 받으며 퇴거했다. 많은 시에나인이 함께 떠나 몬탈치노에 정착했다. 제국 수비대가 입성했고, 2년 뒤 공작은 도시의 완전한 주권을 얻었다.

판독 결과: 행 끝 결손과 인쇄181의 시작부를 복구했다. 1555년 4월, 15개월, 2년 뒤라는 수치는 원문과 같다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-02. 제8절, 전쟁 피해와 개간

- 위치: 인쇄182 / 기존 PDF199 / 새 PDF198.
- 이전 표시: `[문맥상 추정: 이 전쟁은 시에나 영토뿐 아니라 피렌체 주변에도 끔찍한 피해를 주었다. 주민의 고통은 매우 컸다. 몬탈치노에서 시에나까지, 또 시에나에서 피렌체까지 살아 있는 사람이 하나도 남지 않은 듯했다. 주민이 없어서 비옥한 땅을 경작하거나 배수하지 못했고, 그 결과 전염성 열병이 만연했다. 이제야 마침내 땅을 다시 개간하고 있다. 코시모 데 메디치 공작의 잔혹함과 야심을 보여 주는 이 오래 남은 증거도 자유로운 이탈리아 국민의 활력과 진취성으로 없어질 듯하다.]`

확인한 영문:

> This war did terrible damage, not only to the territory of Siena, but also to the country round Florence. The sufferings of the people were very great. From Montalcino to Siena, and from Siena to Florence, it seemed as though no living soul were left; the rich land lay untilled and undrained for lack of inhabitants, and so it became a prey to pestilential fever. It is now at last being reclaimed, and this standing memorial of the cruelty and ambition of Duke Cosimo de’ Medici is now likely to be removed by the energy and enterprise of the free Italian people.

수정 한국어(병합 전 교체 후보):

이 전쟁은 시에나 영토뿐 아니라 피렌체 주변에도 끔찍한 피해를 주었다. 주민의 고통은 매우 컸다. 몬탈치노에서 시에나까지, 또 시에나에서 피렌체까지 살아 있는 사람이 하나도 남지 않은 듯했다. 주민이 없어서 비옥한 땅을 경작하거나 배수하지 못했고, 그 결과 전염성 열병이 만연했다. 이제야 마침내 땅을 다시 개간하고 있다. 코시모 데 메디치 공작의 잔혹함과 야심을 보여 주는 이 오래 남은 증거도 자유로운 이탈리아 국민의 활력과 진취성으로 없어질 듯하다.

판독 결과: 잘린 행 끝과 now 두 곳이 확인된다. ‘이제’는 19세기 원저 집필 시점의 관찰이며 2026년 현재의 상태가 아니다. 주민 부재·질병·개간의 규모와 원인도 저자의 주장이다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-03. 제9절, 펠리페의 영토와 칭호

- 위치: 인쇄182~183 / 기존 PDF199~200 / 새 PDF198~199.
- 이전 표시: `[문맥상 추정: 시에나의 함락이 작은 사건에 불과했던 황제와 앙리 2세의 전쟁은 서유럽 전체에 영향을 주었다. 이탈리아에서 결과는 대체로 카를에게 유리했다. 프랑스군은 사보이 공국을 휩쓸었지만 밀라노 공국에 발판을 마련하지 못했고 토스카나에서 쫓겨났다. 독일로 전쟁을 확대해서는 완전한 성공을 거두었다. 황제는 지치고 실망하여 1555년 저지대와 부르고뉴 백작령을 우리나라 메리 여왕의 남편인 아들 펠리페에게 넘겼다. 펠리페는 이미 밀라노·시칠리아·나폴리를 다스렸고, 시칠리아 왕이라는 칭호에 예루살렘 왕의 칭호를 결합했던 프리드리히 2세의 후계자로서 예루살렘 왕을 자칭했다.]`

확인한 영문:

> The war between the Emperor and Henry the Second, of which the fall of Siena was a little incident, affected the whole of the West of Europe. As far as it concerned Italy, its results were upon the whole in favour of Charles. The French overran the Duchy of Savoy, but they were not able to gain a footing in the Duchy of Milan, and were driven out of Tuscany. They carried the war into Germany, and there they were completely successful. The Emperor was worn out and disappointed, and, in 1555, he gave up the Low Countries and the County of Burgundy to his son Philip, the husband of our Queen Mary. Philip already ruled over Milan, Sicily, and Naples, and used the title of King of Jerusalem, as the successor of Frederic the Second, who joined it to the title of King of Sicily.

수정 한국어(병합 전 교체 후보):

시에나의 함락이 작은 사건에 불과했던 황제와 앙리 2세의 전쟁은 서유럽 전체에 영향을 주었다. 이탈리아에서 결과는 대체로 카를에게 유리했다. 프랑스군은 사보이 공국을 휩쓸었지만 밀라노 공국에 발판을 마련하지 못했고 토스카나에서 쫓겨났다. 독일로 전쟁을 확대해서는 완전한 성공을 거두었다. 황제는 지치고 실망하여 1555년 저지대와 부르고뉴 백작령을 우리나라 메리 여왕의 남편인 아들 펠리페에게 넘겼다. 펠리페는 이미 밀라노·시칠리아·나폴리를 다스렸고, 시칠리아 왕이라는 칭호에 예루살렘 왕의 칭호를 결합했던 프리드리히 2세의 후계자로서 예루살렘 왕을 자칭했다.

판독 결과: 행 끝과 다음 쪽 Jerusalem을 확인했다. our Queen Mary는 영국인 저자의 독자를 향한 표현이다. 1555년 양도 대상과 예루살렘 칭호의 설명은 저자 문장 그대로 유지했다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-04. 제11절, 종교개혁 사상의 억압

- 위치: 인쇄186~187 / 기존 PDF203~204 / 새 PDF202~203.
- 이전 표시: `[문맥상 추정: 개혁 사상은 중산층 사이에, 특히 나폴리에서 빠르게 퍼졌다. 이단 혐의를 받은 이들 가운데 일부는 잉글랜드나 독일, 또는 스위스의 개신교 도시와 지역으로 피신했다. 다른 이들은 재산을 잃고 고문과 죽음을 당했다. 로마와 대부분의 다른 지역에서는 이단자를 불태웠고, 베네치아에서는 물에 빠뜨렸으며, 칼라브리아에서는 학살했다. 새로운 견해는 완전히 뿌리 뽑혔다. 그러나 피에몬테의 발도파는 여전히 그것을 지켰다.]`

확인한 영문:

> The Reformed opinions had spread rapidly among the middle class, especially in Naples. Some of those who were suspected of heresy took shelter in England or Germany, or in the Protestant cities and lands of the Swiss; others suffered the loss of their goods, torture, and death. In Rome, and in most other places, heretics were burned; in Venice they were drowned; in Calabia they were massacred. The new opinions were completely stamped out. They were, however, still held by the Waldenses of Piedmont.

수정 한국어(병합 전 교체 후보):

개혁 사상은 중산층 사이에, 특히 나폴리에서 빠르게 퍼졌다. 이단 혐의를 받은 이들 가운데 일부는 잉글랜드나 독일, 또는 스위스의 개신교 도시와 지역으로 피신했다. 다른 이들은 재산을 잃고 고문과 죽음을 당했다. 로마와 대부분의 다른 지역에서는 이단자를 불태웠고, 베네치아에서는 물에 빠뜨렸으며, 칼라브리아에서는 학살했다. 새로운 견해는 완전히 뿌리 뽑혔다. 그러나 피에몬테의 발도파는 여전히 그것을 지켰다.

판독 결과: 왼쪽 결손이 없는 새 스캔에서 The Reformed opinions부터 Waldenses까지 확인했다. 영문 인쇄는 Calabia이며 Calabria로 임의 전사하지 않았다. 기존 한국어 지명 ‘칼라브리아’는 유지한다. 종교 집단에 대한 포괄적 단정은 사료 검증과 별개다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-05. 제11절, 발도파의 명칭과 신앙

- 위치: 인쇄187 / 기존 PDF204 / 새 PDF203.
- 이전 표시: `[문맥상 추정: 이 교파는 12세기 말 리옹의 상인 피터 왈도에게서 이름을 얻었다고 하지만 그 이전부터 존재했을 수도 있다. 피터가 발도파의 견해를 받아들이면서 ‘왈도’라는 별명을 얻었을 가능성이 더 크다. 이름의 기원은 말하기 어렵다. 아마 발레·왈롱·웨일스와 같은 어원으로, 발도파가 알프스의 독일인 주민에게 외국인이었다는 뜻일지도 모른다. 피에몬테 발도파는 자신들의 선조가 산맥의 프로방스 쪽에 살며 알비파라 불린 분파보다 더 순수한 신앙을 지켰고, 자기 언어로 성경을 읽어 순결과 진실의 교훈을 배웠다고 믿는다. 그들은 주로 서알프스의 계곡에 살았으며 16세기 중엽까지 수가 크게 늘었다.]`

확인한 영문:

> This sect is said to have taken its name from Peter Waldo, a merchant of Lyons, who lived at the end of the twelfth century, but it may have existed before that time. It is more likely that Peter received the nickname of Waldo, when he adopted the opinions of the Waldenses. It is hard to say how the name arose. Perhaps it is akin to Valais, Walloon and Wales, and signifies that the Waldenses were foreigners to the German dwellers in the Alps. The Waldenses of Piedmont believe that their forefathers held a purer faith than those sectaries on the Provençal side of the mountains who were called Albigenses; that they read the Bible in their own tongue, and from it learned lessons of purity and truth. They dwelt for the most part in the valleys of the Western Alps. By the middle of the sixteenth century they had much increased in number.

수정 한국어(병합 전 교체 후보):

이 교파는 12세기 말 리옹의 상인 피터 왈도에게서 이름을 얻었다고 하지만 그 이전부터 존재했을 수도 있다. 피터가 발도파의 견해를 받아들이면서 ‘왈도’라는 별명을 얻었을 가능성이 더 크다. 이름의 기원은 말하기 어렵다. 아마 발레·왈롱·웨일스와 관련된 말로서, 발도파가 알프스의 독일인 주민에게 외국인이었다는 뜻일지도 모른다. 피에몬테 발도파는 자신들의 선조가 산맥의 프로방스 쪽에 살며 알비파라 불린 분파보다 더 순수한 신앙을 지켰고, 자기 언어로 성경을 읽어 순결과 진실의 교훈을 배웠다고 믿는다. 그들은 주로 서알프스의 계곡에 살았으며 16세기 중엽까지 수가 크게 늘었다.

판독 결과: Peter Waldo, Lyons, Valais, Walloon, Wales 및 추정형 may, more likely, Perhaps가 모두 읽힌다. 어원을 확정된 사실로 올리지 않았다. 기존 ‘같은 어원’은 원문의 akin에 맞춰 ‘관련된 말’로 조금 완화한다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-06. 제11절, 사보이 공작과 발도파

- 위치: 인쇄187 / 기존 PDF204 / 새 PDF203.
- 이전 표시: `[문맥상 추정: 사보이 공작 에마누엘레 필리베르토는 이 발도파를 정치적으로 골칫거리로 여겼다. 이 이유에다 프랑스와 에스파냐의 진압 요구까지 받아 그들과 전쟁을 벌였다. 짧은 싸움 끝에 공작은 일정한 영토 경계 안에서 그들 자신의 예배를 허락했다. 이탈리아 나머지 지역에서는 옛 종교가 다시 예전처럼 강해졌고 이냐시오 로욜라가 창설한 거대한 영적 군대가 이를 지키고 넓혔다.]`

확인한 영문:

> Emmanuel Filibert, Duke of Savoy, found these Waldenses politically troublesome. For this reason, and because he was urged to suppress them by France and Spain, he made war upon them. After a short struggle the Duke allowed them to follow their own worship within certain boundaries of territory. In the rest of Italy the old religion became as strong as ever, and was defended and spread by the great spiritual army founded by Ignatius Loyola.

수정 한국어(병합 전 교체 후보):

사보이 공작 에마누엘레 필리베르토는 이 발도파를 정치적으로 골칫거리로 여겼다. 이 이유에다 프랑스와 에스파냐의 진압 요구까지 받아 그들과 전쟁을 벌였다. 짧은 싸움 끝에 공작은 일정한 영토 경계 안에서 그들 자신의 예배를 허락했다. 이탈리아 나머지 지역에서는 옛 종교가 다시 예전처럼 강해졌고 이냐시오 로욜라가 창설한 거대한 영적 군대가 이를 지키고 넓혔다.

판독 결과: Waldenses, because, he, allowed, boundaries, became, the의 잘린 시작부가 복구된다. 예배 허용의 영토 제한도 원문과 일치한다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 09-07. 제11절, 카를로 보로메오의 친족관계

- 위치: 인쇄187~188 / 기존 PDF204~205 / 새 PDF203~204.
- 이전 표시: `[문맥상 추정: 북부의 개혁 작업은 카를로 보로메오가 수행했다. 이 뛰어난 인물은 교황 바오로 4세의 조카였다. 그는 이 친족관계를 세속적 출세의 수단으로 삼는 대신 오직 선을 행하는 수단으로 썼다.]`

확인한 영문:

> The work of reformation was carried on in the North by Carlo Borromeo. This remarkable man was the nephew of Pope Paul the Fourth. Instead of making this relationship a means of temporal advancement, he only used it as a means of doing good.

수정 한국어(병합 전 교체 후보):

북부의 개혁 작업은 카를로 보로메오가 수행했다. 이 뛰어난 인물은 교황 바오로 4세의 조카였다. 그는 이 친족관계를 세속적 출세의 수단으로 삼는 대신 오직 선을 행하는 수단으로 썼다.

판독 결과: 새 스캔에도 nephew of Pope Paul the Fourth라고 인쇄되어 있다. 원저의 친족관계 진술은 ‘바오로 4세의 조카’이며 ‘비오 4세’로 조용히 바꾸지 않았다. 관계의 역사적 정확성은 전문 감수 과제다. 인쇄188의 of doing good까지 직접 연결했다.

남은 불확실성: 이 구절의 문자 결손은 해소되었다. 역사적 주장·연대·인물관계의 정확성까지 검증했다는 뜻은 아니다.

## 상태와 적용 한계

이 파일은 손상 복구에 한정한 대조초안이다. 원문과 뜻이 일치하는 기존 번역은 불필요하게 다시 쓰지 않았다. 기존 본문의 추정 표지는 아직 그대로이므로 이 기록을 검토한 뒤 별도 병합해야 한다. 역사 오류가 의심되어도 저자의 문장을 다른 역사 사실로 바꾸지 않았다. 전문가 역사 감수와 한국어 최종 교열은 미완료다. 476년 이전 고대사·1874년 이후 현대사 공백과 파생 세계관의 구분은 유지한다. 앱·DB·학습 코퍼스 통합, 커밋·푸시는 하지 않았다.
