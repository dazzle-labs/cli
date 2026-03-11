import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { SignIn, useAuth, useUser } from "@clerk/react";
import { setTokenGetter } from "../client.js";

type SessionStatus = "loading" | "not_found" | "expired" | "sign_in" | "verify" | "confirming" | "done" | "error";

export function CliAuth() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [verifyCode, setVerifyCode] = useState("");
  const [keyName, setKeyName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Wire up Clerk token for API calls
  useEffect(() => {
    if (isSignedIn && getToken) {
      setTokenGetter(getToken);
    }
  }, [isSignedIn, getToken]);

  // Fetch session status on mount
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/auth/cli/session/${sessionId}/poll`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || data.status === "expired") {
          setStatus(data.status === "expired" ? "expired" : "not_found");
        } else if (data.status === "pending") {
          setKeyName(data.key_name || "CLI");
          setStatus(isSignedIn ? "verify" : "sign_in");
        } else {
          setStatus("not_found");
        }
      })
      .catch(() => setStatus("not_found"));
  }, [sessionId]);

  // When user signs in, transition to verify
  useEffect(() => {
    if (isSignedIn && status === "sign_in") {
      setStatus("verify");
    }
  }, [isSignedIn, status]);

  // Fetch verify code when signed in and in verify state
  useEffect(() => {
    if (status !== "verify" || !isSignedIn || !sessionId) return;

    (async () => {
      const token = await getToken();
      const r = await fetch(`/auth/cli/session/${sessionId}/info`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        setStatus("error");
        setErrorMsg("Failed to load session info");
        return;
      }
      const data = await r.json();
      setVerifyCode(data.verify_code);
    })();
  }, [status, isSignedIn, sessionId, getToken]);

  async function handleConfirm() {
    if (!sessionId) return;
    setStatus("confirming");

    try {
      const token = await getToken();
      const r = await fetch(`/auth/cli/session/${sessionId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ verify_code: verifyCode }),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.error || "Confirmation failed");
      }

      setStatus("done");
      try { window.close(); } catch {}
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md px-6">
        {status === "loading" && (
          <div className="text-center text-zinc-500">Loading...</div>
        )}

        {status === "not_found" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <h2 className="text-lg font-semibold text-white mb-2">Session Not Found</h2>
            <p className="text-sm text-zinc-400">
              This session may have expired or already been used. Run{" "}
              <code className="text-zinc-300">dazzle login</code> again.
            </p>
          </div>
        )}

        {status === "expired" && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-8 text-center">
            <h2 className="text-lg font-semibold text-white mb-2">Session Expired</h2>
            <p className="text-sm text-zinc-400">
              This session has expired. Run{" "}
              <code className="text-zinc-300">dazzle login</code> again.
            </p>
          </div>
        )}

        {status === "sign_in" && (
          <div className="flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-white mb-1">Sign in to Dazzle</h2>
              <p className="text-sm text-zinc-400">Sign in to complete CLI authentication.</p>
            </div>
            <SignIn forceRedirectUrl={`/auth/cli/${sessionId}`} />
          </div>
        )}

        {status === "verify" && verifyCode && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-zinc-400 mb-2">Verify this code matches your terminal:</p>
            <div className="text-3xl font-bold font-mono tracking-[.15em] text-emerald-400 my-4">
              {verifyCode}
            </div>
            {user?.primaryEmailAddress && (
              <p className="text-sm text-zinc-500 mb-4">
                Signing in as {user.primaryEmailAddress.emailAddress}
                {keyName && <> (API key: "{keyName}")</>}
              </p>
            )}
            <button
              onClick={handleConfirm}
              className="mt-2 rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              Continue
            </button>
          </div>
        )}

        {status === "verify" && !verifyCode && (
          <div className="text-center text-zinc-500">Loading session info...</div>
        )}

        {status === "confirming" && (
          <div className="text-center text-zinc-400">Creating API key...</div>
        )}

        {status === "done" && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <div className="text-4xl mb-4">&#10003;</div>
            <h2 className="text-lg font-semibold text-white mb-2">You're all set!</h2>
            <p className="text-sm text-zinc-400">Return to your terminal.</p>
          </div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <h2 className="text-lg font-semibold text-white mb-2">Error</h2>
            <p className="text-sm text-zinc-400">{errorMsg}</p>
            <button
              onClick={() => setStatus("verify")}
              className="mt-4 rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
