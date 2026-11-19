plugins {
    id("com.android.library") version "8.5.2"
    kotlin("android") version "1.9.24"
}

android {
    namespace = "dev.trace.device.android"
    compileSdk = 34
    defaultConfig { minSdk = 23 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions { jvmTarget = "11" }
}

dependencies { api(project(":core")) }
