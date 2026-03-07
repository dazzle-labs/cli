Commit and push the current changes. CI/CD handles build and deploy automatically.

1. **Diff**: Run `git diff` (staged + unstaged) and `git status` to capture the full picture of all changes — not just what was discussed in the current thread. Every file in the diff must be accounted for in the commit message.

2. **Commit**: Stage all relevant changed files (not untracked files unless they are clearly part of the current work). Write a commit message focused on **why** the change was made, not just what changed. Do not commit files that may contain secrets (.env, credentials, etc).

3. **Push**: Push to the remote.

If any step fails, stop and report the error rather than continuing.
