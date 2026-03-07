Commit and push the current changes. CI/CD handles build and deploy automatically.

1. **Commit**: Stage all relevant changed files (not untracked files unless they are clearly part of the current work). Write a concise commit message summarizing the changes. Do not commit files that may contain secrets (.env, credentials, etc).

2. **Push**: Push to the remote.

If any step fails, stop and report the error rather than continuing.
