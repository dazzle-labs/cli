import { useEffect } from "react";
import { useAuth, useOrganizationList, useUser } from "@clerk/react";

export function useOrganizationActivation() {
  const { orgId } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { setActive, isLoaded: isOrgListLoaded } = useOrganizationList();

  useEffect(() => {
    if (!isUserLoaded || !isOrgListLoaded || !user || !setActive) return;
    const first = user.organizationMemberships?.[0];
    if (!first || first.organization.id === orgId) return;
    setActive({ organization: first.organization.id });
  }, [isUserLoaded, isOrgListLoaded, user, setActive, orgId]);
}
