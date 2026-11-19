// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "TraceDevice",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "TraceDevice", targets: ["TraceDevice"])],
    targets: [
        .target(name: "TraceDevice"),
        .testTarget(name: "TraceDeviceTests", dependencies: ["TraceDevice"]),
    ]
)
