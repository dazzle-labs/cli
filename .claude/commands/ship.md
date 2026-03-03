Commit, push, build, and deploy the current changes. Follow these steps in order:

1. **Commit**: Stage all relevant changed files (not untracked files unless they are clearly part of the current work). Write a concise commit message summarizing the changes. Do not commit files that may contain secrets (.env, credentials, etc).

2. **Push**: Check if a git remote is configured (`git remote -v`). If a remote exists, push. If not, skip this step silently.

3. **Build & Deploy**: Run `make build deploy` to build images on the remote host and deploy to k8s.

If any step fails, stop and report the error rather than continuing.
