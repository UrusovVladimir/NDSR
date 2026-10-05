<#
.SYNOPSIS
    Подготовка Windows VM для портала NDSR (тестовые VM в LAN устройства).

.DESCRIPTION
    Запускать в самой VM от имени администратора, один раз:
      1. Переименовывает сетевые карты по MAC: смотрящую в LAN роутера -> "LAN"
         (DHCP от роутера), служебную -> "Mgmt" (статический адрес, БЕЗ шлюза).
      2. Включает удалённый рабочий стол; RDP разрешается только на Mgmt.
      3. Ставит сторожа LAN (задача планировщика от SYSTEM, C:\ProgramData\NDSR):
         когда портал переключает VM в LAN другого устройства или отключает её,
         Windows сама этого не замечает — сторож видит, что шлюз пропал или
         сменился, и делает ipconfig /release + /renew. Входящих портов, кроме
         RDP, VM не открывает: портал адрес VM берёт из DHCP роутера.
      4. Создаёт локального пользователя-администратора для RDP.
      5. Отключает сон (VM должна быть доступна всегда).
    В конце печатает запись для vms.json (с lanMac).

    -WatchdogOnly — только поставить/обновить сторожа на уже подготовленной VM
    (нужен лишь -LanName — текущее имя адаптера LAN).

    MAC-адреса сетевых карт — в настройках VM на ESXi (Network adapter 1/2).
    Адаптер LAN подключается к port group vmN-lan, Mgmt — к vm-mgmt.


.EXAMPLE
    .\Prepare-NdsrTestVm.ps1 -LanMac 00-50-56-AA-00-01 -MgmtMac 00-50-56-AA-00-02 `
        -MgmtIp 10.10.31.11 -VmId vm1 -Vlan 3001 -RdpPort 33001

.EXAMPLE
    .\Prepare-NdsrTestVm.ps1 -WatchdogOnly -LanName Ethernet1
#>
[CmdletBinding()]
param(
    [string] $LanMac,
    # Имя адаптера LAN в Windows — то же, что lanNic в vms.json
    [string] $LanName = 'LAN',
    [string] $MgmtMac,
    [string] $MgmtIp,
    [int]    $MgmtPrefix = 24,
    [string] $UserName = 'tester',
    # Только латиница/ASCII: иначе RDP из браузера (Guacamole) не войдёт
    [securestring] $Password,
    # Для итоговой записи vms.json
    [string] $VmId = 'vm1',
    [int]    $Vlan = 3001,
    [int]    $RdpPort = 33001,
    # Только сторож LAN (VM уже подготовлена)
    [switch] $WatchdogOnly
)

$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

# --- Проверки ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Запустите PowerShell от имени администратора.'
}

$edition = (Get-CimInstance Win32_OperatingSystem).Caption
if ($edition -match 'Home') {
    throw "$edition не умеет принимать RDP-подключения — нужна Pro/Enterprise."
}

function Find-Adapter([string] $mac) {
    $norm = ($mac -replace '[:\-\.]', '').ToUpper()
    $adapter = Get-NetAdapter -Physical | Where-Object { ($_.MacAddress -replace '-', '') -eq $norm }
    if (-not $adapter) { throw "Не найдена сетевая карта с MAC $mac. Есть: $((Get-NetAdapter -Physical).MacAddress -join ', ')" }
    return $adapter
}

# Сторож LAN: цикл раз в 10 с. Нет адреса / шлюз не отвечает (2 проверки
# подряд) / сменился MAC шлюза (VM переключили на другой роутер с той же
# подсетью) → ipconfig /release + /renew, не чаще раза в минуту.
function Install-LanWatchdog([string] $nic) {
    Step "Сторож LAN (адаптер $nic)"
    $dir = 'C:\ProgramData\NDSR'
    New-Item -Path $dir -ItemType Directory -Force | Out-Null
    $body = @'
param([string] $Nic = '__NIC__')
$log = 'C:\ProgramData\NDSR\lan-watchdog.log'
function Log([string] $m) {
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) { Move-Item $log "$log.1" -Force }
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content $log
}
function GatewayAlive([string] $gw) {
    if (Test-Connection -ComputerName $gw -Count 1 -Quiet) { return $true }
    # роутер может не отвечать на ping — пробуем его веб-порт
    try {
        $c = New-Object Net.Sockets.TcpClient
        $ok = $c.BeginConnect($gw, 80, $null, $null).AsyncWaitHandle.WaitOne(1500)
        $alive = $ok -and $c.Connected
        $c.Close()
        return $alive
    } catch { return $false }
}
Log "start, adapter $Nic"
$fails = 0; $lastRenew = [datetime]::MinValue; $lastGwMac = $null
while ($true) {
    $reason = $null
    try {
        $ip = Get-NetIPAddress -InterfaceAlias $Nic -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
        $gw = (Get-NetIPConfiguration -InterfaceAlias $Nic -ErrorAction Stop).IPv4DefaultGateway.NextHop
        if (-not $ip -or -not $gw) { $reason = 'no address' }
        elseif (-not (GatewayAlive $gw)) { $reason = "gateway $gw not answering" }
        else {
            $mac = (Get-NetNeighbor -InterfaceAlias $Nic -IPAddress $gw -ErrorAction SilentlyContinue).LinkLayerAddress
            if ($lastGwMac -and $mac -and $mac -ne $lastGwMac) { $reason = "gateway MAC changed $lastGwMac -> $mac" }
            if ($mac) { $lastGwMac = $mac }
        }
    } catch { $reason = "error: $($_.Exception.Message)" }

    if ($reason) { $fails++ } else { $fails = 0 }
    $now = Get-Date
    if (($fails -ge 2 -or $reason -like 'gateway MAC changed*') -and ($now - $lastRenew).TotalSeconds -ge 60) {
        Log "$reason - renew"
        ipconfig /release "$Nic" | Out-Null
        ipconfig /renew "$Nic" | Out-Null
        $lastRenew = $now; $fails = 0; $lastGwMac = $null
        $got = (Get-NetIPAddress -InterfaceAlias $Nic -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
        Log "address now: $(if ($got) { $got } else { 'none' })"
    }
    Start-Sleep -Seconds 10
}
'@
    Set-Content -Path "$dir\lan-watchdog.ps1" -Value ($body -replace '__NIC__', $nic) -Encoding UTF8
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\lan-watchdog.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'NDSR-LanWatchdog' -Action $action -Trigger $trigger -Settings $settings `
        -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Stop-ScheduledTask -TaskName 'NDSR-LanWatchdog' -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName 'NDSR-LanWatchdog'
    Write-Host "    журнал: $dir\lan-watchdog.log"
}

if ($WatchdogOnly) {
    if (-not (Get-NetAdapter -Name $LanName -ErrorAction SilentlyContinue)) {
        throw "Нет адаптера '$LanName'. Есть: $((Get-NetAdapter).Name -join ', ')"
    }
    Install-LanWatchdog $LanName
    $mac = ((Get-NetAdapter -Name $LanName).MacAddress -replace '-', ':').ToLower()
    Write-Host "Готово. Для vms.json: `"lanNic`": `"$LanName`", `"lanMac`": `"$mac`"" -ForegroundColor Green
    return
}

foreach ($p in 'LanMac', 'MgmtMac', 'MgmtIp') {
    if (-not (Get-Variable $p -ValueOnly)) { throw "Укажите -$p (или -WatchdogOnly для уже подготовленной VM)" }
}

if (-not $Password) {
    $Password = Read-Host "Пароль для пользователя $UserName (латиница)" -AsSecureString
}
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
if ($plain -notmatch '^[\x20-\x7E]+$') {
    throw 'Пароль должен состоять из латиницы, цифр и ASCII-символов (иначе не войдёт RDP из браузера).'
}

# --- 1. Сетевые карты ---
Step 'Сетевые карты'
$lan = Find-Adapter $LanMac
$mgmt = Find-Adapter $MgmtMac
if ($lan.Name -ne $LanName) { Rename-NetAdapter -Name $lan.Name -NewName $LanName }
if ($mgmt.Name -ne 'Mgmt') { Rename-NetAdapter -Name $mgmt.Name -NewName 'Mgmt' }

# LAN — DHCP от роутера, основной маршрут
Set-NetIPInterface -InterfaceAlias $LanName -Dhcp Enabled -AddressFamily IPv4
Set-DnsClientServerAddress -InterfaceAlias $LanName -ResetServerAddresses
Set-NetIPInterface -InterfaceAlias $LanName -InterfaceMetric 10

# Mgmt — статический адрес без шлюза и без DNS: трафик теста через него не идёт
Get-NetIPAddress -InterfaceAlias 'Mgmt' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Remove-NetIPAddress -Confirm:$false
Get-NetRoute -InterfaceAlias 'Mgmt' -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Remove-NetRoute -Confirm:$false
Set-NetIPInterface -InterfaceAlias 'Mgmt' -Dhcp Disabled -AddressFamily IPv4
New-NetIPAddress -InterfaceAlias 'Mgmt' -IPAddress $MgmtIp -PrefixLength $MgmtPrefix | Out-Null
Set-DnsClient -InterfaceAlias 'Mgmt' -RegisterThisConnectionsAddress $false
Set-NetIPInterface -InterfaceAlias 'Mgmt' -InterfaceMetric 500
# Сеть без шлюза Windows считает «неопознанной» (Public) — делаем Private
Set-NetConnectionProfile -InterfaceAlias 'Mgmt' -NetworkCategory Private -ErrorAction SilentlyContinue

# --- 2. Пользователь ---
Step "Пользователь $UserName"
$adminGroup = Get-LocalGroup -SID 'S-1-5-32-544'   # Administrators на любом языке Windows
$user = Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue
if ($user) {
    Set-LocalUser -Name $UserName -Password $Password -PasswordNeverExpires $true
} else {
    New-LocalUser -Name $UserName -Password $Password -PasswordNeverExpires -AccountNeverExpires | Out-Null
}
if (-not (Get-LocalGroupMember -Group $adminGroup -Member $UserName -ErrorAction SilentlyContinue)) {
    Add-LocalGroupMember -Group $adminGroup -Member $UserName
}

# --- 3. RDP только на Mgmt ---
Step 'Удалённый рабочий стол'
Set-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
# Встроенные правила группы «Remote Desktop» (идентификатор не зависит от языка) — выключаем,
# вместо них своё правило только на Mgmt
Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
Get-NetFirewallRule -Name 'NDSR-RDP-Mgmt' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'NDSR-RDP-Mgmt' -DisplayName 'NDSR: RDP (Mgmt only)' -Direction Inbound `
    -Protocol TCP -LocalPort 3389 -InterfaceAlias 'Mgmt' -Action Allow -Profile Any | Out-Null

# --- 4. Сторож LAN ---
Install-LanWatchdog $LanName
# Старый вариант подготовки ставил OpenSSH — его правило больше не нужно
Get-NetFirewallRule -Name 'NDSR-SSH-Mgmt' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

# --- 5. Без сна ---
Step 'Электропитание'
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null

# --- Итог ---
Step 'Готово. Запись для vms.json (пароль подставьте сами):'
$entry = [ordered]@{
    id          = $VmId
    name        = $env:COMPUTERNAME
    os          = $edition
    vlan        = $Vlan
    mgmtIp      = $MgmtIp
    rdpPort     = $RdpPort
    rdpUser     = $UserName
    rdpPassword = '<password>'
    lanNic      = $LanName
    lanMac      = (($lan.MacAddress -replace '-', ':').ToLower())
}
$entry | ConvertTo-Json
Write-Host ''
Write-Host 'Проверка с docker-хоста:' -ForegroundColor Yellow
Write-Host "  nc -vz $MgmtIp 3389"
Write-Host 'Сторож LAN: Get-ScheduledTask NDSR-LanWatchdog; журнал C:\ProgramData\NDSR\lan-watchdog.log'
