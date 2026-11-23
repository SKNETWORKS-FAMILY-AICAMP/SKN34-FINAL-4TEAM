"""공개 세트 원천 정리(orig_collect): SCP 문서 HTML·위키문헌 근대 소설의 본문만 남기는 순수 함수."""

import orig_collect as oc

SCP_PAGE = '''<html><body><div id="page-content">
<style>.x{color:red}</style><div style="display: none"><div class="code"><pre>@import url('x');</pre></div></div>
<div class="close">close</div><div>정보</div><div>X</div>
<div class="title">제목: 환등 이야기</div><div>저자: 아무개</div><div>노클립 하기</div>
<p>첫 문단이다.<sup class="footnoteref"><a href="#f1">1</a></sup></p>
<p>"가자." 그가 말했다.</p>
<div class="collapsible-block"><div class="collapsible-block-folded"><a class="collapsible-block-link">+ 펼치기</a></div>
<div class="collapsible-block-content" style="display:none">숨은 글</div></div>
<p>《이전|허브|다음》</p><p>[[include :scpko:component:glasses-footer</p><p>댓글 보기</p>
</div><div id="page-info-break"></div><div>아래 바닥 글</div></body></html>'''


def test_scp_text_keeps_story_only():
    got = oc.scp_page(SCP_PAGE)
    assert got['title'] == '환등 이야기' and got['author'] == '아무개'
    assert got['text'] == '첫 문단이다.\n"가자." 그가 말했다.'   # 숨김·코드·각주·접기 링크·바닥 글·이전/다음 줄이 모두 빠진다


def test_scp_page_without_credit_has_no_author():
    page = '<div id="page-content"><p>이야기뿐이다.</p></div><div id="page-info-break"></div>'
    got = oc.scp_page(page)
    assert got['author'] is None and got['text'] == '이야기뿐이다.'


RAW_WIKI = '''{{머리말
|제목 = 운수 좋은 날
|지은이 = [[저자:현진건|현진건]]
}}
<center>🙝🙟</center>

첫 문단이다.

“두 번째.”

{{위키백과|운수 좋은 날}}

== 라이선스 ==
{{PD-old-50}}

[[분류:단편소설]]
'''


def test_wikisource_work_meta_and_text():
    got = oc.wikisource_work(RAW_WIKI)
    assert got == {'author': '현진건', 'license': 'PD-old-50', 'text': '첫 문단이다.\n\n“두 번째.”'}


def test_episode_count_scales_with_length_and_stays_in_range():
    assert oc.episode_count(2_000) == 3 and oc.episode_count(9_000) == 3 and oc.episode_count(20_000) == 7 and oc.episode_count(200_000) == 12
