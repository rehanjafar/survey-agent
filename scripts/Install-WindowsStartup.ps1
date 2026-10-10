# Run after setup:local, in PowerShell as your normal desktop user.
$ErrorActionPreference = "Stop"
$surveyRoot = Split-Path -Parent $PSScriptRoot
$surveyNode = (Get-Command node -ErrorAction Stop).Source
$surveyScript = Join-Path $surveyRoot "scripts\supervise.mjs"
$surveyAction = New-ScheduledTaskAction -Execute $surveyNode -Argument ('"' + $surveyScript + '"') -WorkingDirectory $surveyRoot
$surveyUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$surveyTrigger = New-ScheduledTaskTrigger -AtLogOn -User $surveyUser
$surveyPrincipal = New-ScheduledTaskPrincipal -UserId $surveyUser -LogonType Interactive -RunLevel Limited
$surveySettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "SurveyAgent" -Action $surveyAction -Trigger $surveyTrigger -Principal $surveyPrincipal -Settings $surveySettings -Description "Local Survey Agent dashboard" -Force
Write-Output "Survey Agent will start at your next Windows sign-in. Remove it with: Unregister-ScheduledTask -TaskName SurveyAgent"
