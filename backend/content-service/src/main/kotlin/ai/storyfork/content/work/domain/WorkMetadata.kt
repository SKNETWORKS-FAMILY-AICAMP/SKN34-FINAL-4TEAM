package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.checkContent

/** 작품 등록 시 고르는 유형. 외부 2차 창작물은 무료 공개만 가능하다(UC-23, BR-09). Fork는 별도 경로다. */
enum class CreationType(val code: String) {
    ORIGINAL("original"),
    EXTERNAL_DERIVATIVE("external_derivative"),
}

/** 초기 공용 장르 목록. 프론트 데모 `LibraryUseCase.NOVEL_GENRES`와 같은 값이며 genre 테이블 fresh 시드(V1)와 일치해야 한다(#70 확정). */
val WORK_GENRES: List<String> = listOf(
    "판타지", "현대판타지", "무협", "선협", "퓨전", "로맨스", "로맨스판타지", "BL", "GL", "현대",
    "시대물", "역사", "대체역사", "SF", "게임", "스포츠", "드라마", "미스터리", "추리", "스릴러",
    "공포", "오컬트", "액션", "전쟁·밀리터리", "라이트노벨", "학원", "일상", "고전", "일반소설", "기타",
)

const val MAX_WORK_GENRES = 2
const val MAX_WORK_HASHTAGS = 10

data class WorkMetadata(val type: CreationType, val genres: List<String>, val hashtags: List<String>)

/**
 * 작품 등록 입력을 검증한다(#49). 하나라도 어긋나면 ContentFailure(422)를 던지고 아무것도 만들지 않는다.
 * 권리 확인은 등록 요건이며 플랫폼이 작품별 권리를 직접 검증했다는 뜻이 아니다(DEC-38).
 * 해시태그의 유해 콘텐츠 1차 필터(UC-14)와 글자 수 제한은 정책이 정해지지 않아 여기서 다루지 않는다.
 */
fun validateWorkMetadata(typeName: String?, genres: List<String>, hashtags: List<String>, rightsConfirmed: Boolean): WorkMetadata {
    val type = CreationType.entries.firstOrNull { it.name == typeName }
    checkContent(type != null, message = "작품 유형을 선택해 주세요.")
    checkContent(genres.size in 1..MAX_WORK_GENRES, message = "장르는 1개 이상 2개 이하로 선택해 주세요.")
    checkContent(genres.all { it in WORK_GENRES } && genres.toSet().size == genres.size, message = "승인된 장르 목록에서 서로 다른 장르를 골라 주세요.")
    val tags = hashtags.map { it.trim() }
    checkContent(tags.size <= MAX_WORK_HASHTAGS, message = "해시태그는 최대 ${MAX_WORK_HASHTAGS}개까지 등록할 수 있어요.")
    checkContent(tags.none { it.isEmpty() }, message = "비어 있는 해시태그는 등록할 수 없어요.")
    checkContent(rightsConfirmed, message = "작품 등록을 위해 권리 확인이 필요해요.")
    return WorkMetadata(type!!, genres, tags)
}
