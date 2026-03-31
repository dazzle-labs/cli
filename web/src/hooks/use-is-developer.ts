import { useAuth } from "@clerk/react";

export function useIsDeveloper(): boolean {
  const { has, isLoaded } = useAuth();
  if (!isLoaded || !has) return false;
  return has({ permission: "org:access:developer" }) === true;
}
