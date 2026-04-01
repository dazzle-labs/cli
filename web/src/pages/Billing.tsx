import { useEffect, useState, useCallback } from "react";
import { userClient, billingClient } from "../client.js";
import type { GetProfileResponse } from "../gen/api/v1/user_pb.js";
import type { GetUsageResponse } from "../gen/api/v1/billing_pb.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { AnimatedPage } from "@/components/AnimatedPage";
import { Check, ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/mo",
    features: [
      "1 active stage",
      "24 CPU hrs included",
      "2-hr GPU trial (one-time)",
      "720p resolution",
      "1 external destination",
      "Public stages only",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: "$19.99",
    period: "/mo",
    features: [
      "3 active stages",
      "750 CPU hrs included (~1 always-on)",
      "Then $0.15/hr CPU",
      "GPU: $0.90/hr",
      "720p resolution",
      "1 external destination",
      "Public stages only",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$79.99",
    period: "/mo",
    popular: true,
    features: [
      "Unlimited active stages",
      "1,500 CPU hrs included (~2 always-on)",
      "Then $0.08/hr CPU",
      "GPU: $0.70/hr",
      "720p resolution",
      "5 external destinations",
      "Private stages (coming soon)",
    ],
  },
];

function UsageMeter({
  label,
  used,
  included,
}: {
  label: string;
  used: number;
  included: number;
}) {
  // Always-on plans (included = 0) don't show a meter
  if (included === 0) return null;

  const pct = Math.min(100, (used / included) * 100);
  const isOver = used >= included;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium", isOver && "text-destructive")}>
          {used} / {included} hrs
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isOver ? "bg-destructive" : pct > 80 ? "bg-yellow-500" : "bg-primary"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    free: "bg-muted text-muted-foreground",
    starter: "bg-blue-500/10 text-blue-500",
    pro: "bg-primary/10 text-primary",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize",
        colors[plan] ?? colors.free
      )}
    >
      {plan}
    </span>
  );
}

export function Billing() {
  const [profile, setProfile] = useState<GetProfileResponse | null>(null);
  const [usageData, setUsageData] = useState<GetUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [overageLimitDollars, setOverageLimitDollars] = useState("");
  const [savingOverage, setSavingOverage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [profileResp, usageResp] = await Promise.all([
        userClient.getProfile({}),
        billingClient.getUsage({}).catch(() => null),
      ]);
      setProfile(profileResp);
      if (usageResp) {
        setUsageData(usageResp);
        setOverageEnabled(usageResp.overageEnabled);
        setOverageLimitDollars(
          usageResp.overageLimitCents > 0
            ? (usageResp.overageLimitCents / 100).toString()
            : ""
        );
      }
      // If usageResp is null (fetch failed), leave overage state uninitialized
      // so the user doesn't accidentally toggle off their settings on save.
    } catch {
      setError("Failed to load billing data. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleUpgrade(plan: string) {
    setUpgrading(plan);
    setError(null);
    try {
      const resp = await billingClient.createCheckoutSession({ plan });
      window.location.href = resp.checkoutUrl;
    } catch (err) {
      console.error("Checkout error:", err);
      setError("Failed to start checkout. Please try again.");
      setUpgrading(null);
    }
  }

  async function handleSaveOverage(enabled: boolean, limitDollars: string) {
    setSavingOverage(true);
    setError(null);
    try {
      let limitCents = 0;
      if (limitDollars) {
        const parsed = parseFloat(limitDollars);
        if (isNaN(parsed) || parsed < 0) {
          setError("Spending limit must be a positive number.");
          setSavingOverage(false);
          return;
        }
        limitCents = Math.round(parsed * 100);
      }
      const resp = await billingClient.updateOverageSettings({
        overageEnabled: enabled,
        overageLimitCents: limitCents,
      });
      // Use server response as source of truth
      setOverageEnabled(resp.overageEnabled);
      setOverageLimitDollars(
        resp.overageLimitCents > 0
          ? (resp.overageLimitCents / 100).toString()
          : ""
      );
    } catch (err) {
      console.error("Overage settings error:", err);
      setError("Failed to update overage settings. Please try again.");
    } finally {
      setSavingOverage(false);
    }
  }

  async function handleManageBilling() {
    setError(null);
    try {
      const resp = await billingClient.createPortalSession({});
      window.location.href = resp.portalUrl;
    } catch (err) {
      console.error("Portal error:", err);
      setError("Failed to open billing portal. Please try again.");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  const currentPlan = profile?.plan ?? "free";
  const usage = profile?.usage;

  return (
    <AnimatedPage>
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-muted-foreground mt-1">
            Manage your plan and usage
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Current plan + usage */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Current Plan</CardTitle>
              <PlanBadge plan={currentPlan} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {usage && (
              <div className="grid gap-4 sm:grid-cols-2">
                <UsageMeter
                  label="CPU Hours"
                  used={usage.cpuHoursUsed}
                  included={usage.cpuHoursIncluded}
                />
                <UsageMeter
                  label="GPU Hours"
                  used={usage.gpuHoursUsed}
                  included={usage.gpuHoursIncluded}
                />
              </div>
            )}
            {currentPlan !== "free" && (
              <Button variant="outline" size="sm" onClick={handleManageBilling}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Manage Billing
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Overage settings — paid plans only */}
        {currentPlan !== "free" && (
          <Card>
            <CardHeader>
              <CardTitle>Overage</CardTitle>
              <CardDescription>
                Allow usage beyond your included hours. You'll be billed for
                extra hours at your plan's overage rate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="overage-toggle" className="text-sm">
                  Enable overage billing
                </Label>
                <Switch
                  id="overage-toggle"
                  checked={overageEnabled}
                  onCheckedChange={(checked) => handleSaveOverage(checked, overageLimitDollars)}
                  disabled={savingOverage || !usageData}
                />
              </div>
              {overageEnabled && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="overage-limit" className="text-sm">
                      Monthly spending limit (optional)
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        id="overage-limit"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="No limit"
                        value={overageLimitDollars}
                        onChange={(e) => setOverageLimitDollars(e.target.value)}
                        className="w-32"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveOverage(overageEnabled, overageLimitDollars)}
                        disabled={savingOverage}
                      >
                        {savingOverage ? <Spinner className="h-3.5 w-3.5" /> : "Save"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave empty for no limit. Stages won't activate once the cap is reached.
                    </p>
                  </div>
                  {usageData && usageData.overageSpentCents > 0 && (
                    <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                      Current overage spend: <span className="font-medium">${(usageData.overageSpentCents / 100).toFixed(2)}</span>
                      {usageData.overageLimitCents > 0 && (
                        <span className="text-muted-foreground"> / ${(usageData.overageLimitCents / 100).toFixed(2)} limit</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            const isUpgrade =
              PLANS.findIndex((p) => p.id === plan.id) >
              PLANS.findIndex((p) => p.id === currentPlan);

            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col",
                  plan.popular && "border-primary shadow-sm"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-medium text-primary-foreground">
                    Most Popular
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription>
                    <span className="text-3xl font-bold text-foreground">
                      {plan.price}
                    </span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-between">
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full">
                      Current Plan
                    </Button>
                  ) : isUpgrade ? (
                    <Button
                      className="w-full"
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={upgrading !== null}
                    >
                      {upgrading === plan.id ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <>
                          Upgrade
                          <ArrowRight className="h-4 w-4 ml-1.5" />
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleManageBilling}
                    >
                      Downgrade
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AnimatedPage>
  );
}
