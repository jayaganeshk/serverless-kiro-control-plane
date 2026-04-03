import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Agent } from "@remote-kiro/common";
import { agents as agentsApi } from "../api";

const HEARTBEAT_STALE_MS = 120_000; // 2 minutes without heartbeat → considered offline

export const useAgentsStore = defineStore("agents", () => {
  const agents = ref<Agent[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const onlineAgents = computed(() =>
    agents.value.filter((a) => isOnline(a)),
  );

  const offlineAgents = computed(() =>
    agents.value.filter((a) => !isOnline(a)),
  );

  function isOnline(agent: Agent): boolean {
    if (agent.status !== "online") return false;
    const lastBeat = new Date(agent.lastHeartbeatAt).getTime();
    return Date.now() - lastBeat < HEARTBEAT_STALE_MS;
  }

  async function fetchAll(): Promise<void> {
    if (agents.value.length === 0) loading.value = true;
    error.value = null;
    try {
      const result = await agentsApi.list();
      agents.value = result.items;
    } catch (err) {
      if (agents.value.length === 0) {
        error.value = err instanceof Error ? err.message : "Failed to load agents";
      }
    } finally {
      loading.value = false;
    }
  }

  return {
    agents,
    loading,
    error,
    onlineAgents,
    offlineAgents,
    isOnline,
    fetchAll,
  };
});
