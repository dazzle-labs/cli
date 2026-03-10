import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { apiKeyClient } from "../../client.js";
import type { Framework } from "./frameworks";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Check, PartyPopper, Plus, Loader2 } from "lucide-react";
import { springs, scaleIn } from "@/lib/motion";

interface ConnectionDetailsProps {
  framework: Framework;
  endpointId: string;
  /** Pre-created API key (from guided path). If null, we check for existing keys. */
  apiKey: string | null;
  onDone: () => void;
  verbose?: boolean;
}

export function ConnectionDetails({ framework, endpointId: _endpointId, apiKey: initialKey, onDone, verbose }: ConnectionDetailsProps) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [activeKey, setActiveKey] = useState(initialKey);
  const [hasExistingKeys, setHasExistingKeys] = useState<boolean | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // If no key was provided, check if user has existing keys
  useEffect(() => {
    if (initialKey) {
      setHasExistingKeys(true);
      return;
    }
    async function check() {
      try {
        const resp = await apiKeyClient.listApiKeys({});
        if (resp.keys.length > 0) {
          setHasExistingKeys(true);
        } else {
          // No keys at all — auto-create one
          const keyResp = await apiKeyClient.createApiKey({ name: `endpoint-${Date.now()}` });
          setActiveKey(keyResp.secret);
          setHasExistingKeys(false);
        }
      } catch {
        setHasExistingKeys(true);
      }
    }
    check();
  }, [initialKey]);

  async function handleCreateKey() {
    setCreatingKey(true);
    try {
      const resp = await apiKeyClient.createApiKey({ name: `endpoint-${Date.now()}` });
      setActiveKey(resp.secret);
    } catch {
      // ignore
    } finally {
      setCreatingKey(false);
    }
  }

  const snippet = framework.getSnippet();

  async function handleCopySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }

  async function handleCopyKey() {
    if (!activeKey) return;
    await navigator.clipboard.writeText(activeKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  // Still loading key check
  if (!initialKey && hasExistingKeys === null) {
    return (
      <div className="flex flex-col items-center">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </div>
    );
  }

  const maskedKey = activeKey
    ? `${activeKey.slice(0, 8)}${"•".repeat(24)}`
    : null;

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 font-display">
        {verbose ? "Get started with the CLI" : "Get Started"}
      </h2>
      <p className="text-base text-muted-foreground mb-6 max-w-md text-center">
        {verbose
          ? "Install the Dazzle CLI to control your stage."
          : "Use the CLI to manage your stage."}
      </p>

      <div className="w-full max-w-lg">
        {/* Code snippet */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-medium text-muted-foreground">{framework.language}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopySnippet}
              className="text-sm text-muted-foreground hover:text-primary"
            >
              {copiedSnippet ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <pre className="p-4 text-sm font-mono text-foreground overflow-x-auto leading-relaxed">
            {snippet}
          </pre>
        </div>

        {/* API key section */}
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              Authenticate with <code className="text-primary bg-muted px-1 py-0.5 rounded">dazzle login</code>
            </p>
            <p className="text-sm text-muted-foreground">
              Or set <code className="text-muted-foreground">export DAZZLE_API_KEY=&lt;key&gt;</code> in your shell profile.
            </p>
          </div>

          {activeKey ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono text-muted-foreground bg-card rounded-lg px-3 py-2 border border-border truncate min-w-0">
                {maskedKey}
              </code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyKey}
                    className="text-muted-foreground hover:text-primary shrink-0"
                    aria-label="Copy API key"
                  >
                    {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy API key</TooltipContent>
              </Tooltip>
            </div>
          ) : hasExistingKeys ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-muted-foreground">
                Use an existing key from the API Keys page, or create a new one.
              </p>
              <Button
                size="sm"
                onClick={handleCreateKey}
                disabled={creatingKey}
                className="font-semibold text-sm shrink-0"
              >
                {creatingKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New key
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>

        {/* Success celebration */}
        <motion.div
          className="mt-8 flex flex-col items-center gap-3"
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          transition={{ ...springs.bouncy, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 text-primary">
            <motion.div
              initial={{ rotate: -15, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={springs.bouncy}
            >
              <PartyPopper className="h-5 w-5" />
            </motion.div>
            <span className="text-base font-medium">You're all set!</span>
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Button
              onClick={onDone}
              className="font-semibold"
            >
              Go to Dashboard
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
