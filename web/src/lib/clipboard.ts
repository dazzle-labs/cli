/**
 * Copy text to clipboard with fallback for mobile browsers.
 *
 * Mobile Safari and some Android browsers revoke the transient user-activation
 * before an async navigator.clipboard.writeText() resolves (especially when
 * preceded by a fetch). The fallback uses a temporary textarea +
 * document.execCommand("copy") which works synchronously.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback: create a temporary textarea, select, and execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    // Avoid scroll-jump and keep it off-screen
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
