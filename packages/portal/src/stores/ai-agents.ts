import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { AIAgentConfig, AIAgentCategory, KiroAgentConfig } from "@remote-kiro/common";
import { aiAgents as aiAgentApi } from "../api";

export const useAIAgentsStore = defineStore("aiAgents", () => {
  const aiAgents = ref<AIAgentConfig[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const defaultAgents = computed(() => aiAgents.value.filter((a) => a.isDefault));
  const customAgents = computed(() => aiAgents.value.filter((a) => !a.isDefault));
  const reviewAgents = computed(() =>
    aiAgents.value.filter((a) => a.category === "code_review" || a.category === "security_review"),
  );

  async function fetchAll(): Promise<void> {
    if (aiAgents.value.length === 0) loading.value = true;
    error.value = null;
    try {
      const result = await aiAgentApi.list();
      aiAgents.value = result.items;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function generate(prompt: string, category?: AIAgentCategory): Promise<AIAgentConfig> {
    const agent = await aiAgentApi.generate(prompt, category);
    aiAgents.value.unshift(agent);
    return agent;
  }

  async function create(data: {
    name: string;
    category: AIAgentCategory;
    description: string;
    kiroConfig: KiroAgentConfig;
  }): Promise<AIAgentConfig> {
    const agent = await aiAgentApi.create(data);
    aiAgents.value.unshift(agent);
    return agent;
  }

  async function update(
    aiAgentId: string,
    data: Partial<Pick<AIAgentConfig, "name" | "category" | "description" | "kiroConfig">>,
  ): Promise<AIAgentConfig> {
    const agent = await aiAgentApi.update(aiAgentId, data);
    const idx = aiAgents.value.findIndex((a) => a.aiAgentId === aiAgentId);
    if (idx !== -1) aiAgents.value[idx] = agent;
    return agent;
  }

  async function remove(aiAgentId: string): Promise<void> {
    await aiAgentApi.delete(aiAgentId);
    aiAgents.value = aiAgents.value.filter((a) => a.aiAgentId !== aiAgentId);
  }

  return {
    aiAgents,
    loading,
    error,
    defaultAgents,
    customAgents,
    reviewAgents,
    fetchAll,
    generate,
    create,
    update,
    remove,
  };
});
