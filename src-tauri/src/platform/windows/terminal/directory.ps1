# Loaded once in the embedded interactive shell. The watcher wakes the idle
# reader on navigation. A busy shell applies the newest request at its next prompt.
$global:__StratumLink = @{
    Root = (-join [char[]](__MAILBOX__)); Request = $null; Applied = 0
    Report = $null; ReportVersion = $null; Reading = $false
}
$global:__StratumLink.Inbox = [IO.Path]::Combine($global:__StratumLink.Root, 'request')
$global:__StratumLink.Claim = [IO.Path]::Combine($global:__StratumLink.Root, 'request.read')
$global:__StratumLink.ReadPending = $false
function global:Sync-StratumLocation([bool]$beforeRead) {
    $s = $global:__StratumLink
    try {
        # Claim one published request by renaming it. A newer request can arrive
        # in the inbox during the read and will still be there at the next prompt.
        if ([IO.File]::Exists($s.Inbox)) {
            [IO.File]::Delete($s.Claim)
            [IO.File]::Move($s.Inbox, $s.Claim)
            $s.ReadPending = $true
        }
        if ($s.ReadPending) {
            $s.Request = [IO.File]::ReadAllText($s.Claim) | ConvertFrom-Json
            $s.ReadPending = $false
        }
        if (!$s.Reading) { return }
        $failure = $null
        $changed = $false
        if ($s.Request -and $s.Applied -ne $s.Request.version) {
            if ($s.Request.path) {
                if (!$beforeRead) {
                    $line = ''; $cursor = 0
                    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
                    if ($line.Length) { return }
                }
                try {
                    if ($PWD.Provider.Name -ne 'FileSystem' -or $PWD.ProviderPath -cne $s.Request.path) {
                        Microsoft.PowerShell.Management\Set-Location -LiteralPath $s.Request.path -ErrorAction Stop
                        $changed = $true
                    }
                } catch { $failure = $_.Exception.Message }
            }
            $s.Applied = $s.Request.version
        }
        # The filesystem directory remains meaningful when visiting providers like Env:.
        $location = $ExecutionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath
        if ($location -cne $s.Report -or $s.Applied -ne $s.ReportVersion -or $failure) {
            $file = [IO.Path]::Combine($s.Root, 'report')
            $temp = $file + '.tmp'
            $data = @{version=$s.Applied; path=$location; error=$failure} | ConvertTo-Json -Compress
            [IO.File]::WriteAllText($temp, $data)
            if ([IO.File]::Exists($file)) { [IO.File]::Replace($temp, $file, [System.Management.Automation.Language.NullString]::Value) }
            else { [IO.File]::Move($temp, $file) }
            $s.Report = $location
            $s.ReportVersion = $s.Applied
        }
        if ($changed -and !$beforeRead) { [Microsoft.PowerShell.PSConsoleReadLine]::InvokePrompt() }
    } catch { }
}
$global:__StratumLink.Reader = (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue).ScriptBlock
if ($global:__StratumLink.Reader) {
    function global:PSConsoleHostReadLine {
        $global:__StratumLink.Reading = $true
        try {
            Sync-StratumLocation $true
            & $global:__StratumLink.Reader
        } finally { $global:__StratumLink.Reading = $false }
    }
} else {
    $global:__StratumLink.Prompt = $function:prompt
    function global:prompt {
        $global:__StratumLink.Reading = $true
        try { Sync-StratumLocation $true } finally { $global:__StratumLink.Reading = $false }
        & $global:__StratumLink.Prompt
    }
}
$global:__StratumLink.Watcher = [IO.FileSystemWatcher]::new($global:__StratumLink.Root, 'signal')
$global:__StratumLink.Watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite
$null = Register-ObjectEvent $global:__StratumLink.Watcher Changed -SupportEvent -Action { Sync-StratumLocation $false }
$global:__StratumLink.Watcher.EnableRaisingEvents = $true
Sync-StratumLocation $false
