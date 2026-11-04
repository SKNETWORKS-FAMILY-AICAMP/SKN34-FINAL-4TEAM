package ai.storyfork.content.context.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import ai.storyfork.content.context.service.dto.*

/** 회차·공개 범위·인물 지식을 적용한 문맥 조회를 제공한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class ContextController(private val service: ai.storyfork.content.context.service.ContextService) {

    /** 작성자의 허용 문맥 DTO를 반환한다. 소유자만 가능하며 범위·문맥 한도 오류는 422다. */
    @GetMapping("/works/{id}/context")
    fun read(@PathVariable id: String,principal: Principal,@Valid @ModelAttribute query: ContextRequest): StoryContextResponse = service.read(id,principal.name,required(query))

    /** 발행 범위의 허용 문맥만 반환한다. 익명 가능, 비공개 작품은 404, 잘못된 범위는 422다. */
    @GetMapping("/public/works/{id}/context")
    fun publicRead(@PathVariable id: String,@Valid @ModelAttribute query: ContextRequest): StoryContextResponse = service.read(id,null,required(query))

    private fun required(query: ContextRequest): ContextRequest {
        if(query.episode==null) throw org.springframework.web.bind.MissingServletRequestParameterException("episode","int")
        return query
    }
}
