# Server SDKs in other languages

Node lives in `packages/sdk-node`. These implement the same three operations (fetch a verified event, verify a webhook
signature, open a sealed result) and are tested against the same vectors (`test-vectors/vectors.json`, produced by the
server's own code with `node sdks/test-vectors/generate.mjs`).

| Language | Folder | Dependencies |
| --- | --- | --- |
| Python 3.9+ | `python/` | none (`cryptography` for sealed results) |
| PHP 8.1+ | `php/` | built-in extensions |
| Java 11+ | `java/` | none |
| Go 1.21+ | `go/` | none |
| Kotlin / Android | `kotlin/` | none; core tested against the TypeScript payloads, Android glue unverified |
| Swift / iOS | `swift/` | none; core tested in CI on macOS, device glue unverified |
| Dart / Flutter | `flutter/` | none; core tested against the TypeScript payloads, device glue unverified |
| Ruby 3.0+ | `ruby/` | none; tested in CI |
| .NET 8 | `dotnet/` | none; tested in CI |

Any other language can call the REST API directly: `GET /v1/events/:eventId` with `Authorization: Bearer sk_...`, and
HMAC-SHA256 over `timestamp + "." + body` for webhooks (see docs/api.md).

Run every SDK whose toolchain is installed: `node sdks/run-tests.mjs`.
