package ai.storyfork.operations

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
class OperationsServiceApplication

fun main(args: Array<String>) {
    runApplication<OperationsServiceApplication>(*args)
}
