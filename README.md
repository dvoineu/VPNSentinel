# VPN Sentinel for macOS

[Website (EN)](https://dvoineu.github.io/VPNSentinel/) · [Русская версия](https://dvoineu.github.io/VPNSentinel/?lang=ru) · [Downloads & Release Notes](https://github.com/dvoineu/VPNSentinel/releases)

A macOS menu bar sentinel for the direct internet exit: when your VPN or proxy drops, it is designed to keep direct traffic closed and tell you once. Early prototype — traffic blocking does not work yet. This public repository hosts the bilingual website (`site/`) and the Apple-notarized demo archives in GitHub Releases.

## Verification

Every published archive in [GitHub Releases](https://github.com/dvoineu/VPNSentinel/releases) is signed with Developer ID Application, notarized by Apple, and accompanied by `SHA256SUMS` and `INSTALL.txt`.

```bash
shasum -a 256 -c SHA256SUMS
```

## Maintaining the site

Preview locally with `python3 -m http.server --directory site 8080` and run `python3 Tests/site_test.py` before publishing changes.
