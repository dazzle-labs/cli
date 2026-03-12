import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

const DURATION = 10000;

function ToastProgressBar({
  paused,
  portalTarget,
}: {
  paused: boolean;
  portalTarget: HTMLElement | null;
}) {
  const [progress, setProgress] = useState(100);
  const startTimeRef = useRef(Date.now());
  const remainingRef = useRef(DURATION);
  const rafRef = useRef(0);

  useEffect(() => {
    if (paused) {
      cancelAnimationFrame(rafRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      return;
    }

    startTimeRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const left = Math.max(0, remainingRef.current - elapsed);
      setProgress((left / DURATION) * 100);
      if (left > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paused]);

  if (!portalTarget) return null;

  // Portal directly into the toast <li>, so position: absolute is relative to the toast
  return createPortal(
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 2,
        right: 2,
        height: 3,
        overflow: "hidden",
        borderRadius: "0 0 var(--radius) var(--radius)",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          backgroundColor: "currentColor",
          opacity: 0.25,
        }}
      />
    </div>,
    portalTarget,
  );
}

function ErrorToastBody({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [toastEl, setToastEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current?.closest("[data-sonner-toast]") as HTMLElement | null;
    if (!el) return;
    setToastEl(el);

    const check = () =>
      setPaused(el.getAttribute("data-expanded") === "true");
    check();

    const observer = new MutationObserver(check);
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["data-expanded"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="w-full">
      <div>{message}</div>
      <ToastProgressBar paused={paused} portalTarget={toastEl} />
    </div>
  );
}

let errorToastCounter = 0;

export function showErrorToast(message: string) {
  const id = `error-toast-${++errorToastCounter}`;
  toast.error(<ErrorToastBody message={message} />, {
    id,
    duration: DURATION,
  });
}
