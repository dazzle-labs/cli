import { useState } from "react";
import { MoreVertical, User, Trash2, Ban } from "lucide-react";
import { toast } from "sonner";
import { moderationClient } from "@/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface StageCardMenuProps {
  stageId: string;
  stageName: string;
  onDeleted?: () => void;
}

export function StageCardMenu({
  stageId,
  stageName,
  onDeleted,
}: StageCardMenuProps) {
  const [ownerInfo, setOwnerInfo] = useState<{
    userId: string;
    email: string;
    name: string;
  } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDeAnonymize() {
    try {
      const res = await moderationClient.getStageOwner({ stageId });
      setOwnerInfo({ userId: res.userId, email: res.email, name: res.name });
      toast.info(`Owner: ${res.name || "Unknown"} (${res.email || "no email"})`);
    } catch {
      toast.error("Failed to get owner info");
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await moderationClient.deleteStage({ stageId });
      toast.success(`Stage "${stageName}" deleted`);
      onDeleted?.();
    } catch {
      toast.error("Failed to delete stage");
    } finally {
      setLoading(false);
      setShowDeleteDialog(false);
    }
  }

  async function handleBan() {
    if (!ownerInfo) return;
    setLoading(true);
    try {
      await moderationClient.banUser({ userId: ownerInfo.userId });
      toast.success(`User ${ownerInfo.email || ownerInfo.userId} banned`);
      onDeleted?.();
    } catch {
      toast.error("Failed to ban user");
    } finally {
      setLoading(false);
      setShowBanDialog(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute bottom-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 backdrop-blur-sm hover:bg-black/80 text-white"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-48"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DropdownMenuItem onSelect={handleDeAnonymize}>
            <User className="size-4" />
            Show Owner
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4" />
            Delete Stage
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (!ownerInfo) {
                handleDeAnonymize().then(() => setShowBanDialog(true));
              } else {
                setShowBanDialog(true);
              }
            }}
          >
            <Ban className="size-4" />
            Ban User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stage &ldquo;{stageName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the stream and permanently remove the stage. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will ban{" "}
              {ownerInfo?.email || ownerInfo?.userId || "the user"} from the
              platform and stop all their active stages. This can be reversed in
              the Clerk dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleBan}
              disabled={loading}
            >
              Ban User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
