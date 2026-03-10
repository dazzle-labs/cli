import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
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
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Trash2, Radio } from "lucide-react";
import { PlatformIcon, PLATFORM_LIST, PLATFORM_HOVER_COLORS } from "@/components/PlatformIcon";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { AnimatedPage } from "@/components/AnimatedPage";
import { AnimatedList, AnimatedListItem } from "@/components/AnimatedList";
import { springs } from "@/lib/motion";

const OAUTH_PLATFORMS = ["twitch", "youtube", "kick", "restream"] as const;

export function StreamConfig() {
  const { getToken } = useAuth();
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
      toast.error(error);
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-base pt-12">
        <Spinner className="text-primary" />
        Loading destinations...
      </div>
    );
  }

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl tracking-[-0.02em] text-foreground mb-1 font-display">
          Stream Destinations
        </h1>
        <p className="text-base text-muted-foreground">
          The platforms your agents can stream to.
        </p>
      </div>

      {/* Platforms */}
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground mb-3">Platforms</p>
        <AnimatedList className="flex flex-wrap gap-3" delay={0.05}>
          {OAUTH_PLATFORMS.filter(p => availablePlatforms.includes(p)).map((platform) => {
            const label = PLATFORM_LIST.find((p) => p.value === platform)?.label ?? platform;
            const hoverColor = PLATFORM_HOVER_COLORS[platform] ?? "";
            return (
              <AnimatedListItem key={platform}>
                <motion.div
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={springs.quick}
                >
                  <Button
                    variant="outline"
                    onClick={() => handleOAuthConnect(platform)}
                    className={`rounded-xl h-auto px-4 py-3 ${hoverColor}`}
                  >
                    <PlatformIcon platform={platform} size="sm" />
                    <span className="text-sm">{label}</span>
                  </Button>
                </motion.div>
              </AnimatedListItem>
            );
          })}
          <AnimatedListItem>
            <motion.div
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={springs.quick}
            >
              <Button
                variant="outline"
                onClick={() => setShowCustomModal(true)}
                className={`rounded-xl h-auto px-4 py-3 ${PLATFORM_HOVER_COLORS.custom}`}
              >
                <PlatformIcon platform="custom" size="sm" />
                <span className="text-sm">Custom</span>
              </Button>
            </motion.div>
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
      {destinations.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Radio className="h-7 w-7" /></EmptyMedia>
            <EmptyTitle>No stream destinations</EmptyTitle>
            <EmptyDescription>Add one above to start streaming.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* Desktop table */}
          <div className="rounded-xl border overflow-x-auto hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>RTMP URL</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                      <TableCell className="text-foreground">{d.name || d.platformUsername || "\u2014"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={d.platform} size="sm" />
                          <span className="text-sm text-muted-foreground">{d.platform}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-sm text-muted-foreground font-mono">{d.rtmpUrl || "\u2014"}</code>
                      </TableCell>
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
          <div className="flex flex-col gap-3 sm:hidden">
            <AnimatePresence>
              {destinations.map((d) => (
                <motion.div
                  key={d.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.snappy}
                >
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-base text-foreground font-medium">{d.name || d.platformUsername || "\u2014"}</span>
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={d.platform} size="sm" />
                          <span className="text-sm text-muted-foreground">{d.platform}</span>
                        </div>
                      </div>
                      <code className="text-sm text-muted-foreground font-mono break-all">{d.rtmpUrl || "\u2014"}</code>
                      <div className="mt-3 flex justify-end">
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
