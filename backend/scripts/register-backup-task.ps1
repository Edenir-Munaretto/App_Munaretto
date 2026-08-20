[CmdletBinding()]
param(
    [string]$Tarefa = 'AppMunaretto-BackupSupabase',
    [string]$Horario = '03:00',
    [int]$ManterUltimos = 14
)

$script = Join-Path $PSScriptRoot 'backup-supabase.ps1'

# Executa de forma SILENCIOSA:
#  - -WindowStyle Hidden: nenhuma janela do PowerShell é aberta na tela;
#  - -LogonType S4U: roda mesmo se o usuário não estiver logado (sem janela,
#    sem precisar de senha). O backup em si não depende de credenciais do
#    Windows (usa SUPABASE_DB_URL do .env.backup), então funciona normalmente.
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -ManterUltimos $ManterUltimos"
$gatilho = New-ScheduledTaskTrigger -Daily -At $Horario
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Principal $principal -Force | Out-Null

Write-Host "Tarefa '$Tarefa' registrada (modo silencioso). Execucao diaria as $Horario."
Write-Host "Backup: $script"
Write-Host "Teste imediato: powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
Write-Host "Para conferir a ultima execucao: Get-ScheduledTaskInfo -TaskName '$Tarefa'"