// ─── Jobs Pinia Store ───

import { ref, computed } from "vue";
import { defineStore } from "pinia";
import type { Job, JobEvent, Artifact, JobSpec, SpecItem } from "@remote-kiro/common";
import { JobStatus } from "@remote-kiro/common";
import { jobs as jobsApi } from "../api";

export const useJobsStore = defineStore("jobs", () => {
  // ─── State ───
  const jobs = ref<Job[]>([]);
  const current = ref<Job | null>(null);
  const events = ref<JobEvent[]>([]);
  const artifacts = ref<(Artifact & { downloadUrl?: string })[]>([]);
  const spec = ref<JobSpec | null>(null);
  const loadingSpec = ref(false);
  const loading = ref(false);
  const loadingEvents = ref(false);
  const loadingArtifacts = ref(false);
  const error = ref<string | null>(null);
  const statusFilter = ref<string | undefined>(undefined);

  // ─── Computed ───

  const jobCountsByStatus = computed(() => {
    const counts: Record<string, number> = {};
    for (const s of Object.values(JobStatus)) {
      counts[s] = 0;
    }
    for (const job of jobs.value) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }
    return counts;
  });

  // ─── Actions ───

  async function fetchAll(status?: string): Promise<void> {
    if (jobs.value.length === 0) loading.value = true;
    try {
      statusFilter.value = status;
      const params: { status?: string } = {};
      if (status) params.status = status;
      const result = await jobsApi.list(params);
      jobs.value = result.items;
    } catch {
      // API unavailable — keep existing state
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(jobId: string): Promise<void> {
    if (!current.value) loading.value = true;
    error.value = null;
    try {
      current.value = await jobsApi.get(jobId);
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load job";
    } finally {
      loading.value = false;
    }
  }

  async function create(data: {
    jobType: "implement_feature";
    repoId: string;
    profileId: string;
    description: string;
    constraints?: string;
    aiAgentId?: string;
  }): Promise<Job> {
    const job = await jobsApi.create(data);
    jobs.value.unshift(job);
    return job;
  }

  async function cancel(jobId: string): Promise<void> {
    await jobsApi.cancel(jobId);
    if (current.value?.jobId === jobId) {
      current.value = { ...current.value, status: JobStatus.CANCELLED };
    }
    const idx = jobs.value.findIndex((j) => j.jobId === jobId);
    if (idx !== -1) {
      jobs.value[idx] = { ...jobs.value[idx], status: JobStatus.CANCELLED };
    }
  }

  async function fetchEvents(jobId: string): Promise<void> {
    if (events.value.length === 0) loadingEvents.value = true;
    try {
      const result = await jobsApi.getEvents(jobId);
      events.value = result.items;
    } catch {
      // API unavailable
    } finally {
      loadingEvents.value = false;
    }
  }

  async function fetchArtifacts(jobId: string): Promise<void> {
    if (artifacts.value.length === 0) loadingArtifacts.value = true;
    try {
      const result = await jobsApi.getArtifacts(jobId);
      artifacts.value = result.items;
    } catch {
      // API unavailable
    } finally {
      loadingArtifacts.value = false;
    }
  }

  async function fetchSpec(jobId: string): Promise<void> {
    if (!spec.value) loadingSpec.value = true;
    try {
      spec.value = await jobsApi.getSpec(jobId);
    } catch {
      spec.value = null;
    } finally {
      loadingSpec.value = false;
    }
  }

  async function approvePhase(jobId: string, phase: string): Promise<void> {
    spec.value = await jobsApi.approveSpecPhase(jobId, phase);
    await fetchOne(jobId);
  }

  async function rejectPhase(jobId: string, phase: string, reason: string): Promise<void> {
    spec.value = await jobsApi.rejectSpecPhase(jobId, phase, reason);
    await fetchOne(jobId);
  }

  async function updateSpecItems(jobId: string, phase: string, items: SpecItem[]): Promise<void> {
    spec.value = await jobsApi.updateSpecItems(jobId, phase, items);
  }

  async function postPhaseMessage(jobId: string, phase: string, message: string) {
    return await jobsApi.postPhaseMessage(jobId, phase, message);
  }

  async function getPhaseMessages(jobId: string, phase: string) {
    const result = await jobsApi.getPhaseMessages(jobId, phase);
    return result.items;
  }

  function resetDetail() {
    current.value = null;
    events.value = [];
    artifacts.value = [];
    spec.value = null;
    error.value = null;
  }

  return {
    jobs,
    current,
    events,
    artifacts,
    spec,
    loading,
    loadingEvents,
    loadingArtifacts,
    loadingSpec,
    error,
    statusFilter,
    jobCountsByStatus,
    fetchAll,
    fetchOne,
    create,
    cancel,
    fetchEvents,
    fetchArtifacts,
    fetchSpec,
    approvePhase,
    rejectPhase,
    updateSpecItems,
    postPhaseMessage,
    getPhaseMessages,
    resetDetail,
  };
});
