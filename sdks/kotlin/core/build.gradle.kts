plugins {
    kotlin("jvm") version "1.9.24"
    application
}

group = "io.github.trace-id"
version = "0.1.0"

repositories { mavenCentral() }

kotlin { jvmToolchain(11) }

// The tests are a plain main(): no test framework. `gradle :core:run` runs them from the sdks/kotlin folder.
sourceSets { main { kotlin.srcDir("src/test/kotlin") } }

application {
    mainClass.set("dev.trace.device.TestMainKt")
}

tasks.named<JavaExec>("run") { workingDir = rootProject.projectDir }
