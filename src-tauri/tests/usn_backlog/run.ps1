# From an elevated Windows PowerShell in the repository root:
#   $build = cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run --message-format=json | ForEach-Object { $_ | ConvertFrom-Json }
#   $bin = ($build | Where-Object { $_.profile.test -and $_.executable } | Select-Object -Last 1).executable
#   .\src-tauri\tests\usn_backlog\run.ps1 -Binary $bin
# The test uses roughly 2 GB in a new directory under %TEMP%. An optional
# -TranscriptPath captures the test output to a new file.
param(
    [Parameter(Mandatory)][string]$Binary,
    [string]$TranscriptPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$token = [guid]::NewGuid().ToString('N')
$run = Join-Path $env:TEMP "stratum-usn-backlog-$token"
$vhd = Join-Path $run 'disposable.vhdx'
$mount = Join-Path $run 'mount'
$diskpart = Join-Path $env:SystemRoot 'System32\diskpart.exe'
$fsutil = Join-Path $env:SystemRoot 'System32\fsutil.exe'
$ownedImage = $false
$accessPath = $false
$exitCode = 0
$previousDirectory = $env:STRATUM_USN_TEST_DIR
$previousVolume = $env:STRATUM_USN_TEST_VOLUME_GUID
$previousPhase = $env:STRATUM_USN_TEST_PHASE

function Invoke-JournalCommand ([string[]]$Options) {
    & $fsutil usn @Options $script:guid | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "fsutil usn failed with exit $LASTEXITCODE" }
}

function Invoke-Phase ([string]$Phase) {
    $env:STRATUM_USN_TEST_PHASE = $Phase
    Write-Output "Starting test process for $Phase"
    # The executable is the Rust libtest harness built from this working tree.
    & $Binary 'services::indexed_search::windows_backlog_stress::disposable_ntfs_backlog' --exact --ignored --nocapture
    if ($LASTEXITCODE -ne 0) { throw "Rust test phase $Phase failed with exit $LASTEXITCODE" }
}

if ($TranscriptPath) { Start-Transcript -Path $TranscriptPath -NoClobber | Out-Null }
try {
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Expected elevated token' }
    $Binary = (Resolve-Path -LiteralPath $Binary).Path
    if ((Split-Path $Binary -Leaf) -notmatch '^stratum_lib-[a-f0-9]+\.exe$') { throw 'Expected Rust unit test binary' }
    if (-not [IO.File]::Exists($Binary)) { throw 'Missing Rust test executable' }
    $cases = & $Binary --list --ignored
    if ($LASTEXITCODE -ne 0 -or -not ($cases -contains 'services::indexed_search::windows_backlog_stress::disposable_ntfs_backlog: test')) { throw 'Stress case missing from binary' }
    if ([IO.Directory]::Exists($run)) { throw 'Refusing an existing directory' }
    [void][IO.Directory]::CreateDirectory($run)
    [void][IO.Directory]::CreateDirectory($mount)
    [IO.File]::WriteAllText((Join-Path $run 'owner.txt'), $token)
    $env:STRATUM_USN_TEST_DIR = $run
    Invoke-Phase 'seed'
    Copy-Item -LiteralPath (Join-Path $run 'seed.sqlite3') -Destination (Join-Path $run 'catalog-copy.sqlite3')

    $createScript = Join-Path $run 'create-disk.txt'
    [IO.File]::WriteAllText($createScript, ('create vdisk file="' + $vhd + '" maximum=192 type=expandable' + [Environment]::NewLine), [Text.Encoding]::ASCII)
    & $diskpart /s $createScript | Out-Host
    if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($vhd)) { throw 'Could not create empty disposable VHD' }
    $ownedImage = $true
    Mount-DiskImage -ImagePath $vhd -NoDriveLetter | Out-Null
    $disk = Get-DiskImage -ImagePath $vhd | Get-Disk
    if ($null -eq $disk -or $disk.IsBoot -or $disk.IsSystem -or $disk.PartitionStyle -ne 'RAW' -or $disk.Size -ne (192MB)) {
        throw 'Backed disk failed identity, size or RAW-state checks'
    }
    Write-Output "New letterless disk $($disk.Number) at $vhd"
    $disk | Initialize-Disk -PartitionStyle GPT
    $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize
    $part | Set-Partition -NoDefaultDriveLetter $true
    $part = Get-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber
    if ($part.DriveLetter -match '[A-Za-z]') { throw 'Fixture unexpectedly has a drive letter' }
    $label = 'STUSN_' + $token.Substring(0,8)
    $part | Format-Volume -FileSystem NTFS -NewFileSystemLabel $label -Confirm:$false -Force | Out-Null
    $volume = $part | Get-Volume
    $guid = $volume.Path
    if ($guid -notmatch '^\\\\\?\\Volume\{[a-fA-F0-9-]+\}\\$' -or $volume.FileSystemLabel -ne $label -or $volume.DriveLetter -match '[A-Za-z]') {
        throw 'Formatted fixture failed mount identity or letterless check'
    }
    Add-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -AccessPath $mount
    $accessPath = $true
    [IO.File]::WriteAllText((Join-Path $mount 'stratum-usn-test-owner'), $token)
    $env:STRATUM_USN_TEST_VOLUME_GUID = $guid
    Invoke-JournalCommand @('createjournal','m=33554432','a=4194304')
    Invoke-Phase 'start'
    Invoke-Phase 'resume'
    Invoke-Phase 'case'
    if ((Get-DiskImage -ImagePath $vhd | Get-Disk).Number -ne $disk.Number -or ($part|Get-Volume).Path -ne $guid) {
        throw 'Disposable volume changed before journal recreation'
    }
    Invoke-JournalCommand @('deletejournal','/N')
    Invoke-JournalCommand @('createjournal','m=33554432','a=4194304')
    Invoke-Phase 'recreated'
} catch {
    $exitCode = 1
    Write-Output ($_ | Out-String)
} finally {
    $env:STRATUM_USN_TEST_DIR = $previousDirectory
    $env:STRATUM_USN_TEST_VOLUME_GUID = $previousVolume
    $env:STRATUM_USN_TEST_PHASE = $previousPhase
    try {
        if ($accessPath) {
            Remove-PartitionAccessPath -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -AccessPath $mount
        }
        if ($ownedImage -and (Get-DiskImage -ImagePath $vhd).Attached) {
            Dismount-DiskImage -ImagePath $vhd
            if ((Get-DiskImage -ImagePath $vhd).Attached) { throw 'Disposable disk is still attached' }
        }
        if ([IO.File]::Exists((Join-Path $run 'owner.txt')) -and [IO.File]::ReadAllText((Join-Path $run 'owner.txt')) -eq $token) {
            # Only remove the generated files and empty folders. Never recurse
            # into a mount point even if a storage command has failed.
            [IO.Directory]::Delete($mount, $false)
            foreach ($name in @('seed.sqlite3-wal','seed.sqlite3-shm','seed.sqlite3-journal','seed.sqlite3','catalog-copy.sqlite3-wal','catalog-copy.sqlite3-shm','catalog-copy.sqlite3-journal','catalog-copy.sqlite3','create-disk.txt','disposable.vhdx','owner.txt')) {
                [IO.File]::Delete((Join-Path $run $name))
            }
            [IO.Directory]::Delete($run, $false)
            Write-Output 'Removed disposable disk, mount directory, synthetic seed and catalog copy'
        }
    } catch {
        Write-Output ("Cleanup issue: " + ($_ | Out-String))
        $exitCode = 1
    }
    if ($TranscriptPath) { Stop-Transcript | Out-Null }
}
exit $exitCode
