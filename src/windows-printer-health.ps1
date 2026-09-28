$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
# Pure resolver: no fallback to a different physical device for a saved ID.
function Resolve-UsbIdentity($port, $savedId, $records, $presentIds) {
    $matches = @($records | Where-Object { $_.port -eq $port -and $presentIds -contains $_.id } | ForEach-Object { $_.id } | Sort-Object -Unique)
    $result = @{ pnpId = $savedId; present = $null; discovery = 'unknown'; candidateCount = $matches.Count }
    if ($savedId) {
        $saved = @($records | Where-Object { $_.id -eq $savedId })
        if (@($saved | Where-Object { $_.port -and $_.port -ne $port }).Count) { $result.discovery = 'port-mismatch' }
        elseif ($presentIds -contains $savedId) {
            if ($matches -contains $savedId) { $result.present = $true; $result.discovery = 'resolved' }
        } elseif ($matches.Count) { $result.discovery = 'stale-binding' }
        else { $result.present = $false; $result.discovery = 'absent' }
    } elseif ($matches.Count -eq 1) {
        $result.pnpId = $matches[0]; $result.present = $true; $result.discovery = 'resolved'
    } elseif ($matches.Count -gt 1) { $result.discovery = 'ambiguous' }
    elseif (@($records | Where-Object { $_.port -eq $port }).Count -or $presentIds.Count -eq 0) { $result.present = $false; $result.discovery = 'absent' }
    return $result
}
# Read-only power audit; never changes the power plan or requests elevation.
function Read-PowerSetting($subgroup, $setting) {
    try {
        $output = (& powercfg.exe /query SCHEME_CURRENT $subgroup $setting 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw 'Power setting unavailable' }
        $values = @([regex]::Matches($output, '0x[0-9a-fA-F]{8}'))
        if ($values.Count -lt 2) { throw 'Power setting response incomplete' }
        # The final two hexadecimal values are AC/DC indices; preceding
        # values are bounds or enumerated choices. No localized label parsing.
        return @{ ac = [Convert]::ToInt64($values[-2].Value.Substring(2), 16); dc = [Convert]::ToInt64($values[-1].Value.Substring(2), 16) }
    } catch { return @{ ac = $null; dc = $null } }
}
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'power') {
        $external = $null
        try {
            $external = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
                $_.ProcessId -ne $PID -and $_.CommandLine -notmatch 'Read-PowerSetting' -and $_.Name -match '^(powershell|pwsh)(.exe)?$' -and $_.CommandLine -match 'posnic-printer-keepalive\.ps1'
            }).Count -gt 0
        } catch { }
        @{
            sleep = Read-PowerSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
            hibernate = Read-PowerSetting '238c9fa8-0aad-41ed-83f4-97be242c8f20' '9d7815a6-7ee4-497e-8888-515a05f02364'
            usbSuspend = Read-PowerSetting '2a737441-1930-4402-8d77-b2bebba308a3' '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'
            externalKeepAlive = $external
        } | ConvertTo-Json -Compress -Depth 5
        exit 0
    }
    # Compare literal names, never interpolate a queue name into a WQL query.
    $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $request.printer } | Select-Object -First 1
    if (-not $printer) { throw 'Configured printer queue not found' }
    $port = [string]$printer.PortName
    $usb = $port -match '^USB\d+$'
    $identity = @{ pnpId = [string]$request.pnpId; present = $null; discovery = 'not-usb'; candidateCount = 0 }
    if ($usb) {
        try {
            # Query present devices once. Historical registry records alone do
            # not prove presence, and a PrintQueue/SWD entry is not USB hardware.
            $presentIds = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -match '^USB(PRINT)?\\' } | ForEach-Object { [string]$_.InstanceId })
            $records = @()
            $root = 'HKLM:\SYSTEM\CurrentControlSet\Enum\USBPRINT'
            if (Test-Path -LiteralPath $root) {
                foreach ($model in Get-ChildItem -LiteralPath $root -ErrorAction Stop) {
                    foreach ($instance in Get-ChildItem -LiteralPath $model.PSPath -ErrorAction Stop) {
                        $parametersPath = $instance.PSPath + '\Device Parameters'
                        if (Test-Path -LiteralPath $parametersPath) {
                            $parameters = Get-ItemProperty -LiteralPath $parametersPath -ErrorAction Stop
                            $records += @{ id = 'USBPRINT\' + $model.PSChildName + '\' + $instance.PSChildName; port = [string]$parameters.PortName }
                        }
                    }
                }
            }
            $identity = Resolve-UsbIdentity $port ([string]$request.pnpId) $records $presentIds
        } catch {
            $identity.discovery = 'error'
            $identity.present = $null
            $identity.discoveryError = $_.Exception.Message
        }
    }
    $deviceId = $identity.pnpId
    $present = $identity.present
    if ($request.recover -and $printer.WorkOffline) {
        if ($present -ne $true) { throw 'Cannot recover without a present physical USB device' }
        if ($request.expectedPort -and $request.expectedPort -ne $port) { throw 'Printer port changed; check configuration' }
        # Uses current user's permissions; no elevation, service restart or
        # driver/port changes. Access denied is returned to the application.
        $printer | Set-CimInstance -Property @{ WorkOffline = $false } | Out-Null
        $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $request.printer } | Select-Object -First 1
    }
    $jobs = @(Get-PrintJob -PrinterName $printer.Name | ForEach-Object {
        @{ id = [int]$_.ID; document = [string]$_.DocumentName; status = [string]$_.JobStatus;
           error = ([string]$_.JobStatus -match 'Error|Offline|PaperOut|Blocked|UserIntervention|Deleting|Deleted|Paused') }
    })
    @{ printer = [string]$printer.Name; port = $port; usb = $usb; pnpId = $deviceId; present = $present;
       workOffline = [bool]$printer.WorkOffline; printerStatus = [int]$printer.PrinterStatus;
       extendedStatus = [int]$printer.ExtendedPrinterStatus; detectedError = [int]$printer.DetectedErrorState;
       discovery = $identity.discovery; candidateCount = $identity.candidateCount; discoveryError = $identity.discoveryError;
       jobs = $jobs } | ConvertTo-Json -Compress -Depth 5
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
