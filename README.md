# VELORA Cloud Delivery — AWS Project Showcase

A static, responsive project showcase explaining an end-to-end AWS static website delivery architecture.

## Live site

https://d1y2n75te82wrs.cloudfront.net

## Architecture

Browser → Amazon CloudFront (HTTPS) → Origin Access Control (SigV4) → private Amazon S3 bucket.

## Implemented

- Static project showcase built with HTML, CSS, and vanilla JavaScript
- Private S3 bucket with all four Block Public Access controls enabled
- CloudFront distribution using the CloudFront-provided HTTPS certificate
- Origin Access Control with SigV4 signing
- S3 bucket policy scoped to the specific CloudFront distribution
- PowerShell deployment script (`deploy.ps1`) to sync site files and request a CloudFront invalidation

## Why no custom domain?

This project intentionally uses the default CloudFront `*.cloudfront.net` hostname. A custom domain, Route 53 hosted zone, and custom ACM certificate are optional extensions and are not required for this project to work.

## Local preview

From the project folder run:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish updates

After updating the frontend, run:

```powershell
.\deploy.ps1
```

The script syncs files to the configured S3 bucket and creates a CloudFront invalidation. Review the script's exclusions and bucket/distribution identifiers before running it.

## File overview

- `index.html` — all showcase content and architecture details
- `css/style.css` — layout, visual styling, responsive rules, readable typography
- `js/app.js` — mobile navigation, copy buttons, active navigation indicators
- `deploy.ps1` — PowerShell deployment script (kept separately in the working project folder)

## Security note

Never commit AWS credentials, access-key CSVs, private keys, or other secrets. Keep account-specific configuration out of the public repository.
