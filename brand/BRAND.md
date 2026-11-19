# Trace brand

The product is **Trace**. The organization is `trace-id` on GitHub and npm. Write the name "Trace" in prose and `trace` (lowercase, bold) in the logo. In code it is lowercase: `@trace-id/*`, `TRACE_*`.

Open `brand-sheet.png` for the whole kit at a glance. Everything here is original artwork made for this project.

## The mark

A **T drawn as a device graph**: two browsers meet at one bar, and the stem lands on the same node. It says what the product does (recognise the same device wherever it appears) in one shape.

| File | Use |
| --- | --- |
| `mark-ink.svg`, `mark-lime.svg`, `mark-white.svg` | The mark alone, transparent background |
| `avatar-dark.svg`, `avatar-dark-500.png` | **Default profile picture** (GitHub, npm): lime on ink |
| `avatar-light.svg`, `avatar-light-500.png` | Light surfaces |
| `avatar-cobalt.svg`, `avatar-cobalt-500.png` | Campaigns, conference badges |
| `icon.svg` | Favicon and app icon (round) |
| `lockup-ink.svg`, `lockup-white.svg` | Mark plus the `trace` wordmark |
| `social-preview.png` | GitHub social preview, 1280 x 640 |

Rules
- Keep clear space around the mark of at least half the width of a node circle.
- Minimum size 16 px for the mark, 96 px wide for the lockup.
- Lime only on ink or cobalt. On light backgrounds use the ink mark.
- Do not recolour, outline, rotate, stretch, add effects, or redraw the mark.
- The lockup SVGs name Inter Bold for the wordmark; where Inter is not installed they fall back to a system sans. Use the PNG or the website's own lockup when the exact typeface matters.

## Colour

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#111318` | Backgrounds, avatar, text on light |
| Lime | `#E2F04F` | The mark on dark, small highlights. Never body text |
| Cobalt | `#2B3FD6` | Links, primary accents, charts |
| Paper | `#F8F8F6` | Page background |
| Low risk | `#1F7A52` | Low scores |
| Medium risk | `#9A5B00` | Medium scores |
| High risk | `#C2321F` | High scores |

Risk colours mean risk and nothing else. Do not use red or amber for decoration.

## Type

- **Inter** 400, 500, 600, 700 for headlines and interface. Bold, tight tracking (-0.02 em) for headlines.
- **Fragment Mono** 400 for ids, code and small uppercase labels.

## Voice

Plain, specific and honest. Say what Trace does, then what it cannot do.
- Prefer "reasons" to "magic". Every score comes with the reasons behind it.
- Never promise accuracy figures you have not measured on real traffic; label synthetic numbers as synthetic.
- No fear language ("stop all fraud"). Fraud is reduced, not eliminated.
- Self-hosted and open source are features, so say them early.

## Descriptions (copy and paste)

**GitHub organization description** (max 160 characters)

> Open-source, self-hosted device identification and fraud signals. SDKs for web, mobile and servers.

**Tagline**

> Know who is really on the other side of the request.

**One paragraph**

> Trace recognises returning devices across cleared cookies, private windows and browser switches, and scores each visit for bots, VPNs, tampering and shared or farmed accounts. Every score comes with the reasons behind it. It is open source and runs on your own infrastructure.

**npm organization description**

> Trace: self-hosted device identification and fraud signals. Browser, React, Vue, Svelte, Angular, Solid, Next.js, Nuxt and Node SDKs.

**Short (repo, package.json, social bios, up to 80 characters)**

> Self-hosted device identification and fraud signals.

## GitHub profile (`.github/profile/README.md`)

Create a public repository named `.github` in the organization and put `org-profile.md` (this folder) at `profile/README.md`. It is shown at the top of the organization page.

## Setting it up

GitHub organization: Settings > Profile
- Profile picture: `avatar-dark-500.png`
- Description, URL, email, location: as above (use a project email, not a personal one)
- Social preview (per repository, Settings > General): `social-preview.png`

npm organization: Settings
- Avatar: `avatar-dark-500.png`
- Description: the npm text above
- Enable two-factor authentication for publishing, and require it for the organization.
