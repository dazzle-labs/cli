# Dazzle CLI demo — full quick start walkthrough
# Run from repo root: vhs vhs/demo.tape
#
# Before recording:
#   cp vhs/mock-dazzle.sh vhs/dazzle && chmod +x vhs/dazzle
#   mkdir -p my-stage && cp vhs/my-stage-v1/index.html my-stage/index.html
#   Create /tmp/vhs-comments with one comment per line

Output vhs/demo.gif
Output vhs/demo.webm

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 14
Set Width 900
Set Height 600
Set Padding 20
Set TypingSpeed 40ms
Set CursorBlink false
Set WindowBar Colorful
Set WindowBarSize 40
Set BorderRadius 8
Set Theme { "name": "Dazzle", "black": "#09090b", "red": "#f87171", "green": "#34d399", "yellow": "#fbbf24", "blue": "#60a5fa", "magenta": "#c084fc", "cyan": "#22d3ee", "white": "#e4e4e7", "brightBlack": "#71717a", "brightRed": "#fca5a5", "brightGreen": "#6ee7b7", "brightYellow": "#fde68a", "brightBlue": "#93c5fd", "brightMagenta": "#d8b4fe", "brightCyan": "#67e8f9", "brightWhite": "#fafafa", "background": "#09090b", "foreground": "#a1a1aa", "selection": "#27272a", "cursor": "#34d399" }

Env PATH "./vhs:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
Env HOME "/Users/johnsabath"
Env DAZZLE_STAGE "demo"

# PS1 reads the next comment from a file and prints it above the prompt
Env PS1 '$(line=$(head -1 /tmp/_vc 2>/dev/null); sed -i "" "1d" /tmp/_vc 2>/dev/null; if [ -n "$line" ]; then echo -e "\n\033[3;38;2;113;113;122m# $line\033[0m"; fi)\n$ '
Env BAT_STYLE "plain"
Env BAT_PAGING "never"
Env BAT_THEME "base16"

# ── Act 1: Create and deploy ──

Sleep 500ms
Type "dazzle stage create demo"
Enter
Sleep 1.5s
Type "dazzle stage up"
Enter
Sleep 3s

Type "cat my-stage/index.html"
Enter
Sleep 2s

Type "dazzle stage sync ./my-stage"
Enter
Sleep 1.5s

# ── Act 2: Add live events ──

Type "cp vhs/my-stage-v2/index.html my-stage/"
Enter
Sleep 800ms
Type "cat my-stage/index.html"
Enter
Sleep 2.5s

Type "dazzle stage sync ./my-stage"
Enter
Sleep 1.5s

# ── Act 3: Push events ──

Type `dazzle stage event emit score '{"points": 42}'`
Enter
Sleep 800ms
Type `dazzle stage event emit score '{"points": 99}'`
Enter
Sleep 1.5s

# ── Act 4: Persistence ──

Type "dazzle stage down"
Enter
Sleep 1.5s
Type "dazzle stage up"
Enter
Sleep 2.5s

# ── Act 5: Go live ──

Type "dazzle destination attach my-twitch"
Enter
Sleep 1.5s
Type "dazzle stage status"
Enter
Sleep 2s

# Hold
Sleep 5s
