$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$configPath = Join-Path $PSScriptRoot ".deploy-config.ps1"

if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Host "Missing .deploy-config.ps1. Create your local deployment configuration first." -ForegroundColor Red
    exit 1
}

. $configPath

if ([string]::IsNullOrWhiteSpace($Bucket) -or
    [string]::IsNullOrWhiteSpace($DistributionId)) {
    Write-Host "Bucket or DistributionId is missing from .deploy-config.ps1." -ForegroundColor Red
    exit 1
}

Write-Host "Uploading website files to S3..." -ForegroundColor Cyan

aws s3 sync $PSScriptRoot "s3://$Bucket" --delete `
    --exclude "*" `
    --include "index.html" `
    --include "css/*" `
    --include "js/*" `
    --include "assets/*"

if ($LASTEXITCODE -ne 0) {
    Write-Host "S3 deployment failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "S3 upload complete." -ForegroundColor Green
Write-Host "Creating CloudFront invalidation..." -ForegroundColor Cyan

aws cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths "/*"

if ($LASTEXITCODE -ne 0) {
    Write-Host "CloudFront invalidation failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Deployment submitted successfully. Wait for the invalidation to complete." -ForegroundColor Green
