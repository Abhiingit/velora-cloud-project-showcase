# Custom Domain + HTTPS Runbook for VELORA

> **Purpose:** This is a future implementation guide, not a record of completed work. Follow it only after you have registered a domain and confirmed you control its DNS.
>
> Current project URL: `https://d1y2n75te82wrs.cloudfront.net`  
> CloudFront distribution ID: `EZFMFR4SQJP2E`  
> S3 bucket region: `ap-south-1`  
> ACM certificate region for CloudFront: `us-east-1`

This guide uses Windows PowerShell and AWS CLI. Replace every example domain with your real, registered domain. Do not run the domain commands with the placeholder `YOUR-DOMAIN.tech`.

---

## 0. Decide which DNS approach to use

There are two valid approaches.

### Option A — Route 53 DNS (recommended for apex + `www`)

This supports both:

- `https://example.tech`
- `https://www.example.tech`

You create a **public Route 53 hosted zone**, then change the domain's authoritative nameservers at its registrar to the four Route 53 nameservers.

**Cost note:** Route 53 currently charges `$0.50 per hosted zone per month` for the first 25 hosted zones. Domain registration/renewal is a separate cost. Check current pricing before proceeding:
https://aws.amazon.com/route53/pricing/

### Option B — Keep DNS at the domain registrar (avoid Route 53 hosted-zone fees)

This can avoid the Route 53 hosted-zone charge. The simplest supported setup is to use only a subdomain such as:

- `https://www.example.tech`

In this option, request the ACM certificate for `www.example.tech`, add ACM's DNS-validation CNAME at the registrar's DNS manager, then add a regular CNAME record for `www` pointing to `d1y2n75te82wrs.cloudfront.net`.

The apex/root name (`example.tech`) cannot use an ordinary CNAME. To point the apex at CloudFront without Route 53, the DNS provider must support an ALIAS, ANAME, or CNAME-flattening feature. Otherwise use the `www` address only.

The rest of the main steps below show **Option A (Route 53)**. See Section 10 for the registrar-DNS variation.

---

## 1. Register the domain

1. Redeem a student-domain offer only if the provider confirms eligibility.
2. Confirm that the checkout total is what you expect before placing the order.
3. Review the renewal price and auto-renewal setting. A first-year offer does not mean future renewals are free.
4. Finish registration and confirm that the domain appears in your registrar account.
5. Keep access to that registrar account and the email used to register the domain.

Choose a root domain, for example `example.tech`. In the commands below, do not include `https://` or `www` in `$DomainName`.

---

## 2. Set variables in PowerShell

Run this block from the local VELORA project directory. Change only `$DomainName` to the domain you actually registered.

```powershell
$DomainName = "YOUR-DOMAIN.tech"   # Example format only; replace with your real domain
$WwwName = "www.$DomainName"

$DistributionId = "EZFMFR4SQJP2E"
$DistributionDomain = "d1y2n75te82wrs.cloudfront.net"

$CertificateRegion = "us-east-1"
```

Validate the configured AWS identity:

```powershell
aws sts get-caller-identity
```

Make sure it is the AWS account that owns distribution `EZFMFR4SQJP2E`.

---

## 3. Create a Route 53 public hosted zone (Option A only)

**Do not create a second hosted zone if you already have a public hosted zone for this exact domain.** Duplicate hosted zones can make DNS confusing and may add charges.

First check:

```powershell
aws route53 list-hosted-zones-by-name --dns-name $DomainName --output table
```

If no existing public hosted zone exists for this domain, create one.

### 3.1 Write the hosted-zone configuration

```powershell
$zoneConfig = [ordered]@{
    Comment = "Public DNS zone for VELORA"
    PrivateZone = $false
}

$zoneJson = $zoneConfig | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText(
    (Join-Path $PWD "route53-hosted-zone-config.json"),
    $zoneJson,
    [System.Text.UTF8Encoding]::new($false)
)
```

### 3.2 Create the hosted zone

```powershell
$callerReference = [guid]::NewGuid().ToString()

$zoneResult = aws route53 create-hosted-zone `
    --name $DomainName `
    --caller-reference $callerReference `
    --hosted-zone-config file://route53-hosted-zone-config.json `
    --output json | ConvertFrom-Json

$ZoneId = $zoneResult.HostedZone.Id -replace '^/hostedzone/', ''

Write-Host "Hosted zone ID: $ZoneId" -ForegroundColor Green
$zoneResult.DelegationSet.NameServers
```

Save the `$ZoneId` value for the next steps.

### 3.3 Delegate DNS to Route 53

If your domain was registered with a provider other than Route 53:

1. Open that provider's domain-management page.
2. Find **Nameservers** or **DNS delegation**.
3. Replace the current authoritative nameservers with the four nameservers output by the command above.
4. Save the change.

Do not copy example nameservers from a tutorial. Use the four values returned for **your** hosted zone.

DNS delegation can take time to propagate. If the domain already has important DNS records (email, verification records, etc.), copy those records into the new hosted zone before switching nameservers.

---

## 4. Request a public ACM certificate in `us-east-1`

CloudFront requires its ACM viewer certificate to be in **US East (N. Virginia), `us-east-1`**, even though the S3 bucket is in `ap-south-1`.

This example requests a certificate for both the apex domain and `www`:

```powershell
$CertificateArn = aws acm request-certificate `
    --region us-east-1 `
    --domain-name $DomainName `
    --subject-alternative-names $WwwName `
    --validation-method DNS `
    --query CertificateArn `
    --output text

Write-Host "Certificate ARN: $CertificateArn" -ForegroundColor Green
```

Keep `$CertificateArn` in the current PowerShell session. If you close that window, set it again using the ARN returned by ACM:

```powershell
$CertificateArn = "PASTE-YOUR-ISSUED-OR-PENDING-CERTIFICATE-ARN-HERE"
```

---

## 5. Validate the ACM certificate through DNS

ACM issues the certificate only after it can verify that you control the domain names.

### Option A — Automatically create the validation CNAME records in Route 53

Wait briefly for ACM to generate the validation records, then inspect them:

```powershell
Start-Sleep -Seconds 15

$certInfo = aws acm describe-certificate `
    --region us-east-1 `
    --certificate-arn $CertificateArn `
    --output json | ConvertFrom-Json

$certInfo.Certificate.DomainValidationOptions |
    Select-Object DomainName, ValidationStatus, ResourceRecord
```

If the `ResourceRecord` field is still empty for any name, wait a little longer and rerun the inspection command.

When records are present, create a Route 53 change batch:

```powershell
$certInfo = aws acm describe-certificate `
    --region us-east-1 `
    --certificate-arn $CertificateArn `
    --output json | ConvertFrom-Json

$changes = @()

foreach ($option in $certInfo.Certificate.DomainValidationOptions) {
    if ($null -ne $option.ResourceRecord) {
        $record = $option.ResourceRecord

        $changes += @{
            Action = "UPSERT"
            ResourceRecordSet = @{
                Name = $record.Name
                Type = $record.Type
                TTL = 300
                ResourceRecords = @(
                    @{
                        Value = $record.Value
                    }
                )
            }
        }
    }
}

if ($changes.Count -eq 0) {
    throw "ACM validation records are not available yet. Wait and rerun the describe-certificate command."
}

$batch = [ordered]@{
    Comment = "ACM DNS validation for VELORA"
    Changes = @($changes)
}

$batchJson = $batch | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText(
    (Join-Path $PWD "acm-validation-change-batch.json"),
    $batchJson,
    [System.Text.UTF8Encoding]::new($false)
)

aws route53 change-resource-record-sets `
    --hosted-zone-id $ZoneId `
    --change-batch file://acm-validation-change-batch.json
```

### Option B — DNS is still hosted at the registrar

Do **not** run the Route 53 change command. Instead:

1. Run the `describe-certificate` command above.
2. For each `ResourceRecord`, create the exact CNAME record shown by ACM at your registrar's DNS manager.
3. Copy the record **Name** and **Value** exactly. Registrars sometimes automatically append the domain name, so check the provider's instructions to avoid duplicating it.
4. Wait for DNS to propagate.

### 5.1 Wait for certificate issuance

After the validation records have been added to the active DNS provider, run:

```powershell
aws acm wait certificate-validated `
    --region us-east-1 `
    --certificate-arn $CertificateArn
```

Then verify:

```powershell
aws acm describe-certificate `
    --region us-east-1 `
    --certificate-arn $CertificateArn `
    --query "Certificate.Status" `
    --output text
```

Expected result:

```text
ISSUED
```

Do not continue until the status is `ISSUED`.

---

## 6. Update CloudFront to use the custom domain and certificate

This step replaces the distribution's viewer certificate configuration and adds the alternate domain names. It does **not** change the S3 origin or OAC.

### Important safety notes

- The alias names must be lowercase and must be covered by the ACM certificate.
- The certificate must be in `us-east-1`.
- Preserve the current distribution configuration; CloudFront updates replace the full configuration, not just individual fields.
- CloudFront uses an ETag as a version guard. Use the fresh ETag returned by `get-distribution-config`.

### 6.1 Fetch the latest configuration and ETag

```powershell
$current = aws cloudfront get-distribution-config `
    --id $DistributionId `
    --output json | ConvertFrom-Json

$ETag = $current.ETag
$config = $current.DistributionConfig

Write-Host "Current ETag: $ETag"
Write-Host "Current aliases: $($config.Aliases.Items -join ', ')"
```

### 6.2 Add the aliases and certificate

This main Route 53 path configures both the root domain and `www`:

```powershell
$existingAliases = @()

if ($config.Aliases.Quantity -gt 0) {
    $existingAliases = @($config.Aliases.Items)
}

$aliases = @($existingAliases + @($DomainName, $WwwName) | Select-Object -Unique)

$config.Aliases = [PSCustomObject]@{
    Quantity = $aliases.Count
    Items = $aliases
}

$config.ViewerCertificate = [PSCustomObject]@{
    CloudFrontDefaultCertificate = $false
    ACMCertificateArn = $CertificateArn
    SSLSupportMethod = "sni-only"
    MinimumProtocolVersion = "TLSv1.2_2021"
}

$configJson = $config | ConvertTo-Json -Depth 100

[System.IO.File]::WriteAllText(
    (Join-Path $PWD "cloudfront-config-custom-domain.json"),
    $configJson,
    [System.Text.UTF8Encoding]::new($false)
)
```

### 6.3 Submit the update

```powershell
aws cloudfront update-distribution `
    --id $DistributionId `
    --if-match $ETag `
    --distribution-config file://cloudfront-config-custom-domain.json
```

If AWS reports an ETag mismatch, fetch the latest configuration again and repeat the edits using the new ETag. Do not reuse a stale ETag.

### 6.4 Wait for deployment

```powershell
aws cloudfront wait distribution-deployed --id $DistributionId
```

Or inspect its status:

```powershell
aws cloudfront get-distribution `
    --id $DistributionId `
    --query "Distribution.Status" `
    --output text
```

Expected result:

```text
Deployed
```

---

## 7. Point Route 53 to CloudFront (Option A)

Do this only after the distribution update is deployed. CloudFront requires each alias in DNS to match an alternate domain name on the distribution.

### 7.1 Create alias records for the root and `www`

The standard Route 53 hosted-zone ID for CloudFront alias targets is `Z2FDTNDATAQYW2`. The target distribution domain used here is this project's existing CloudFront hostname.

```powershell
$dnsBatch = [ordered]@{
    Comment = "Point VELORA domain to CloudFront"
    Changes = @(
        @{
            Action = "UPSERT"
            ResourceRecordSet = @{
                Name = $DomainName
                Type = "A"
                AliasTarget = @{
                    HostedZoneId = "Z2FDTNDATAQYW2"
                    DNSName = "$DistributionDomain."
                    EvaluateTargetHealth = $false
                }
            }
        },
        @{
            Action = "UPSERT"
            ResourceRecordSet = @{
                Name = $DomainName
                Type = "AAAA"
                AliasTarget = @{
                    HostedZoneId = "Z2FDTNDATAQYW2"
                    DNSName = "$DistributionDomain."
                    EvaluateTargetHealth = $false
                }
            }
        },
        @{
            Action = "UPSERT"
            ResourceRecordSet = @{
                Name = $WwwName
                Type = "A"
                AliasTarget = @{
                    HostedZoneId = "Z2FDTNDATAQYW2"
                    DNSName = "$DistributionDomain."
                    EvaluateTargetHealth = $false
                }
            }
        },
        @{
            Action = "UPSERT"
            ResourceRecordSet = @{
                Name = $WwwName
                Type = "AAAA"
                AliasTarget = @{
                    HostedZoneId = "Z2FDTNDATAQYW2"
                    DNSName = "$DistributionDomain."
                    EvaluateTargetHealth = $false
                }
            }
        }
    )
}

$dnsJson = $dnsBatch | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText(
    (Join-Path $PWD "route53-cloudfront-aliases.json"),
    $dnsJson,
    [System.Text.UTF8Encoding]::new($false)
)

aws route53 change-resource-record-sets `
    --hosted-zone-id $ZoneId `
    --change-batch file://route53-cloudfront-aliases.json
```

### 7.2 Check DNS resolution

```powershell
Resolve-DnsName $DomainName
Resolve-DnsName $WwwName
```

DNS changes often propagate quickly, but caches may make it take longer.

---

## 8. Verify the site

Test each name you configured:

```powershell
curl.exe -I "https://$DomainName"
curl.exe -I "https://$WwwName"
```

Open both URLs in a browser as well. Confirm:

- The page loads over HTTPS without a certificate warning.
- CSS and JavaScript load.
- Images and all sections appear.
- The browser shows the intended hostname.
- The previous CloudFront URL still works:

  `https://d1y2n75te82wrs.cloudfront.net`

If only `www` was configured under Option B, test only `https://www.<your-domain>`; the root domain is not automatically covered.

---

## 9. Update the project website links (optional)

After the custom hostname is confirmed working, you can change links on the project page that currently point to the default CloudFront URL.

Search:

```powershell
Select-String -Path index.html -Pattern "d1y2n75te82wrs.cloudfront.net"
```

Replace those links only after the custom domain works. Then run:

```powershell
.\deploy.ps1
```

Wait for the returned invalidation ID to become `Completed`, then hard-refresh the live site.

---

## 10. Route 53-free variation (Option B)

Use this if you want to avoid the separate Route 53 hosted-zone fee.

1. Register the domain with the chosen registrar.
2. Keep the registrar's DNS service active. Do **not** create a Route 53 hosted zone.
3. Set the name variables as in Section 2.
4. Request the certificate for `www` only:

   ```powershell
   $CertificateArn = aws acm request-certificate `
       --region us-east-1 `
       --domain-name $WwwName `
       --validation-method DNS `
       --query CertificateArn `
       --output text
   ```

5. Read ACM's validation CNAME using Section 5 and add it at the registrar's DNS manager. Wait for the certificate status `ISSUED`.
6. In Section 6, set the CloudFront aliases to **only** `www.$DomainName`:

   ```powershell
   $aliases = @($existingAliases + $WwwName | Select-Object -Unique)
   ```

   Keep the same `ViewerCertificate` block and ETag update procedure. Do not add the apex/root domain as an alias in this variant.

7. After the CloudFront distribution is `Deployed`, create a DNS CNAME at the registrar:

   | Field | Value |
   |---|---|
   | Type | `CNAME` |
   | Host / Name | `www` |
   | Target / Value | `d1y2n75te82wrs.cloudfront.net` |
   | TTL | Provider default or 300 |

8. Test `https://www.<your-domain>`.

The apex/root domain will remain separate unless your DNS provider supports ALIAS, ANAME, or CNAME flattening. This variant does not need a Route 53 hosted zone.

---

## 11. Files to keep local (do not commit)

During these steps you may create files containing account/resource details or DNS configuration. Keep them local and out of Git:

- `.deploy-config.ps1`
- `cloudfront-config.json`
- `cloudfront-config-custom-domain.json`
- `s3-bucket-policy.json`
- `route53-hosted-zone-config.json`
- `acm-validation-change-batch.json`
- `route53-cloudfront-aliases.json`

Add these patterns to `.gitignore` if they are not already present:

```gitignore
.deploy-config.ps1
cloudfront-config*.json
s3-bucket-policy.json
route53-hosted-zone-config.json
acm-validation-change-batch.json
route53-cloudfront-aliases.json
```

Never store access keys, secret keys, session tokens, private keys, or credentials in frontend files or Git.

---

## 12. Troubleshooting

### ACM stays `PENDING_VALIDATION`
- Confirm the domain is delegated to the DNS provider where you created the validation record.
- Confirm the CNAME name and value exactly match ACM's values.
- Do not delete ACM validation CNAME records after validation; leaving them helps ACM managed renewal.

### CloudFront refuses to add the alias
- The certificate must be `ISSUED` in `us-east-1`.
- The certificate must cover every alias you are adding.
- Ensure the alias is not already associated with a different CloudFront distribution.

### The domain returns an error after the update
- Check the distribution status is `Deployed`.
- Confirm the DNS record targets `d1y2n75te82wrs.cloudfront.net`.
- Confirm DNS changes are visible.
- Re-test the default CloudFront hostname to distinguish a DNS/certificate issue from an origin issue.

### `update-distribution` returns an ETag error
Fetch `get-distribution-config` again, reapply the changes to the latest configuration, write a new JSON file, and retry with the latest ETag.

### Site works at CloudFront hostname but not custom domain
The S3 origin and OAC are likely still working. Focus on certificate SAN coverage, distribution aliases, DNS records, and DNS propagation.

---

## 13. Cost and cleanup notes

- Domain registration/renewal pricing is set by the registrar and TLD.
- A Route 53 hosted zone adds a separate monthly charge; verify current rates before creating one.
- ACM certificates requested from ACM for use with integrated AWS services are typically provided without an additional certificate charge, but always review current AWS terms.
- S3 and CloudFront usage may still be billable depending on your AWS account plan and usage.
- A domain benefit that is free for the first year may renew at a paid rate. Review auto-renewal and renewal pricing at the registrar.
- If stopping the website, preserve evidence first. Disable a CloudFront distribution before deleting it, wait for the change to deploy, then delete the distribution. Empty the S3 bucket before deleting it. Remove an unused Route 53 hosted zone if you no longer need it, and update registrar nameservers first if you want DNS to keep working elsewhere.

---

## Official documentation

- CloudFront alternate domain names: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html
- CloudFront certificate requirements: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html
- Configure alternate domain names and HTTPS: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html
- Route 53 to CloudFront: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-cloudfront-distribution.html
- Route 53 pricing: https://aws.amazon.com/route53/pricing/
- ACM DNS validation: https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html

**Status:** Future-use runbook. No custom domain, ACM custom certificate, or Route 53 hosted zone is configured by this document itself.
