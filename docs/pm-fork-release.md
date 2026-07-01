# PM Fork Release Notes

This fork keeps the upstream Notero extension ID, `notero@vanoni.dev`, so Zotero
treats the forked XPI as an in-place update. Do not change the ID unless you
want a separate plugin install and a fresh Notion setup.

## Release Channel

The install manifest is generated from `package.json`. The fork-owned updater is:

```text
https://github.com/pmmendoza/notero/releases/download/release/updates.json
```

The `Release` workflow is manually dispatched with a deterministic version such
as `1.2.4-pm.1`. It runs verification, builds the XPI, publishes the XPI to
`v<version>`, generates `updates.json`, and publishes the update manifest to the
stable `release` tag.

Use `Update Manifest` only to repair or regenerate `updates.json` for an already
published XPI.

## Public-Clean Gate

Before making the fork public or publishing release assets, verify that tracked
files do not include local credentials or generated artifacts:

```bash
git status --short
git ls-files | rg '(^|/)(\.env|zotero\.config\.json|gen/|build/|xpi/|.*\.xpi|.*\.log|.*\.tmp)$'
git ls-files | xargs rg --with-filename -n -I '(ghp_|github_pat_|BEGIN (RSA|OPENSSH|PRIVATE)|Bearer [A-Za-z0-9._-]+|notion(_|-)?token|api[_-]?key|client[_-]?secret|password|refresh[_-]?token|access[_-]?token)'
```

Expected findings are source-code field names, localization labels, docs prose,
or GitHub Actions references such as `secrets.GITHUB_TOKEN`. Literal credentials
must be removed before publication.

## Local Verification

For a local deterministic build:

```bash
pnpm clean
mkdir -p gen
printf '"1.2.4-pm.1"\n' > gen/version.json
pnpm verify
pnpm build
pnpm create-xpi
unzip -p xpi/notero-1.2.4-pm.1.xpi manifest.json | jq '.applications.zotero'
```

The manifest must keep `id: "notero@vanoni.dev"` and point `update_url` at the
fork-owned `updates.json`.
