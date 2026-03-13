import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SignIn, useAuth, useUser } from "@clerk/react";
import { setTokenGetter } from "../client.js";
import { cli } from "@/lib/cli-commands";

type SessionStatus = "loading" | "not_found" | "expired" | "sign_in" | "verify" | "confirming" | "done" | "error";

export function CliAuth() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [verifyCode, setVerifyCode] = useState("");
  const [, setKeyName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [sessionType, setSessionType] = useState<"login" | "destination">("login");

  // Destination OAuth callback: platform & username come from query params
  const platform = searchParams.get("platform");
  const platformUsername = searchParams.get("username");

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
          setKeyName(data.key_name || "");
          setSessionType(data.type === "destination" ? "destination" : "login");

          // Destination sessions from OAuth callback go straight to verify
          if (data.type === "destination" && platform) {
            setStatus("verify");
          } else {
            setStatus(isSignedIn ? "verify" : "sign_in");
          }
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

  // Fetch verify code when in verify state
  useEffect(() => {
    if (status !== "verify" || !sessionId) return;

    // Login sessions require Clerk auth to fetch verify code
    if (sessionType === "login") {
      if (!isSignedIn) return;
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
    } else {
      // Destination sessions: fetch verify code without auth (session ownership validated server-side)
      fetch(`/auth/cli/session/${sessionId}/poll`)
        .then((r) => r.json())
        .then(() => {
          // The verify code isn't exposed via poll for security — use info endpoint
          // For destination, the user is already authed via OAuth, use that session's ownership
          // We'll get the verify code from the info endpoint with Clerk auth if available
          if (isSignedIn) {
            getToken().then((token) => {
              fetch(`/auth/cli/session/${sessionId}/info`, {
                headers: { Authorization: `Bearer ${token}` },
              })
                .then((r) => r.json())
                .then((data) => setVerifyCode(data.verify_code))
                .catch(() => {
                  setStatus("error");
                  setErrorMsg("Failed to load session info");
                });
            });
          }
        });
    }
  }, [status, isSignedIn, sessionId, sessionType, getToken]);

  async function handleConfirm() {
    if (!sessionId) return;
    setStatus("confirming");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Login sessions require Clerk auth for confirm
      if (sessionType === "login" && isSignedIn) {
        const token = await getToken();
        headers["Authorization"] = `Bearer ${token}`;
      }

      const r = await fetch(`/auth/cli/session/${sessionId}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({ verify_code: verifyCode }),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.error || "Confirmation failed");
      }

      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  // Context line shown above the verify code
  const contextLine = sessionType === "destination" && platform
    ? `Connecting ${platform}${platformUsername ? ` — ${platformUsername}` : ""}`
    : user?.primaryEmailAddress
      ? `Signing in as ${user.primaryEmailAddress.emailAddress}`
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md px-6">
        {status === "loading" && (
          <div className="text-center text-zinc-500">Loading...</div>
        )}

        {status === "not_found" && (
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white mb-2">Session Not Found</h2>
            <p className="text-sm text-zinc-400">
              This session may have expired or already been used.
              <br />
              Run <code className="text-zinc-300">{cli.login.full}</code> to try again.
            </p>
          </div>
        )}

        {status === "expired" && (
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white mb-2">Session Expired</h2>
            <p className="text-sm text-zinc-400">
              Run <code className="text-zinc-300">{cli.login.full}</code> to try again.
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
          <div className="text-center">
            {contextLine && (
              <p className="text-sm text-zinc-400 mb-4">{contextLine}</p>
            )}
            <p className="text-sm text-zinc-400 mb-4">
              Verify this code matches your terminal:
            </p>
            <div className="text-3xl font-bold font-mono tracking-[.15em] text-emerald-400 my-4">
              {verifyCode}
            </div>
            <button
              onClick={handleConfirm}
              className="mt-6 rounded-lg bg-emerald-400 px-8 py-3 text-base font-semibold text-zinc-950 hover:bg-emerald-300 transition-colors cursor-pointer"
            >
              Continue
            </button>
            {errorMsg && (
              <p className="text-sm text-red-400 mt-3">{errorMsg}</p>
            )}
          </div>
        )}

        {status === "verify" && !verifyCode && (
          <div className="text-center text-zinc-500">Loading...</div>
        )}

        {(status === "confirming" || status === "done") && (
          <div className="text-center">
            <div className="text-5xl mb-4 text-emerald-400">&#10003;</div>
            <h2 className="text-lg font-semibold text-white mb-2">You're all set!</h2>
            <p className="text-sm text-zinc-400">You can return to your terminal.</p>
          </div>
        )}

        {status === "error" && (
          <div className="text-center">
            <p className="text-sm text-red-400 mb-4">{errorMsg}</p>
            <button
              onClick={() => { setErrorMsg(""); setStatus("verify"); }}
              className="rounded-lg bg-emerald-400 px-8 py-3 text-base font-semibold text-zinc-950 hover:bg-emerald-300 transition-colors cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
