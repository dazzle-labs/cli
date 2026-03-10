import { useEffect, useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { apiKeyClient } from "../client.js";
import type { ApiKey } from "../gen/api/v1/apikey_pb.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Key, Trash2, Shield, AlertTriangle, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CopyButton } from "@/components/CopyButton";
import { springs } from "@/lib/motion";

function CreateKeyForm({ onCreated }: { onCreated: (secret: string) => void }) {
  const [name, setName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const resp = await apiKeyClient.createApiKey({ name: name.trim() });
    setName("");
    onCreated(resp.secret);
  }

  return (
    <Card className="mb-8">
      <CardContent>
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-col gap-1.5 sm:max-w-xs flex-1">
            <Label htmlFor="key-name">Key name</Label>
            <Input id="key-name" type="text" placeholder="e.g. my-agent" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" className="font-semibold sm:self-end">
            Create Key
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const KeysTable = memo(function KeysTable({ keys, onDelete }: { keys: ApiKey[]; onDelete: (id: string) => void }) {
  return (
    <>
      {/* Desktop table */}
      <div className="rounded-xl border overflow-x-auto hidden sm:block bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence>
              {keys.map((k) => (
                <motion.tr
                  key={k.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.snappy}
                  className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  <TableCell className="text-foreground">{k.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {k.prefix}
                    </code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.createdAt ? timestampDate(k.createdAt).toLocaleDateString() : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.lastUsedAt ? timestampDate(k.lastUsedAt).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Delete API key"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this API key?</AlertDialogTitle>
                          <AlertDialogDescription>This will revoke the key immediately. Any agents using it will lose access.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => onDelete(k.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </motion.tr>
              ))}
            </AnimatePresence>
          </TableBody>
        </Table>
      </div>

      {/* Mobile list */}
      <div className="flex flex-col divide-y divide-border/50 sm:hidden rounded-xl border bg-card">
        <AnimatePresence>
          {keys.map((k) => (
            <motion.div
              key={k.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={springs.snappy}
              className="flex items-center gap-3 py-3 px-4"
            >
              <Key className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground truncate block mb-1">{k.name}</span>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <code className="text-[11px] font-mono bg-muted px-1.5 py-px rounded">{k.prefix}</code>
                  <span className="text-border">·</span>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <span>{k.createdAt ? timestampDate(k.createdAt).toLocaleDateString() : ""}</span>
                    </TooltipTrigger>
                    <TooltipContent>Created</TooltipContent>
                  </Tooltip>
                  <span className="text-border">·</span>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <span>{k.lastUsedAt ? timestampDate(k.lastUsedAt).toLocaleDateString() : "Never"}</span>
                    </TooltipTrigger>
                    <TooltipContent>Last used</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    aria-label="Delete API key"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this API key?</AlertDialogTitle>
                    <AlertDialogDescription>This will revoke the key immediately. Any agents using it will lose access.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => onDelete(k.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
});

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const refresh = useCallback(async () => {
    const resp = await apiKeyClient.listApiKeys({});
    setKeys(resp.keys);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreated(secret: string) {
    setNewSecret(secret);
    await refresh();
  }

  const handleDelete = useCallback(async (id: string) => {
    await apiKeyClient.deleteApiKey({ id });
    const resp = await apiKeyClient.listApiKeys({});
    setKeys(resp.keys);
  }, []);

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
          API Keys
        </h1>
        <p className="text-base text-muted-foreground">
          Keys for CLI and agent authentication. The full key is shown only once.
        </p>
      </div>

      {/* Security best practices */}
      <Alert className="mb-6">
        <Shield className="h-4 w-4" />
        <AlertTitle>Security best practices</AlertTitle>
        <AlertDescription>Store keys in environment variables, never in source code. Rotate keys periodically. Create separate keys per agent for easier revocation.</AlertDescription>
      </Alert>

      {/* Create form */}
      <CreateKeyForm onCreated={handleCreated} />

      {/* New key reveal */}
      <AnimatePresence onExitComplete={() => { setNewSecret(null); setDismissing(false); }}>
        {newSecret && !dismissing && (
          <motion.div
            layout
            className="relative rounded-xl border border-primary/20 bg-primary/[0.05] animate-attention-ring p-5 mb-8"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.15 } }}
            transition={springs.gentle}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setDismissing(true)}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 mb-3 pr-8">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-base font-medium text-primary">New API key created — copy it now, it won't be shown again</p>
            </div>
            <div className="relative mb-3">
              <pre className="font-mono text-sm text-foreground bg-card rounded-lg pl-4 pr-10 py-2.5 whitespace-pre-wrap break-all border border-border">
                {newSecret}
              </pre>
              <CopyButton text={newSecret} tooltip="Copy API key" className="absolute top-1.5 right-1.5" size="icon-xs" />
            </div>
            <div className="relative mb-4">
              <code className="block font-mono text-sm text-muted-foreground bg-card rounded-lg pl-4 pr-10 py-2 border border-border break-all">
                export DAZZLE_API_KEY={newSecret}
              </code>
              <CopyButton text={`export DAZZLE_API_KEY=${newSecret}`} tooltip="Copy export command" className="absolute top-1.5 right-1.5" size="icon-xs" />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setDismissing(true)}
            >
              I've saved my key, dismiss
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : keys.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Key className="h-7 w-7" /></EmptyMedia>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>Create one to authenticate your agents.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <KeysTable keys={keys} onDelete={handleDelete} />
      )}
    </AnimatedPage>
  );
}
