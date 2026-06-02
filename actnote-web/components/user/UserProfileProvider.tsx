"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveOwnAvatarDisplayUrlWithCleanup } from "@/lib/user/avatar-cleanup";
import {
  workspaceMemberDisplayName,
  workspaceMemberInitials,
} from "@/lib/user/member-display";

type UserProfileContextValue = {
  hydrated: boolean;
  userId: string | null;
  email: string;
  displayName: string;
  initials: string;
  avatarDisplayUrl: string | null;
  avatarBroken: boolean;
  setAvatarBroken: (broken: boolean) => void;
  profileRevision: number;
  refreshUserProfile: () => Promise<void>;
  applyAvatarUpdate: (storedUrl: string | null, displayUrl: string | null) => void;
  applyNameUpdate: (fullName: string) => void;
};

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error("useUserProfile must be used within UserProfileProvider");
  }
  return ctx;
}

/** Optional hook for components that may render outside the provider. */
export function useUserProfileOptional(): UserProfileContextValue | null {
  return useContext(UserProfileContext);
}

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [profileName, setProfileName] = useState<string | null>(null);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [profileRevision, setProfileRevision] = useState(0);

  const displayName = useMemo(
    () => workspaceMemberDisplayName(profileName, email),
    [profileName, email],
  );
  const initials = useMemo(
    () => workspaceMemberInitials(profileName, email),
    [profileName, email],
  );

  const refreshUserProfile = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setEmail("");
      setProfileName(null);
      setAvatarDisplayUrl(null);
      setAvatarBroken(false);
      setHydrated(true);
      return;
    }

    setUserId(user.id);
    setEmail(user.email ?? "");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (supabase as any)
      .from("users")
      .select("name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    const name =
      typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : null;
    setProfileName(name);

    const storedAvatar =
      typeof profile?.avatar_url === "string" && profile.avatar_url.trim()
        ? profile.avatar_url.trim()
        : null;
    const display = await resolveOwnAvatarDisplayUrlWithCleanup(supabase, storedAvatar);
    setAvatarDisplayUrl(display);
    setAvatarBroken(false);
    setProfileRevision((v) => v + 1);
    setHydrated(true);
  }, []);

  useEffect(() => {
    void refreshUserProfile();
  }, [refreshUserProfile]);

  const applyAvatarUpdate = useCallback((_storedUrl: string | null, displayUrl: string | null) => {
    setAvatarDisplayUrl(displayUrl);
    setAvatarBroken(false);
    setProfileRevision((v) => v + 1);
  }, []);

  const applyNameUpdate = useCallback(
    (fullName: string) => {
      const trimmed = fullName.trim();
      setProfileName(trimmed || null);
      setProfileRevision((v) => v + 1);
    },
    [],
  );

  const value = useMemo(
    (): UserProfileContextValue => ({
      hydrated,
      userId,
      email,
      displayName,
      initials,
      avatarDisplayUrl,
      avatarBroken,
      setAvatarBroken,
      profileRevision,
      refreshUserProfile,
      applyAvatarUpdate,
      applyNameUpdate,
    }),
    [
      hydrated,
      userId,
      email,
      displayName,
      initials,
      avatarDisplayUrl,
      avatarBroken,
      profileRevision,
      refreshUserProfile,
      applyAvatarUpdate,
      applyNameUpdate,
    ],
  );

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}
