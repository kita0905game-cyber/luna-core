# LUNA CORE deployment verification

## Goal

Remove ambiguity between "merged to GitHub main" and "actually running on Cloudflare".

The production verification path is:

```text
feature branch
  -> Pull Request
  -> GitHub Actions Check
  -> merge to main
  -> Cloudflare Workers Builds
  -> Wrangler custom build captures Git identity
  -> wrangler deploy
  -> Cloudflare Version Metadata binding
  -> /health, /hub, /hub/status expose deployed identity
```

## Git identity

Cloudflare Workers Builds injects these build-time environment variables:

- WORKERS_CI_COMMIT_SHA
- WORKERS_CI_BRANCH
- WORKERS_CI_BUILD_UUID

Wrangler runs `scripts/write-build-meta.mjs` as a custom build command before bundling. The script writes those values into `src/build-meta.generated.js` in the ephemeral build workspace.

The deployed Worker therefore reports the exact Git commit that produced the running bundle.

## Cloudflare identity

`wrangler.jsonc` binds Cloudflare Version Metadata as `CF_VERSION_METADATA`.

The runtime exposes:

- versionId
- versionTag
- versionTimestamp

## Verification endpoints

Public:

- GET /health
- GET /hub

Protected:

- GET /hub/status

Each includes a `deployment` object:

```json
{
  "git": {
    "commitSha": "...",
    "branch": "main",
    "buildUuid": "...",
    "source": "cloudflare-workers-builds"
  },
  "cloudflare": {
    "versionId": "...",
    "versionTag": "...",
    "versionTimestamp": "..."
  }
}
```

## Production decision rule

A LUNA CORE change is considered deployed only when:

1. GitHub PR checks succeeded.
2. The PR was merged to main.
3. The public runtime reports `deployment.git.branch === "main"`.
4. `deployment.git.commitSha` equals the expected main commit SHA.
5. Cloudflare `versionId` and `versionTimestamp` are present.

If Git metadata is null or the source is not `cloudflare-workers-builds`, do not claim the Git-connected production deployment was verified.

## Cloudflare Builds configuration

Expected production configuration:

- Git repository: `kita0905game-cyber/luna-core`
- production branch: `main`
- deploy command: `npx wrangler deploy`

No GitHub Actions deployment secret is required for this architecture. GitHub Actions remains the code/test gate; Cloudflare Workers Builds owns production deployment.
