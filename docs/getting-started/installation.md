# Installation

How to install Bitwright on Windows, macOS, and Linux, and what to do when the
operating system blocks the first launch.

Check [System requirements](system-requirements.md) first. Releases are on the
[releases page](https://github.com/Afterhours-Studio/bitwright-sprite-engine/releases).

No model weights are included in any of these downloads. The first generation
fetches the model you selected, under its own licence. See
[MODELS.md](../../MODELS.md).

## Windows

1. Download `Bitwright_<version>_x64-setup.exe` from the releases page.
2. Run it. Windows SmartScreen may warn that the publisher is unrecognised,
   because the pre-1.0 builds are not code signed. Choose **More info**, then
   **Run anyway**.
3. The installer adds Bitwright to the Start menu.

The WebView2 runtime is required and is installed automatically if it is
missing. It ships with Windows 11 and with current Windows 10 builds.

To install without the interactive prompts:

```powershell
.\Bitwright_0.0.2_x64-setup.exe /S
```

## macOS

1. Download `Bitwright_<version>_universal.dmg`.
2. Open it and drag Bitwright to Applications.
3. The first launch is blocked, because the pre-1.0 builds are not notarised.
   Open **System Settings**, then **Privacy & Security**, scroll to the message
   about Bitwright, and choose **Open Anyway**.

If Gatekeeper refuses after that, clear the quarantine attribute:

```bash
xattr -dr com.apple.quarantine /Applications/Bitwright.app
```

Run that only on a download you trust and obtained from the releases page.

## Linux

### AppImage

Works on any distribution with FUSE available.

```bash
chmod +x Bitwright_0.0.2_amd64.AppImage
./Bitwright_0.0.2_amd64.AppImage
```

### Debian and Ubuntu

```bash
sudo apt install ./bitwright_0.0.2_amd64.deb
```

### Fedora and RHEL

```bash
sudo dnf install ./bitwright-0.0.2-1.x86_64.rpm
```

If the window fails to open, the WebKit runtime is missing:

```bash
# Debian and Ubuntu
sudo apt install libwebkit2gtk-4.1-0

# Fedora
sudo dnf install webkit2gtk4.1
```

Window blur is not available on Linux. The application detects this and uses
opaque surfaces, which is a visual difference only.

## From source

See [Development setup](../development/setup.md).

## Verifying a download

Every release publishes `SHA256SUMS`. Check your download against it before
running the installer.

```bash
# Linux and macOS
sha256sum --check --ignore-missing SHA256SUMS
```

```powershell
# Windows
Get-FileHash .\Bitwright_0.0.2_x64-setup.exe -Algorithm SHA256
```

## Uninstalling

| Platform | Steps |
| --- | --- |
| Windows | Settings, then Apps, then Bitwright, then Uninstall |
| macOS | Move `/Applications/Bitwright.app` to the Bin |
| Linux (deb) | `sudo apt remove bitwright` |
| Linux (rpm) | `sudo dnf remove bitwright` |
| Linux (AppImage) | Delete the AppImage file |

Uninstalling leaves the model cache in place, because it is large and may be
shared with another tool. Remove it separately:

| Platform | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\studio.afterhours.bitwright` |
| macOS | `~/Library/Application Support/studio.afterhours.bitwright` |
| Linux | `~/.local/share/studio.afterhours.bitwright` |
