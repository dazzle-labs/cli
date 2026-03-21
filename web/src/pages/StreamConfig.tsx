import { useEffect, useState } from "react";
import { useGetToken } from "../useDevToken.js";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { showErrorToast } from "@/components/ui/toast-with-progress";
import { streamClient } from "../client.js";
import type { StreamDestination } from "../gen/api/v1/stream_pb.js";
import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm.js";
import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm.js";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, ChevronDown, Eye, Check } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { PlatformIcon, PLATFORM_LIST, PLATFORM_HOVER_COLORS } from "@/components/PlatformIcon";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { springs } from "@/lib/motion";
import { TouchTooltip } from "@/components/ui/tooltip";

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick", "restream"] as const;

function RtmpCell({ url }: { url: string }) {
  const [visible, setVisible] = useState(false);
  if (!url) return <TableCell className="text-left"><span className="text-sm text-muted-foreground">{"\u2014"}</span></TableCell>;
  return (
    <TableCell className="text-left">
      <div className="flex items-center gap-2 min-w-0">
        {visible ? (
          <>
            <code className="text-sm text-muted-foreground font-mono truncate">{url}</code>
            <CopyButton text={url} tooltip="Copy RTMP URL" size="icon-xs" iconSize="h-3 w-3" className="shrink-0" />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Reveal</span>
          </button>
        )}
      </div>
    </TableCell>
  );
}

function MobileDestinationCard({ d, onDelete }: { d: StreamDestination; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      key={d.id}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={springs.snappy}
    >
      <Card size="sm">
        <CardContent>
          <div className="flex items-center gap-3">
            <PlatformIcon platform={d.platform} size="sm" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate block">
                {d.name || d.platformUsername || "\u2014"}
              </span>
              <span className="text-xs text-muted-foreground capitalize">{d.platform}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {d.rtmpUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? "Hide RTMP URL" : "Show RTMP URL"}
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")} />
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Delete destination">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete destination?</AlertDialogTitle>
                    <AlertDialogDescription>This will unlink it from any stages using it.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => onDelete(d.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {expanded && d.rtmpUrl && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2">
                  <code className="flex-1 text-xs font-mono text-muted-foreground break-all">
                    {d.rtmpUrl}
                  </code>
                  <CopyButton text={d.rtmpUrl} tooltip="Copy RTMP URL" size="icon-xs" iconSize="h-3 w-3" className="shrink-0 self-start" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function StreamConfig() {
  const getToken = useGetToken();
  const [destinations, setDestinations] = useState<StreamDestination[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardSkipIntro, setWizardSkipIntro] = useState(false);
  async function refresh() {
    const resp = await streamClient.listStreamDestinations({});
    setDestinations(resp.destinations);
    setAvailablePlatforms(resp.availablePlatforms);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const searchParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.includes("?") ? hash.split("?")[1] : "");
    const connected = searchParams.get("connected") || hashParams.get("connected");
    const error = searchParams.get("error") || hashParams.get("error");
    const onboarding = searchParams.get("onboarding") || hashParams.get("onboarding");
    if (connected) {
      toast.success(`Connected to ${connected.charAt(0).toUpperCase() + connected.slice(1)}!`);
      const cleanUrl = onboarding ? "/destinations?onboarding=true" : "/destinations";
      window.history.replaceState(null, "", cleanUrl);
    }
    if (error) {
      showErrorToast(error);
      window.history.replaceState(null, "", "/destinations");
    }
    if (onboarding === "true") {
      setWizardSkipIntro(!!connected);
      setWizardOpen(true);
      if (!connected) {
        window.history.replaceState(null, "", "/destinations");
      }
    }
  }, []);

  async function handleCreate(data: StreamDestinationData) {
    try {
      await streamClient.createStreamDestination({
        name: data.name,
        platform: data.platform,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
      });
      setShowCustomModal(false);
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await streamClient.deleteStreamDestination({ id });
      await refresh();
    } catch {
      // ignore
    }
  }

  async function handleOAuthConnect(platform: string) {
    const token = await getToken();
    if (!token) return;
    try {
      const resp = await fetch(`/oauth/${platform}/check`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!resp.ok) {
        const data = await resp.json();
        toast.error(data.error || "Failed to connect");
        return;
      }
    } catch {
      // If check endpoint fails, try the flow anyway
    }
    window.location.href = `/oauth/${platform}/authorize?token=${encodeURIComponent(token)}`;
  }

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
          Stream Destinations
        </h1>
        <p className="text-base text-muted-foreground">
          Connect platforms and attach them to your stages. Each stage can stream to multiple destinations simultaneously.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="text-primary" />
        </div>
      ) : (
      <>
      {/* Platforms */}
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground mb-3">Platforms</p>
        <AnimatedList className="flex flex-wrap gap-3" delay={0.05}>
          {OAUTH_PLATFORMS.filter(p => availablePlatforms.includes(p) || PLATFORM_LIST.find(pl => pl.value === p)?.comingSoon).map((platform) => {
            const info = PLATFORM_LIST.find((p) => p.value === platform);
            const label = info?.label ?? platform;
            const comingSoon = info?.comingSoon;
            const hoverColor = PLATFORM_HOVER_COLORS[platform] ?? "";
            return (
              <AnimatedListItem key={platform}>
                <TouchTooltip content={comingSoon ? `${label} — Coming Soon` : `Connect ${label}`} contentClassName="sm:hidden">
                  <motion.div
                    whileHover={comingSoon ? undefined : { scale: 1.03 }}
                    whileTap={comingSoon ? undefined : { scale: 0.97 }}
                    transition={springs.quick}
                  >
                    <Button
                      variant="outline"
                      onClick={comingSoon ? undefined : () => handleOAuthConnect(platform)}
                      disabled={comingSoon}
                      className={cn("rounded-xl h-auto px-2 py-2 sm:px-4 sm:py-3 max-sm:border-transparent max-sm:bg-transparent max-sm:shadow-none dark:max-sm:bg-transparent dark:max-sm:border-transparent", comingSoon ? "opacity-50 cursor-default" : hoverColor)}
                    >
                      <PlatformIcon platform={platform} size="sm" />
                      <span className="hidden sm:inline text-sm">{label}</span>
                      {comingSoon && <span className="hidden sm:inline text-xs text-muted-foreground ml-1">Soon</span>}
                    </Button>
                  </motion.div>
                </TouchTooltip>
              </AnimatedListItem>
            );
          })}
          <AnimatedListItem>
            <TouchTooltip content="Add custom RTMP" contentClassName="sm:hidden">
              <motion.div
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={springs.quick}
              >
                <Button
                  variant="outline"
                  onClick={() => setShowCustomModal(true)}
                  className={cn("rounded-xl h-auto px-2 py-2 sm:px-4 sm:py-3 max-sm:border-transparent max-sm:bg-transparent max-sm:shadow-none dark:max-sm:bg-transparent dark:max-sm:border-transparent", PLATFORM_HOVER_COLORS.custom)}
                >
                  <PlatformIcon platform="custom" size="sm" />
                  <span className="hidden sm:inline text-sm">Custom</span>
                </Button>
              </motion.div>
            </TouchTooltip>
          </AnimatedListItem>
        </AnimatedList>
      </div>

      {/* Custom modal */}
      <Dialog open={showCustomModal} onOpenChange={setShowCustomModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom Destination</DialogTitle>
            <DialogDescription>Add a custom RTMP streaming destination.</DialogDescription>
          </DialogHeader>
          <StreamDestinationForm
            compact
            hideSkip
            submitLabel="Add Destination"
            onNext={(data) => {
              if (data) handleCreate(data);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Onboarding wizard */}
      <OnboardingWizard
        open={wizardOpen}
        skipIntro={wizardSkipIntro}
        onClose={() => {
          setWizardOpen(false);
          setWizardSkipIntro(false);
          refresh();
        }}
      />

      {/* Destinations table */}
        <>
          {/* Desktop table */}
          <div className="rounded-xl border overflow-x-auto hidden sm:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left w-[25%]">Account</TableHead>
                  <TableHead className="text-left w-[20%]">Platform</TableHead>
                  <TableHead className="text-left w-[45%]">RTMP URL</TableHead>
                  <TableHead className="text-right w-[10%]"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-primary/[0.03]">
                  <TableCell className="text-left text-foreground font-medium">Dazzle</TableCell>
                  <TableCell className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="text-sm text-emerald-500">Always enabled</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-left"><span className="text-sm text-muted-foreground">dazzle.fm</span></TableCell>
                  <TableCell />
                </TableRow>
                <AnimatePresence>
                  {destinations.map((d) => (
                    <motion.tr
                      key={d.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={springs.snappy}
                      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                    >
                      <TableCell className="text-left text-foreground">{d.name || d.platformUsername || "\u2014"}</TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={d.platform} size="sm" />
                          <span className="text-sm text-muted-foreground">{d.platform}</span>
                        </div>
                      </TableCell>
                      <RtmpCell url={d.rtmpUrl} />
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" aria-label="Delete destination">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete destination?</AlertDialogTitle>
                              <AlertDialogDescription>This will unlink it from any stages using it.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => handleDelete(d.id)}>Delete</AlertDialogAction>
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
          <div className="flex flex-col gap-2 sm:hidden">
            <Card size="sm" className="bg-primary/[0.03]">
              <CardContent>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500 shrink-0">
                    <Check className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground block">Dazzle</span>
                    <span className="text-xs text-emerald-500">Always enabled</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <AnimatePresence>
              {destinations.map((d) => (
                <MobileDestinationCard key={d.id} d={d} onDelete={handleDelete} />
              ))}
            </AnimatePresence>
          </div>
        </>
      </>
      )}
    </AnimatedPage>
  );
}
