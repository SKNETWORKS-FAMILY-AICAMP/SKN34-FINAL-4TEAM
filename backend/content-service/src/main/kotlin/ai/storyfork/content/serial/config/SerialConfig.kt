package ai.storyfork.content.serial.config

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content._common.helper.buildRestClient
import ai.storyfork.content._common.helper.validatePositiveDuration
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.domain.EPISODE_READ_TIMEOUT_MINUTES
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.web.client.RestClient

/** AI 자율 연재(UC-18)의 일정 점검 스케줄러와 AI 클라이언트다. */
@Configuration(proxyBeanMethods = false)
class SerialConfig {
    /**
     * 점검 전용 스케줄러다(기본 스케줄러를 바꾸지 않는다). 회차 실행은 AI를 기다리는 동안 이 스레드를 쥐므로 예약 발행·알림 발행 같은 짧은 작업이 같이 막히지 않게 따로 둔다.
     * ponytail: 스레드 하나라 여러 게시판은 차례로 실행한다(회차 실행 하나가 최대 35분이라 뒤에 줄 선 게시판은 그만큼 늦고, 정한 시각부터 1시간 안이라는 일정 창을 넘기면 그날은 건너뛴다). 동시에 실행해야 하면 풀 크기를 늘리고 실행을 분리한다.
     */
    @Bean("serialScheduler", defaultCandidate = false)
    fun serialScheduler() = ThreadPoolTaskScheduler().apply { setThreadNamePrefix("serial-") }

    /**
     * 시뮬레이션은 기존 생성 클라이언트와 같은 읽기 한도(AI_GENERATION_READ_TIMEOUT, 기본 75초: 공개 프록시 90초 안에 끝낸다)로 회원 Bearer를 전달해 부르고,
     * 회차 실행은 일정 점검에서 부르므로 사용자 토큰 없이 35분까지 기다린다(AI 최악 1,810초 ≈ 30분: 종합·기획·시뮬레이션 계획·장면(시간 상한 20분)·집필·검수·재작성·재검수).
     * 이 한도는 running 정체 정리 기준(STALE_RUNNING_MINUTES, 45분)보다 짧아야 한다(SerialRulesTest가 고정).
     */
    @Bean
    fun serialAiClient(builder: RestClient.Builder, properties: AiServiceClientProperties,
        @Value("\${AI_GENERATION_READ_TIMEOUT:75s}") simulationTimeout: Duration, @Value("\${INTERNAL_TOKEN:}") token: String): SerialAiClient {
        validatePositiveDuration(simulationTimeout, "AI_GENERATION_READ_TIMEOUT")
        return SerialAiClient(
            buildRestClient(builder.clone(), properties.baseUrl, properties.connectTimeout, simulationTimeout, forwardUser = true),
            buildRestClient(builder.clone(), properties.baseUrl, properties.connectTimeout, Duration.ofMinutes(EPISODE_READ_TIMEOUT_MINUTES)),
            token,
        )
    }
}
