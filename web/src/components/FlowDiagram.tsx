import { motion } from "motion/react";
import { springs, scaleIn } from "@/lib/motion";
import { Monitor, Cpu, Twitch, Youtube } from "lucide-react";

function KickIconSmall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M9.5 7v10M9.5 12l5-5M9.5 12l5 5" />
    </svg>
  );
}

const nodeDelay = 0.15;

export function FlowDiagram() {
  return (
    <div className="flex items-start gap-4 sm:gap-6 flex-wrap justify-center">
      {/* Agent node */}
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={scaleIn}
        initial="hidden"
        animate="visible"
        transition={{ ...springs.bouncy, delay: 0 }}
      >
        <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Monitor className="h-7 w-7 text-blue-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Agent</p>
          <p className="text-sm text-muted-foreground">Claude, GPT,</p>
          <p className="text-sm text-muted-foreground">any AI agent</p>
        </div>
      </motion.div>

      {/* Arrow 1 */}
      <div className="flex items-center mt-[26px]">
        <motion.div
          className="h-px bg-gradient-to-r from-blue-500/40 to-emerald-500/40 origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ ...springs.snappy, delay: nodeDelay * 0.8 }}
          style={{ width: "3rem" }}
        />
        <motion.svg
          className="h-3 w-3 text-zinc-600 -ml-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: nodeDelay * 1.2 }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </motion.svg>
      </div>

      {/* Stage node */}
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={scaleIn}
        initial="hidden"
        animate="visible"
        transition={{ ...springs.bouncy, delay: nodeDelay }}
      >
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Cpu className="h-7 w-7 text-emerald-400" />
          </div>
          {/* Subtle emerald glow pulse */}
          <div className="absolute inset-0 rounded-2xl animate-live-pulse opacity-50 ring-1 ring-emerald-500/20" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Stage</p>
          <p className="text-sm text-muted-foreground">Cloud environment</p>
        </div>
      </motion.div>

      {/* Arrow 2 */}
      <div className="flex items-center mt-[26px]">
        <motion.div
          className="h-px bg-gradient-to-r from-emerald-500/40 to-purple-500/40 origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ ...springs.snappy, delay: nodeDelay * 1.8 }}
          style={{ width: "3rem" }}
        />
        <motion.svg
          className="h-3 w-3 text-zinc-600 -ml-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: nodeDelay * 2.2 }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </motion.svg>
      </div>

      {/* Platform node — with stacked platform icons */}
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={scaleIn}
        initial="hidden"
        animate="visible"
        transition={{ ...springs.bouncy, delay: nodeDelay * 2 }}
      >
        <div className="h-16 w-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
          <div className="grid grid-cols-2 gap-1">
            <Twitch className="h-3.5 w-3.5 text-purple-400" />
            <Youtube className="h-3.5 w-3.5 text-red-400" />
            <KickIconSmall className="h-3.5 w-3.5 text-green-400" />
            <svg className="h-3.5 w-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 10 9 17 9 10 17" />
            </svg>
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Platform</p>
          <p className="text-sm text-muted-foreground">Twitch, YouTube,</p>
          <p className="text-sm text-muted-foreground">Kick, Restream</p>
        </div>
      </motion.div>
    </div>
  );
}
