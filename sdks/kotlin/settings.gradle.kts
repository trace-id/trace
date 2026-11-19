rootProject.name = "trace-device"

include(":core")
// The Android module needs the Android SDK. Include it only when the build asks for it: gradle -PwithAndroid ...
if (providers.gradleProperty("withAndroid").isPresent) include(":android")
