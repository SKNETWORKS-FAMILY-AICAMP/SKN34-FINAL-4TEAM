package ai.storyfork.content.manuscript.domain

import ai.storyfork.content._common.exception.ContentFailure

/** 한 번에 가져오거나 확정할 수 있는 회차 수. */
const val MAX_EPISODES = 300

fun tooManyEpisodes(count: Int) = ContentFailure(422, "한 번에 ${MAX_EPISODES}회차까지 가져올 수 있어요. 이 파일은 ${count}회차예요.")

/** 본문에서 이미지가 들어갈 자리다. 이미지는 항상 이 문자 하나만 있는 줄이며 ParsedEpisode.images와 순서가 같다. */
const val IMAGE_PLACEHOLDER = '\uE000'

/** 저장된 본문의 `[[image:<UUID>]]` 표식 길이. 본문 40,000자 한도를 표식까지 세어 미리 검사하는 데 쓴다. */
const val IMAGE_MARKER_LENGTH = 46

/** EPUB 안(가져오기)이나 저장소(내보내기)의 이미지 한 장. mediaType은 image/png·image/jpeg 중 하나고 altText는 `img alt`다. */
class ParsedImage(val bytes: ByteArray, val mediaType: String, val altText: String = "")

/**
 * 파일에서 읽은 회차 후보다. from(포함)·to(제외)는 [Manuscript.unit] 기준 위치이고,
 * error가 있으면 그 단위를 읽지 못한 것이다. missingImages는 지원하지 않거나 읽지 못해 뺀 이미지 수다.
 */
class ParsedEpisode(
    val title: String, val from: Int, val to: Int, val text: String,
    val images: List<ParsedImage> = emptyList(), val missingImages: Int = 0, val error: String? = null,
) {
    /** 이미지 표식까지 센 본문 길이. 저장 한도(40,000자)와 같은 기준이다. */
    val bodyLength get() = text.length + images.size * (IMAGE_MARKER_LENGTH - 1)
}

/** 파싱한 원고 파일. 미리보기는 [episodes]를, 확정은 조정한 범위를 [episode]로 다시 합쳐 쓴다. */
interface Manuscript {
    val format: String
    /** 위치 단위. TXT는 `line`, EPUB은 `chapter`(spine 항목)다. */
    val unit: String
    val unitCount: Int
    /** 기본 회차 구분. */
    val episodes: List<ParsedEpisode>
    /** [from, to) 단위를 한 회차로 합친다. 범위가 0..unitCount 안인지는 호출자가 확인한다. */
    fun episode(from: Int, to: Int): ParsedEpisode
}

/** 저장된 본문의 이미지 표식 `[[image:<id>]]`. 첫 그룹이 이미지 ID다. */
val IMAGE_MARKER = Regex("\\[\\[image:([^\\]]+)\\]\\]")

/** 내보낼 회차 하나. body에는 이미지 표식이 그대로 들어 있다. */
class ExportChapter(val number: Int, val title: String, val body: String)
