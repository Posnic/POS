$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    # Compare literal names, never interpolate a queue name into a WQL query.
    $printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $request.printer } | Select-Object -First 1
    if (-not $printer) { throw 'Configured printer queue not found' }
    $port = [string]$printer.PortName
    $usb = $port -match '^USB\d+$'
    $deviceId = [string]$request.pnpId
    if ($usb -and -not $deviceId) {
        # A PrintQueue/SWD instance is NOT evidence of a connected USB device.
        # USBPRINT's per-device PortName associates the physical instance with
        # this queue, even when two printers use the same POS-80C driver.
        $deviceMatches = @()
        $root = 'HKLM:\SYSTEM\CurrentControlSet\Enum\USBPRINT'
        if (Test-Path $root) {
            foreach ($model in Get-ChildItem -LiteralPath $root) {
                foreach ($instance in Get-ChildItem -LiteralPath $model.PSPath) {
                    $parameters = Get-ItemProperty -LiteralPath ($instance.PSPath + '\Device Parameters') -ErrorAction SilentlyContinue
                    if ($parameters.PortName -eq $port) {
                        $deviceMatches += 'USBPRINT\' + $model.PSChildName + '\' + $instance.PSChildName
                    }
                }
            }
        }
        if ($deviceMatches.Count -eq 1) { $deviceId = $deviceMatches[0] }
        elseif ([string]$printer.PNPDeviceID -match '^USB(PRINT)?\\') { $deviceId = [string]$printer.PNPDeviceID }
    }
    $present = $null
    if ($deviceId) {
        $present = @((Get-PnpDevice -PresentOnly) | Where-Object { $_.InstanceId -eq $deviceId }).Count -gt 0
        if ($usb -and $deviceId -match '^USBPRINT\\') {
            $mappedPort = (Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Enum\' + $deviceId + '\Device Parameters') -ErrorAction SilentlyContinue).PortName
            if ($mappedPort -and $mappedPort -ne $port) { throw 'Configured USB device belongs to a different port; check configuration' }
        }
    }
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
       jobs = $jobs } | ConvertTo-Json -Compress -Depth 5
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
