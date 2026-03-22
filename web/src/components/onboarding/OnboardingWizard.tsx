import { motion } from "motion/react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FlowDiagram } from "@/components/FlowDiagram";
import { CopyAgentPromptButton } from "@/components/CopyAgentPromptButton";
import { springs } from "@/lib/motion";

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  skipIntro?: boolean;
}

const fadeIn = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent mobileSheet className="sm:max-w-3xl">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          transition={springs.gentle}
          className="flex flex-col items-center"
        >
          <h2 className="text-2xl tracking-[-0.02em] text-foreground mb-2 sm:mb-3 font-display text-center">
            How Dazzle works
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-10 text-center max-w-lg">
            Your AI agent uses the Dazzle CLI to control a cloud stage.
            The stage renders and streams to your chosen platform.
          </p>

          <div className="mb-6 sm:mb-10">
            <FlowDiagram />
          </div>

          <div className="w-full max-w-md">
            <CopyAgentPromptButton />
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
