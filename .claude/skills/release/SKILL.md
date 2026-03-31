---
name: release
description: "Release a new CLI version — stamp versions, tag, push, and bump consuming repos. Use when the user says 'release', 'tag a release', 'cut a release', or 'bump the CLI version'."
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# CLI Release

## When to Use
- Cutting a new CLI release after changes are merged to main
- Bumping the CLI version in a consuming repo after a release
- User says "release", "tag", "cut a release", or "ship the CLI"

## Procedure

### 1. Determine the new version

Check the latest tag and recent commits to decide the version bump:

```bash
git tag --sort=-version:refname | head -5
git log --oneline $(git tag --sort=-version:refname | head -1)..HEAD
```

- `feat:` commits → minor bump (0.5.2 → 0.6.0)
- `fix:` commits only → patch bump (0.5.2 → 0.5.3)
- Ask the user if unclear

### 2. Stamp server.json with the new version

```bash
make readme VERSION=<new-version-without-v>
```

This regenerates `README.md` and `server.json` with the correct version and current CLI help output. Commit the result:

```bash
git add README.md server.json
git commit -m "chore: bump version to v<version>"
git push origin main
```

**Note:** The pre-commit hook runs `make readme` (without a VERSION arg), which resets version to "dev". You must pass VERSION explicitly to `make readme` to stamp the real version, then `git add` the generated files before committing so the hook's re-generation sees them already staged.

### 3. Tag and push

```bash
git tag v<version>
git push origin v<version>
```

This triggers the `release.yml` workflow which:
- Validates `server.json` version matches the tag
- Runs goreleaser to build binaries (macOS/Linux/Windows, amd64/arm64)
- Creates a GitHub Release with grouped changelog

### 4. Bump consuming repos

Any repo that imports the CLI as a Go module or git submodule needs updating. Typically:

```bash
make pull-cli
```

This fetches the latest tag, checks out the CLI submodule to it, and updates `go.mod`. Then commit:

```bash
git add cli control-plane/go.mod control-plane/go.sum
git commit -m "chore: bump CLI to v<version> (<summary>)"
git push
```

## Pitfalls

- **Pre-commit hook resets version to "dev"**: The `.githooks/pre-commit` runs `make readme` without a VERSION arg, which stamps "dev" into server.json. Always run `make readme VERSION=X.Y.Z` explicitly and stage the files before committing. If the hook re-runs, it regenerates with "dev" — but since the files are already staged with the correct version, git sees no diff and the commit proceeds with the right version.
- **Release workflow validates server.json**: If `server.json` version doesn't match the tag, the release fails. Don't skip the `make readme VERSION=...` step.
- **Detached HEAD after `pull-cli`**: Consuming repos check out the CLI submodule at the tag (detached HEAD). This is expected. Don't try to commit from within the CLI submodule after this.
- **Consuming repo may have upstream changes**: Always `git pull --rebase` before pushing the CLI bump, especially if other changes have landed on main.
- **Submodule conflicts on rebase**: If a rebase hits a submodule conflict, resolve by ensuring `cli` points to the correct tag commit, then `git add cli && git rebase --continue`.

## Verification

- Release workflow passes: `gh run list --workflow=release.yml --limit 1`
- GitHub Release exists with binaries: `gh release view v<version>`
- Consuming repo CI passes after bump
