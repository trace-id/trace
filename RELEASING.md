# Releasing Trace

A release is one tag. Pushing `v0.1.0` runs `.github/workflows/release.yml`, which checks that every package version
equals the tag, then publishes in parallel:

| What | Where | Users install with |
| --- | --- | --- |
| `@trace-id/signals`, `sdk-js`, `sdk-react`, `sdk-vue`, `sdk-svelte`, `sdk-node`, `mcp`, `proxy-cloudflare` | npm, with provenance | `npm install @trace-id/sdk-js` |
| Python SDK | PyPI (`trace-device`) | `pip install trace-device` |
| Server and dashboard images (amd64 + arm64, with SBOM) | `ghcr.io/<owner>/trace-server`, `trace-dashboard` | `docker pull` |

The browser SDK is also on jsDelivr and unpkg automatically once it is on npm
(`https://cdn.jsdelivr.net/npm/@trace-id/sdk-js@0.1.0/dist/browser/sdk.global.js`).

No registry tokens are stored: npm and PyPI trust the workflow through OpenID Connect, and images are pushed with the
repository's own token.

## One-time setup (the owner)

1. **GitHub**: push the repository. In Settings, Environments, create `npm` and `pypi` (optionally with required
   reviewers, so every publish waits for a click).
2. **npm**: create the `trace` organisation on npmjs.com (free for public packages). If the name is taken, pick another
   scope and replace `@trace-id/` everywhere in one pass. For each package, under Settings, Trusted publishing, add GitHub
   Actions with this repository, workflow `release.yml` and environment `npm`. A first publish of a new package may need
   a token: create a granular automation token, save it as the `NPM_TOKEN` repository secret for that one release, then
   delete it.
3. **PyPI**: on pypi.org, Publishing, add a pending trusted publisher for project `trace-device`, this repository,
   workflow `release.yml`, environment `pypi`.
4. **Container images**: nothing to set up. After the first release, make the two packages public under the
   organisation's Packages tab.
5. **Enable two-factor authentication** on npm, PyPI and GitHub.

## Each release

1. Set the version everywhere (the check job fails on any mismatch):
   ```sh
   npm version 0.2.0 --workspaces --no-git-tag-version
   # and sdks/python/pyproject.toml: version = "0.2.0"
   ```
2. Commit, then tag and push the tag:
   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```
3. Watch the Release workflow. Re-running it is safe: versions already on npm are skipped.

## Not automated yet

- **PHP (Packagist)** reads `composer.json` from the repository root, so the SDK in `sdks/php` needs its own small
  repository (a read-only split, for example with `splitsh-lite`) that Packagist watches.
- **Java (Maven Central)** needs a verified namespace and GPG-signed artifacts. The group is `io.github.trace-id`, which
  Central verifies by asking you to create a temporary public repository in the `trace-id` organization. (The Java
  package names in the source stay `dev.trace`; only the Maven group has to match the verified namespace.) Until then, users can copy the two source files; they have no
  dependencies.
