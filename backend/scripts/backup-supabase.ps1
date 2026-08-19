[CmdletBinding()]
param(
    [string]$PastaBackup = '',
    [int]$ManterUltimos = 14
)

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $PastaBackup) { $PastaBackup = Join-Path $scriptDir 'backups' }

$ErrorActionPreference = 'Stop'
$log = Join-Path $scriptDir 'backup.log'

function Escrever-Log {
    param([string]$Mensagem)
    $linha = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensagem
    Add-Content -LiteralPath $log -Value $linha
    Write-Host $linha
}

$pgDumpCandidato = Get-ChildItem 'C:\Program Files\PostgreSQL' -Filter 'pg_dump.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -match '\\bin$' } |
    Sort-Object { [int]($_.DirectoryName -replace '\D', '') } -Descending |
    Select-Object -First 1
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if ($pgDumpCandidato) {
    $pgDump = [pscustomobject]@{ Source = $pgDumpCandidato.FullName }
}
if (-not $pgDump) {
    Escrever-Log 'ERRO: pg_dump nao encontrado. Instale o PostgreSQL client tools e adicione ao PATH.'
    exit 1
}
Escrever-Log "pg_dump: $($pgDump.Source)"

$envBackup = Join-Path $scriptDir '.env.backup'
if (-not (Test-Path -LiteralPath $envBackup)) {
    Escrever-Log "ERRO: arquivo $envBackup nao encontrado. Crie com SUPABASE_DB_URL=postgresql://..."
    exit 1
}

$dbUrl = ((Get-Content -LiteralPath $envBackup | Where-Object { $_ -match '^SUPABASE_DB_URL=' }) -replace '^SUPABASE_DB_URL=', '' | Select-Object -First 1).Trim()
if (-not $dbUrl) {
    Escrever-Log 'ERRO: SUPABASE_DB_URL vazio em .env.backup.'
    exit 1
}

if (-not (Test-Path -LiteralPath $PastaBackup)) {
    New-Item -ItemType Directory -Path $PastaBackup -Force | Out-Null
}

$arquivo = Join-Path $PastaBackup ('backup_' + (Get-Date -Format 'yyyy-MM-dd_HHmmss') + '.dump')
Escrever-Log "Iniciando backup -> $arquivo"
& $pgDump.Source '-w' '-Fc' '--no-owner' '--no-acl' "--file=$arquivo" $dbUrl 2>> $log
if ($LASTEXITCODE -ne 0) {
    Escrever-Log "ERRO: pg_dump falhou (codigo $LASTEXITCODE)."
    exit 1
}

Get-ChildItem -LiteralPath $PastaBackup -Filter 'backup_*.dump' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $ManterUltimos |
    Remove-Item -Force

Escrever-Log "Backup concluido com sucesso. ($((Get-Item -LiteralPath $arquivo).Length) bytes)"