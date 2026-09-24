# Verification for a Bitwright worker, in one step and a few lines of output.
#
#   powershell -NoProfile -File .agent-crew/verify.ps1 -Rust [-Filter mcp::]
#   powershell -NoProfile -File .agent-crew/verify.ps1 -Ts
#   powershell -NoProfile -File .agent-crew/verify.ps1 -Docs
#
# Run from the worktree root. Formats first, then prints only errors, warnings
# and the test summary, so reading the result costs one short tool output.
param([switch]$Rust, [switch]$Ts, [switch]$Docs, [string]$Filter = "")

$root = Get-Location
$failed = $false

if ($Rust) {
    Push-Location "$root\apps\desktop\src-tauri"
    cargo fmt 2>&1 | Out-Null
    $build = cargo build --color never 2>&1 | Out-String
    $problems = ($build -split "`n") | Where-Object { $_ -cmatch '^(error|warning)' }
    if ($LASTEXITCODE -ne 0 -or $problems) {
        Write-Output "== cargo build: FAILED or warnings"
        ($build -split "`n") | Where-Object { $_ -match '^(error|warning)|^\s+-->|^\s+\|' } | Select-Object -First 60
        $failed = $true
    } else {
        Write-Output "== cargo build: clean"
        # CI runs clippy with warnings as errors, so the worker does too.
        # Machine-applicable suggestions are applied first: they cost the
        # worker nothing to take and a turn each to type.
        cargo clippy --fix --allow-dirty --allow-staged --all-targets 2>&1 | Out-Null
        $clippy = cargo clippy --color never --all-targets -- -D warnings 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-Output "== cargo clippy: FAILED"
            ($clippy -split "`n") | Where-Object { $_ -cmatch '^(error|warning)|^\s+-->|^\s+\||= help' } | Select-Object -First 60
            $failed = $true
        } else {
            Write-Output "== cargo clippy: clean"
        }
        $test = cargo test --color never $Filter 2>&1 | Out-String
        $lines = $test -split "`n"
        $lines | Where-Object { $_ -cmatch '^test result|^failures:|^---- |^error|panicked at' } | Select-Object -First 40
        if ($LASTEXITCODE -ne 0 -or $test -cmatch 'test result: FAILED|^error') { $failed = $true }
        if ($failed) {
            Write-Output "== failure detail"
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($lines[$i] -cmatch 'panicked at') {
                    # The message is on the lines after the location; show them.
                    $lines[$i..([Math]::Min($i + 4, $lines.Count - 1))] | Where-Object { $_.Trim() -and $_ -cnotmatch '^note: run with' }
                }
            }
        }
    }
    Pop-Location
}

if ($Ts) {
    $changed = git ls-files -mo --exclude-standard -- apps/desktop/src | Where-Object { $_ -match '\.(ts|tsx|json|css)$' }
    if ($changed) { npx prettier --write $changed 2>&1 | Out-Null }
    $tc = npm run -s typecheck 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Output "== typecheck: FAILED"; ($tc -split "`n") | Select-Object -First 40; $failed = $true }
    else { Write-Output "== typecheck: clean" }
    $lint = npm run -s lint 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Output "== lint: FAILED"; ($lint -split "`n") | Where-Object { $_ -match 'error|warning|\.tsx?$' } | Select-Object -First 40; $failed = $true }
    else { Write-Output "== lint: clean" }
    $vt = npm run -s test 2>&1 | Out-String
    $vtLines = ($vt -replace "\x1b\[[0-9;]*m", "") -split "`n"
    if ($LASTEXITCODE -ne 0) {
        Write-Output "== tests: FAILED"
        $vtLines | Where-Object { $_ -cmatch 'FAIL|×|AssertionError|Error:|expected|received|Tests ' } | Select-Object -First 50
        $failed = $true
    } else {
        Write-Output "== tests: $(($vtLines | Where-Object { $_ -cmatch '^\s+Tests ' }) -join ' ')"
    }
}

if ($Docs) {
    $changed = git ls-files -mo --exclude-standard -- README.md docs | Where-Object { $_ -match '\.md$' }
    if ($changed) { npx prettier --write $changed 2>&1 | Out-Null }
    if (-not $changed) { $changed = @("README.md") }
    $check = npx prettier --check $changed 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Output "== prettier: FAILED"; Write-Output $check; $failed = $true }
    else { Write-Output "== markdown: formatted" }
}

# Text damage, stray files and undeclared Rust modules are checked by Agent
# Crew itself after this script (checks in .agent-crew/project.toml).

if ($failed) { Write-Output "RESULT: FAIL" } else { Write-Output "RESULT: PASS" }
