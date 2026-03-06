import { Terminal, Brain, Cat, Users, GitBranch, Bot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FRAMEWORK_ICONS: Record<string, LucideIcon> = {
  "claude-code": Terminal,
  "openai-agents": Brain,
  "openclaw": Cat,
  "crewai": Users,
  "langgraph": GitBranch,
  "autogen": Bot,
};

export function FrameworkIcon({ id, className }: { id: string; className?: string }) {
  const Icon = FRAMEWORK_ICONS[id] ?? Terminal;
  return <Icon className={className} />;
}
