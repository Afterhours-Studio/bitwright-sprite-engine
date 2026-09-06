# 2. Choose Tauri over Electron

Date: 2026-01-15

## Status

Accepted

## Context

Bitwright is a desktop application with a web-technology interface, on Windows,
macOS, and Linux. The shell framework decides the download size, the memory
footprint, the security posture, and how hard the build is.

Three options were considered.

**Electron** bundles Chromium and Node. It is the most widely used option, has
the deepest ecosystem, and renders identically everywhere because every install
carries the same browser. It also costs 120 to 180 MB per application before any
of our own code, and around 200 MB of resident memory for an idle window.

**Tauri 2** uses the operating system's own webview: WebView2 on Windows,
WKWebView on macOS, WebKitGTK on Linux. A bundle is 8 to 15 MB and an idle
window sits at 60 to 90 MB. The native side is Rust. The cost is that the
webview differs per platform, so rendering has to be tested on each.

**A native toolkit** per platform would be smallest and fastest, and would mean
writing the interface three times. For a two person project that is not
affordable.

Two things about this application weighted the decision.

First, size is already a problem here. The models are gigabytes. Adding 150 MB
of browser to a download whose real payload is a 4 GB model is bad, but adding
it to an application that is otherwise 12 MB is worse: it becomes most of what
the user waits for on the first install.

Second, the application already needs a Rust or C layer. It manages a child
process, probes for a GPU driver, and applies a platform window effect. Electron
would need native modules for that, compiled per platform. Tauri makes it
ordinary code.

Against Tauri: WebKitGTK on Linux lags Chromium on CSS, the ecosystem is
younger, and the team needs Rust.

## Decision

Bitwright uses Tauri 2 as its shell.

The Rust side owns the window, the custom decorations, the platform background
effect, the GPU probe, and the lifetime of the Python sidecar. It contains no
generation logic.

The frontend targets what the oldest supported webview implements, which in
practice means WebKitGTK 4.1. The design uses no feature newer than that, and
the interface is checked on all three platforms in CI.

## Consequences

Positive:

- A bundle of roughly 12 MB rather than 150 MB, which matters most on the first
  install, before any model has been downloaded.
- Around a third of the idle memory, leaving more for the model.
- Process management, the GPU probe, and window effects are ordinary Rust
  rather than a native module per platform.
- The webview has no filesystem or network reach beyond what a capability
  grants it, and the asset protocol is not enabled at all.
- Rust's error handling suits a shell whose job is largely to fail clearly.

Negative:

- Three webview engines to test. A CSS feature can work on two and not the
  third, and WebKitGTK is usually the one behind.
- Contributors need a Rust toolchain, and the native build is slower than a
  JavaScript one.
- A smaller ecosystem: some Electron problems have a well-worn answer and the
  Tauri equivalent has to be written.
- Windows requires the WebView2 runtime. It ships with Windows 11 and current
  Windows 10, and the installer fetches it otherwise, which is one more failure
  mode on a locked-down machine.

Neutral:

- Custom window decorations follow from this choice; see
  [decision 0006](0006-custom-window-decorations.md).
- The Rust side is deliberately thin. Moving to another shell later would mean
  rewriting roughly six hundred lines, not the application.
