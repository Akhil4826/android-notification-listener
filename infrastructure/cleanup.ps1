# ==============================================================================
# Phone Reader - AWS Resource Cleanup / Teardown Script (PowerShell)
# Deletes CloudFormation stack and all provisioned resources (DynamoDB, API, Lambda)
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$Region = "ap-south-1",

    [Parameter(Mandatory = $false)]
    [string]$StackName = "phone-reader"
)

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "  Phone Reader: AWS CloudFormation Resource Teardown     " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow

$confirm = Read-Host "Are you sure you want to delete the '$StackName' stack and all associated resources? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Teardown cancelled." -ForegroundColor Cyan
    exit 0
}

Write-Host "Deleting CloudFormation stack '$StackName' in region '$Region'..." -ForegroundColor Yellow

aws cloudformation delete-stack --stack-name $StackName --region $Region

Write-Host "Waiting for stack deletion to complete..." -ForegroundColor Cyan
aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region

Write-Host "Cleanup completed successfully. All resources have been deleted." -ForegroundColor Green
