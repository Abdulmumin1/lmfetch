# Changelog
Note: version releases in the 0.x.y range may introduce breaking changes.

## 0.3.6

- patch:  fix: codesigning

## 0.3.5

- patch: feat(ci): switch to PyInstaller for faster builds and stability

## 0.3.4

- patch:  fix(ci): ad-hoc sign macOS binaries to resolve slow startup (Gatekeeper)

## 0.3.3

- patch: fix(ci): expose uv venv to PATH so Nuitka can find dependencies

## 0.3.2

- patch: stable release

## 0.3.1

- patch: fix: retry release build for native Nuitka binaries (v0.3.0 artifacts were missing)

## 0.3.0

- minor: feat: Switch to Nuitka for native compilation (8x faster startup), added lazy loading, and optimized CI caching

## 0.2.0

- minor: feat: native compilation support via Cython and CI artifact fixes

## 0.1.2

- patch: perf: improved startup time by moving to dynamic import

## 0.1.1

- patch: fix: resolved cli argument error handling that caused 'Error: 0' output

## 0.1.0

- minor: lmfetch clis & release cycle
