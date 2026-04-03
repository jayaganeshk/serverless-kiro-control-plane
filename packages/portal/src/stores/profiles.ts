// ─── Profiles Pinia Store ───

import { ref } from "vue";
import { defineStore } from "pinia";
import type { Profile } from "@remote-kiro/common";
import { profiles as profileApi } from "../api";

export const useProfilesStore = defineStore("profiles", () => {
  // ─── State ───
  const profiles = ref<Profile[]>([]);
  const loading = ref(false);

  // ─── Actions ───

  async function fetchAll(): Promise<void> {
    if (profiles.value.length === 0) loading.value = true;
    try {
      const result = await profileApi.list();
      profiles.value = result.items;
    } catch {
      // API unavailable — keep existing state
    } finally {
      loading.value = false;
    }
  }

  async function create(data: {
    name: string;
    profileType: "feature" | "reviewer";
    description: string;
  }): Promise<Profile> {
    const profile = await profileApi.create(data);
    profiles.value.push(profile);
    return profile;
  }

  async function publishBundle(profileId: string, bundle: File): Promise<Profile> {
    const updated = await profileApi.publishBundle(profileId, bundle);
    const idx = profiles.value.findIndex((p) => p.profileId === profileId);
    if (idx !== -1) profiles.value[idx] = updated;
    return updated;
  }

  async function updateManifest(profileId: string, manifest: Record<string, unknown> | null): Promise<Profile> {
    const updated = await profileApi.update(profileId, { manifest });
    const idx = profiles.value.findIndex((p) => p.profileId === profileId);
    if (idx !== -1) profiles.value[idx] = updated;
    return updated;
  }

  async function updateProfile(profileId: string, data: Partial<Pick<Profile, "name" | "description" | "manifest">>): Promise<Profile> {
    const updated = await profileApi.update(profileId, data);
    const idx = profiles.value.findIndex((p) => p.profileId === profileId);
    if (idx !== -1) profiles.value[idx] = updated;
    return updated;
  }

  return { profiles, loading, fetchAll, create, publishBundle, updateManifest, updateProfile };
});
