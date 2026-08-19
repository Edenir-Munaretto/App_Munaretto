[CmdletBinding()]
param(
    [string]$Tarefa = 'AppMunaretto-BackupSupabase',
    [string]$Horario = '03:00',
    [int]$ManterUltimos = 14
)

$script = Join-Path $PSScriptRoot 'backup-supabase.ps1'

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -ManterUltimos $ManterUltimos"
$gatilho = New-ScheduledTaskTrigger -Daily -At $Horario
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Principal $principal -Force | Out-Null

Write-Host "Tarefa '$Tarefa' registrada. Execucao diaria as $Horario."
Write-Host "Backup: $script"
Write-Host "Teste imediato: powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`""