# Loaded once in the embedded interactive shell. The watcher wakes the idle
# reader on navigation. A busy shell applies the newest request at its next prompt.
$global:__StratumLink = @{
    Root = (-join [char[]](__MAILBOX__)); Request = $null; Applied = 0; Report = $null; Reading = $false
}
function global:Sync-StratumLocation([bool]$reload, [bool]$beforeRead) {
    $s = $global:__StratumLink
    try {
        if ($reload -or ($beforeRead -and $s.Request.path)) {
            $request = [IO.Path]::Combine($s.Root, 'request')
            if ([IO.File]::Exists($request)) {
                $s.Request = [IO.File]::ReadAllText($request) | ConvertFrom-Json
            }
        }
        if (!$s.Request.path -or !$s.Reading) { return }
        $failure = $null
        $changed = $false
        if ($s.Applied -ne $s.Request.version) {
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
            $s.Applied = $s.Request.version
            $s.Report = $null
        }
        if ($PWD.Provider.Name -eq 'FileSystem' -and ($PWD.ProviderPath -cne $s.Report -or $failure)) {
            $file = [IO.Path]::Combine($s.Root, 'report')
            $temp = $file + '.tmp'
            $data = @{version=$s.Applied; path=$PWD.ProviderPath; error=$failure} | ConvertTo-Json -Compress
            [IO.File]::WriteAllText($temp, $data)
            if ([IO.File]::Exists($file)) { [IO.File]::Replace($temp, $file, [System.Management.Automation.Language.NullString]::Value) }
            else { [IO.File]::Move($temp, $file) }
            $s.Report = $PWD.ProviderPath
        }
        if ($changed -and !$beforeRead) { [Microsoft.PowerShell.PSConsoleReadLine]::InvokePrompt() }
    } catch { }
}
$global:__StratumLink.Reader = (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue).ScriptBlock
if ($global:__StratumLink.Reader) {
    function global:PSConsoleHostReadLine {
        $global:__StratumLink.Reading = $true
        try {
            Sync-StratumLocation $false $true
            & $global:__StratumLink.Reader
        } finally { $global:__StratumLink.Reading = $false }
    }
} else {
    $global:__StratumLink.Prompt = $function:prompt
    function global:prompt {
        $global:__StratumLink.Reading = $true
        try { Sync-StratumLocation $true $true } finally { $global:__StratumLink.Reading = $false }
        & $global:__StratumLink.Prompt
    }
}
$global:__StratumLink.Watcher = [IO.FileSystemWatcher]::new($global:__StratumLink.Root, 'signal')
$global:__StratumLink.Watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite
$null = Register-ObjectEvent $global:__StratumLink.Watcher Changed -SupportEvent -Action { Sync-StratumLocation $true $false }
$global:__StratumLink.Watcher.EnableRaisingEvents = $true
Sync-StratumLocation $true $false
