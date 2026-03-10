import { useEffect, useState } from "react";
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
import { Key, Trash2, Shield, AlertTriangle } from "lucide-react";
import { AnimatedPage } from "@/components/AnimatedPage";
import { CopyButton } from "@/components/CopyButton";
import { springs } from "@/lib/motion";

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  async function refresh() {
    const resp = await apiKeyClient.listApiKeys({});
    setKeys(resp.keys);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const resp = await apiKeyClient.createApiKey({ name: name.trim() });
    setNewSecret(resp.secret);
    setName("");
    await refresh();
  }

  async function handleDelete(id: string) {
    await apiKeyClient.deleteApiKey({ id });
    await refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-base pt-12">
        <Spinner className="text-primary" />
        Loading API keys...
      </div>
    );
  }

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

      {/* New key reveal */}
      <AnimatePresence onExitComplete={() => { setNewSecret(null); setDismissing(false); }}>
        {newSecret && !dismissing && (
          <motion.div
            className="rounded-xl border border-primary/20 bg-primary/[0.05] animate-attention-ring"
            initial={{
              height: 0,
              opacity: 0,
              paddingTop: 0,
              paddingBottom: 0,
              marginBottom: 0,
            }}
            animate={{
              height: "auto",
              opacity: 1,
              paddingTop: 20,
              paddingBottom: 20,
              marginBottom: 32,
            }}
            exit={{
              height: 0,
              opacity: 0,
              paddingTop: 0,
              paddingBottom: 0,
              marginBottom: 0,
              transition: { duration: 0.25, ease: "easeOut" },
            }}
            style={{ overflow: "hidden", paddingLeft: 20, paddingRight: 20 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <p className="text-base font-medium text-primary">New API key created — copy it now, it won't be shown again</p>
            </div>
            <div className="flex items-center gap-2 mb-3">
              <pre className="flex-1 font-mono text-sm text-foreground bg-card rounded-lg px-4 py-2.5 break-all border border-border">
                {newSecret}
              </pre>
              <CopyButton text={newSecret} tooltip="Copy API key" />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 font-mono text-sm text-muted-foreground bg-card rounded-lg px-4 py-2 border border-border">
                export DAZZLE_API_KEY={newSecret}
              </code>
              <CopyButton text={`export DAZZLE_API_KEY=${newSecret}`} tooltip="Copy export command" />
            </div>
            <Button
              variant="link"
              size="sm"
              className="text-sm text-muted-foreground hover:text-foreground h-auto p-0"
              onClick={() => setDismissing(true)}
            >
              I've saved it, dismiss
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keys list */}
      {keys.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Key className="h-7 w-7" /></EmptyMedia>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>Create one to authenticate your agents.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Desktop table */}
          <div className="rounded-xl border overflow-x-auto hidden sm:block">
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
                              <AlertDialogAction variant="destructive" onClick={() => handleDelete(k.id)}>Delete</AlertDialogAction>
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

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            <AnimatePresence>
              {keys.map((k) => (
                <motion.div
                  key={k.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.snappy}
                >
                  <Card size="sm">
                    <CardContent>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-base text-foreground font-medium">{k.name}</span>
                        <code className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {k.prefix}
                        </code>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                        <span>{k.createdAt ? timestampDate(k.createdAt).toLocaleDateString() : ""}</span>
                        <span>Used: {k.lastUsedAt ? timestampDate(k.lastUsedAt).toLocaleDateString() : "Never"}</span>
                      </div>
                      <div className="flex justify-end">
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
                              <AlertDialogAction variant="destructive" onClick={() => handleDelete(k.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </AnimatedPage>
  );
}
