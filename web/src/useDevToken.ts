// useDevToken — returns a getToken fn that works in both Clerk and dev-bypass mode.
// In dev mode (VITE_DEV_TOKEN set), Clerk is not mounted so useAuth() would throw.
import { useAuth } from "@clerk/react";

const devToken = import.meta.env.VITE_DEV_TOKEN as string | undefined;

export function useGetToken(): () => Promise<string | null> {
  if (devToken) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- conditional on build-time constant
    return () => Promise.resolve(devToken);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken } = useAuth();
  return getToken;
}
