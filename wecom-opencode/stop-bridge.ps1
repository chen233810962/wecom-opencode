# Stop WeCom SDK Bridge
$bridge = Get-WmiObject Win32_Process | Where-Object { 
    $_.Name -eq 'node.exe' -and 
    $_.CommandLine -like '*index.js*' -and 
    $_.CommandLine -notlike '*benborla*' -and 
    $_.CommandLine -notlike '*npx*'
}
if ($bridge) {
    $bridgePid = $bridge.ProcessId
    $null = $bridge.Terminate()
    Write-Host "[OK] Stopped bridge PID: $bridgePid"
} else {
    Write-Host "[INFO] Bridge not running"
}

# Clean up wecom-aibot processes
$wecom = Get-WmiObject Win32_Process | Where-Object { 
    $_.Name -eq 'node.exe' -and 
    $_.CommandLine -like '*vrs-soft*'
}
if ($wecom) {
    $wecom | ForEach-Object {
        $p = $_.ProcessId
        $null = $_.Terminate()
        Write-Host "[OK] Cleaned wecom-aibot PID: $p"
    }
} else {
    Write-Host "[INFO] No wecom-aibot processes found"
}
