# Code signing

Signing is **optional and opt-in**. Limboo stores no signing credentials in the
repository; signing is driven entirely by provider secrets. When no signing secrets are
present, builds are unsigned and [`verify-signing.mjs`](../../ci/scripts/verify-signing.mjs)
prints "signing not configured" and exits 0, so dev/PR builds never fail.

## macOS

Required secrets (GitLab masked+protected CI/CD variable names; the GitHub Actions
equivalents are the same variable names):

| Secret | Description |
| ------ | ----------- |
| `CSC_LINK` | base64-encoded `.p12` Developer ID Application certificate |
| `CSC_KEY_PASSWORD` | password for the `.p12` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

Electron Forge / `@electron/osx-sign` pick these up from the environment during
`npm run make`. After signing, `verify-signing.mjs` runs `codesign --verify --deep
--strict` and (where available) a Gatekeeper assessment.

## Windows

| Secret | Description |
| ------ | ----------- |
| `WINDOWS_CERTIFICATE` | base64-encoded `.pfx` code-signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | password for the `.pfx` |

The Squirrel maker signs the installer when these are configured;
`verify-signing.mjs` runs `signtool verify /pa`. For EV/cloud HSM signing (e.g.
Azure Trusted Signing, DigiCert KeyLocker), supply the provider's env vars instead and
extend `verify-signing.mjs` if a different verification command is needed.

## Linux

`.deb`/`.rpm` are not Authenticode/codesign-signed. Integrity is provided by
`SHA256SUMS` plus repository GPG signing if you publish to an apt/rpm repo. The build
provenance attestation covers all platforms regardless.

## Encoding a certificate as a secret

```bash
base64 -w0 certificate.p12   # Linux
base64 -i certificate.p12    # macOS
```

Paste the output as the secret value. Never commit the certificate or its password.

## Rotation

Rotate certificates before expiry. Because credentials live only in the provider secret
store, rotation is a secret update with no code change.
