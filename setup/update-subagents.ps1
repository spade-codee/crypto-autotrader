# Updates the VoltAgent subagent collection in ~/.claude/agents/
#
# Safe by design: only ever overwrites files whose names come from the upstream
# repo. Your own agents (backend.md, frotend.md, apidesigneer.md, claude.md, and
# anything else you wrote) are never touched and never deleted.

$ErrorActionPreference = 'Stop'

$Repo      = 'https://github.com/VoltAgent/awesome-claude-code-subagents.git'
$CacheDir  = Join-Path $env:USERPROFILE '.claude\.subagent-cache'
$AgentsDir = Join-Path $env:USERPROFILE '.claude\agents'

if (-not (Test-Path $AgentsDir)) {
    New-Item -ItemType Directory -Path $AgentsDir -Force | Out-Null
}

if (Test-Path (Join-Path $CacheDir '.git')) {
    Write-Host 'Pulling latest subagents...'
    git -C $CacheDir fetch --quiet origin
    git -C $CacheDir reset --hard --quiet origin/HEAD
} else {
    Write-Host 'Cloning subagent collection...'
    if (Test-Path $CacheDir) { Remove-Item $CacheDir -Recurse -Force }
    git clone --quiet --depth 1 $Repo $CacheDir
}

$source = Join-Path $CacheDir 'categories'
if (-not (Test-Path $source)) {
    throw "Expected categories/ in $CacheDir but it is missing. Upstream layout may have changed."
}

$copied = 0
Get-ChildItem -Path $source -Recurse -Filter '*.md' |
    Where-Object { $_.Name -ne 'README.md' } |
    ForEach-Object {
        Copy-Item $_.FullName -Destination (Join-Path $AgentsDir $_.Name) -Force
        $copied++
    }

$total = (Get-ChildItem $AgentsDir -Filter '*.md').Count
Write-Host "Updated $copied upstream agents. $AgentsDir now holds $total agents total."
Write-Host 'Restart Claude Code to pick up changes.'
