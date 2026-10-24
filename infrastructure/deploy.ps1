# ==============================================================================
# Phone Reader - AWS Serverless Deployment Script (Windows PowerShell)
# Deploys DynamoDB, API Gateway, and Lambda functions using AWS SAM CLI.
# ==============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$Region = "ap-south-1",

    [Parameter(Mandatory = $false)]
    [string]$StackName = "phone-reader",

    [Parameter(Mandatory = $false)]
    [string]$ApiToken = "",

    [Parameter(Mandatory = $false)]
    [string]$DeviceId = "",

    [Parameter(Mandatory = $false)]
    [string]$AlexaSkillId = ""
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Phone Reader: AWS Serverless Free-Tier Deployment      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
if (-not (Get-Command sam -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] AWS SAM CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install AWS SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] AWS CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
}

# 2. Prompt for missing parameters if not passed
if ([string]::IsNullOrWhiteSpace($ApiToken)) {
    $generatedToken = [System.Guid]::NewGuid().ToString("N") + [System.Guid]::NewGuid().ToString("N")
    $inputToken = Read-Host "Enter an Authorization Token (Press Enter to auto-generate: $generatedToken)"
    if ([string]::IsNullOrWhiteSpace($inputToken)) {
        $ApiToken = $generatedToken
    } else {
        $ApiToken = $inputToken
    }
}

if ([string]::IsNullOrWhiteSpace($DeviceId)) {
    $DeviceId = Read-Host "Enter your Android Device ID (from Phone Reader app Settings screen)"
    if ([string]::IsNullOrWhiteSpace($DeviceId)) {
        $DeviceId = "my-personal-phone"
        Write-Host "Using default Device ID: $DeviceId (you can update this later in AWS SSM or redeploy)." -ForegroundColor Yellow
    }
}

Write-Host "`nDeploying stack '$StackName' to AWS Region '$Region'..." -ForegroundColor Green

# 3. Build dependencies
Write-Host "`n[Step 1/3] Building backend and Alexa dependencies..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\..\backend"
npm install --omit=dev --silent
Pop-Location

Push-Location "$PSScriptRoot\..\alexa"
npm install --omit=dev --silent
Pop-Location

# 4. SAM Build
Write-Host "`n[Step 2/3] Building SAM package..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot"
sam build --template template.yaml

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] SAM build failed." -ForegroundColor Red
    Pop-Location
    exit 1
}

# 5. SAM Deploy
Write-Host "`n[Step 3/3] Deploying CloudFormation Stack..." -ForegroundColor Cyan
$paramOverrides = "ApiToken=`"$ApiToken`" DeviceId=`"$DeviceId`""
if (-not [string]::IsNullOrWhiteSpace($AlexaSkillId)) {
    $paramOverrides += " AlexaSkillId=`"$AlexaSkillId`""
}

sam deploy `
    --stack-name $StackName `
    --region $Region `
    --capabilities CAPABILITY_IAM `
    --resolve-s3 `
    --parameter-overrides $paramOverrides `
    --no-confirm-changeset

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "  DEPLOYMENT SUCCESSFUL!                                  " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "`nConfiguration values for your Android Phone & Alexa:" -ForegroundColor Yellow
    Write-Host "1. In Android App Settings:" -ForegroundColor White
    Write-Host "   - Remote URL: (Check 'HttpApiUrl' in SAM Outputs above)"
    Write-Host "   - Authorization Token: $ApiToken"
    Write-Host "   - Device ID: $DeviceId"
    Write-Host "`n2. In Alexa Developer Console:" -ForegroundColor White
    Write-Host "   - Endpoint ARN: (Check 'AlexaFunctionArn' in SAM Outputs above)"
} else {
    Write-Host "[ERROR] Deployment failed. Check AWS CloudFormation console for error details." -ForegroundColor Red
}

Pop-Location
