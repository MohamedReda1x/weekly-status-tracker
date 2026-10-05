<#
.SYNOPSIS  Creates (or removes) a daily Windows Task Scheduler job that runs backup.ps1.
.EXAMPLE   .\scripts\register-backup-task.ps1 -Time 02:00 -Keep 14
.EXAMPLE   .\scripts\register-backup-task.ps1 -Unregister
.NOTES     Runs as the current user, only while logged on (Docker Desktop must be running). Check "Last Run Result" (0 = OK) and backups\backup.log.
#>
param([string]$Time = "02:00", [int]$Keep = 14, [string]$TaskName = "WeeklyTracker-DB-Backup", [switch]$Unregister)
$ErrorActionPreference = "Stop"
if ($Unregister) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Host "Task $TaskName removed."; exit 0 }
$script = Join-Path $PSScriptRoot "backup.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Keep {1}" -f $script, $Keep) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Daily PostgreSQL backup of the Weekly Tracker" -Force | Out-Null
Write-Host "Task '$TaskName' registered: daily at $Time, keeps the last $Keep backups. Test it now with: Start-ScheduledTask -TaskName $TaskName"
