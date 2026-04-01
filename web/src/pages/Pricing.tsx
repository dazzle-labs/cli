import { useState } from "react";
import { Link } from "react-router-dom";
import { SignUp } from "@clerk/react";
import { motion } from "motion/react";
import { Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ease = [0.25, 0.1, 0.25, 1] as const;

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/mo",
    description: "Try it out — no credit card required.",
    cta: "Get Started",
  },
  {
    id: "starter",
    name: "Starter",
    price: "$19.99",
    period: "/mo",
    description: "For creators who want an always-on stage.",
    cta: "Get Started",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$79.99",
    period: "/mo",
    popular: true,
    description: "For teams and power users who need scale.",
    cta: "Get Started",
  },
];

interface FeatureRow {
  label: string;
  free: string;
  starter: string;
  pro: string;
}

const FEATURES: { section: string; rows: FeatureRow[] }[] = [
  {
    section: "Stages",
    rows: [
      { label: "Projects (stages created)", free: "10", starter: "100", pro: "1,000" },
      { label: "Active stages (running)", free: "1", starter: "3", pro: "Unlimited" },
      { label: "Resolution", free: "720p", starter: "720p", pro: "720p" },
      { label: "Privacy", free: "Public only", starter: "Public only", pro: "Public + private" },
    ],
  },
  {
    section: "CPU",
    rows: [
      { label: "CPU hours included", free: "24 hrs/mo", starter: "750 hrs/mo", pro: "1,500 hrs/mo" },
      { label: "Always-on equivalent", free: "\u2014", starter: "~1 stage", pro: "~2 stages" },
      { label: "Beyond included", free: "\u2014", starter: "$0.15/hr", pro: "$0.08/hr" },
    ],
  },
  {
    section: "GPU",
    rows: [
      { label: "GPU access", free: "2-hr trial (one-time)", starter: "$0.90/hr", pro: "$0.70/hr" },
    ],
  },
  {
    section: "Streaming",
    rows: [
      { label: "External destinations", free: "1", starter: "1", pro: "5" },
    ],
  },
];

function CellValue({ value }: { value: string }) {
  if (value === "\u2014") {
    return <Minus className="h-4 w-4 text-zinc-600 mx-auto" />;
  }
  return <span>{value}</span>;
}

export function Pricing() {
  const [signUpOpen, setSignUpOpen] = useState(false);

  return (
    <div className="dark">
      <div className="relative min-h-screen bg-zinc-950 overflow-hidden selection:bg-emerald-500/30">
        {/* Ambient background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="landing-orb landing-orb-1 !opacity-50" />
          <div className="landing-orb landing-orb-2 !opacity-50" />
        </div>

        {/* Nav */}
        <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 md:px-10 backdrop-blur-xl bg-zinc-950/60 border-b border-white/[0.04]">
          <Link to="/" className="text-base font-semibold tracking-tight text-white font-display">
            Dazzle
          </Link>
          <div className="flex items-center gap-5">
            <Link to="/live" className="text-zinc-400 hover:text-white text-sm transition-colors">
              Live
            </Link>
            <Link to="/docs" className="text-zinc-400 hover:text-white text-sm transition-colors">
              Docs
            </Link>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 text-zinc-300 hover:text-white hover:bg-white/5"
              onClick={() => setSignUpOpen(true)}
            >
              Sign Up
            </Button>
          </div>
        </nav>

        {/* Hero */}
        <motion.div
          className="relative z-10 mx-auto max-w-5xl px-6 pt-20 pb-12 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white font-display">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-zinc-400 max-w-2xl mx-auto">
            Start free. Scale with pay-as-you-go CPU and GPU hours.
            No surprises.
          </p>
        </motion.div>

        {/* Plan cards */}
        <motion.div
          className="relative z-10 mx-auto max-w-5xl px-6 pb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease }}
        >
          <div className="grid gap-6 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-2xl border p-6 flex flex-col",
                  plan.popular
                    ? "border-emerald-500/40 bg-emerald-500/[0.03]"
                    : "border-white/[0.08] bg-white/[0.015]"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-medium text-white">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                  <p className="text-sm text-zinc-500 mt-1">{plan.description}</p>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-zinc-500">{plan.period}</span>
                  </div>
                </div>
                <Button
                  className={cn(
                    "w-full mt-auto",
                    plan.popular
                      ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                      : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
                  )}
                  onClick={() => setSignUpOpen(true)}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Feature comparison table */}
        <motion.div
          className="relative z-10 mx-auto max-w-5xl px-6 pb-24"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease }}
        >
          <h2 className="text-2xl font-semibold text-white text-center mb-10">
            Compare plans
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left py-4 pr-4 text-zinc-500 font-medium w-[40%]" />
                  <th className="text-center py-4 px-4 text-zinc-300 font-medium">Free</th>
                  <th className="text-center py-4 px-4 text-zinc-300 font-medium">Starter</th>
                  <th className="text-center py-4 px-4 text-zinc-300 font-medium">Pro</th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((group) => (
                  <>
                    <tr key={group.section}>
                      <td
                        colSpan={4}
                        className="pt-6 pb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400"
                      >
                        {group.section}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label} className="border-b border-white/[0.04]">
                        <td className="py-3 pr-4 text-zinc-400">{row.label}</td>
                        <td className="py-3 px-4 text-center text-zinc-300">
                          <CellValue value={row.free} />
                        </td>
                        <td className="py-3 px-4 text-center text-zinc-300">
                          <CellValue value={row.starter} />
                        </td>
                        <td className="py-3 px-4 text-center text-zinc-300">
                          <CellValue value={row.pro} />
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* FAQ */}
        <motion.div
          className="relative z-10 mx-auto max-w-3xl px-6 pb-24"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease }}
        >
          <h2 className="text-2xl font-semibold text-white text-center mb-10">
            Common questions
          </h2>
          <div className="space-y-6">
            <FaqItem question="What happens when I exceed my included CPU hours?">
              Your stage keeps running. You're billed per hour at your plan's rate
              ($0.15/hr Starter, $0.08/hr Pro). You can set a spending cap in your
              billing settings to stay in control.
            </FaqItem>
            <FaqItem question="How does GPU billing work?">
              GPU is always pay-as-you-go. Every user gets a one-time 2-hour free trial.
              After that, GPU hours are billed at your plan rate ($0.90/hr Starter,
              $0.70/hr Pro). Free users are blocked after the trial.
            </FaqItem>
            <FaqItem question="Can I stream to Twitch or YouTube?">
              Yes. All plans include at least 1 external RTMP destination. Pro supports
              up to 5 simultaneous destinations.
            </FaqItem>
            <FaqItem question="What's an 'active stage'?">
              An active stage is one that's currently running and streaming. You can
              create more projects than your active limit — you just can't run them
              all at the same time.
            </FaqItem>
            <FaqItem question="Can I cancel anytime?">
              Yes. Downgrade to Free at any time from your billing page. You keep access
              until the end of your billing period.
            </FaqItem>
          </div>
        </motion.div>

        {/* Footer */}
        <footer className="relative z-10 border-t border-white/[0.04] py-8">
          <div className="flex items-center justify-center gap-4 text-xs text-zinc-600">
            <span>dazzle.fm &middot; &copy; 2026 Dazzle</span>
            <span className="text-zinc-800">&middot;</span>
            <Link to="/live" className="hover:text-zinc-400 transition-colors">Live</Link>
            <Link to="/docs" className="hover:text-zinc-400 transition-colors">Docs</Link>
            <Link to="/pricing" className="hover:text-zinc-400 transition-colors">Pricing</Link>
            <Link to="/terms" className="hover:text-zinc-400 transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-zinc-400 transition-colors">Privacy</Link>
          </div>
        </footer>

        {/* Sign Up Dialog */}
        <Dialog open={signUpOpen} onOpenChange={setSignUpOpen}>
          <DialogContent
            className="bg-transparent ring-0 shadow-none p-0 gap-0 sm:max-w-fit max-w-fit max-h-[90vh] overflow-y-auto"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">Sign up for Dazzle</DialogTitle>
            <SignUp routing="hash" />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function FaqItem({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-white/[0.06] pb-6">
      <h3 className="text-white font-medium mb-2">{question}</h3>
      <p className="text-sm text-zinc-400 leading-relaxed">{children}</p>
    </div>
  );
}
