// ─── Repositories Pinia Store ───

import { ref } from "vue";
import { defineStore } from "pinia";
import type { Repository } from "@remote-kiro/common";
import { repositories as repoApi } from "../api";

export const useRepositoriesStore = defineStore("repositories", () => {
  // ─── State ───
  const repositories = ref<Repository[]>([]);
  const current = ref<Repository | null>(null);
  const loading = ref(false);

  // ─── Actions ───

  async function fetchAll(): Promise<void> {
    if (repositories.value.length === 0) loading.value = true;
    try {
      const result = await repoApi.list();
      repositories.value = result.items;
    } catch {
      // API unavailable — keep existing state
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(repoId: string): Promise<void> {
    if (!current.value || current.value.repoId !== repoId) loading.value = true;
    try {
      current.value = await repoApi.get(repoId);
    } catch {
      // API unavailable
    } finally {
      loading.value = false;
    }
  }

  async function create(data: {
    name: string;
    url: string;
    defaultBranch: string;
    defaultFeatureProfileId: string;
    autoReviewEnabled?: boolean;
  }): Promise<Repository> {
    const repo = await repoApi.create(data);
    repositories.value.push(repo);
    return repo;
  }

  async function update(
    repoId: string,
    data: Partial<Pick<Repository, "defaultBranch" | "defaultFeatureProfileId" | "defaultReviewProfileId" | "autoReviewEnabled" | "status">>,
  ): Promise<Repository> {
    const repo = await repoApi.update(repoId, data);
    const idx = repositories.value.findIndex((r) => r.repoId === repoId);
    if (idx !== -1) repositories.value[idx] = repo;
    if (current.value?.repoId === repoId) current.value = repo;
    return repo;
  }

  return { repositories, current, loading, fetchAll, fetchOne, create, update };
});
