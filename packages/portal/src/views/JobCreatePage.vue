<template>
  <div class="job-create-page">
    <div class="page-header">
      <h1>Create Job</h1>
      <p>Submit a new coding task for your agent to work on.</p>
    </div>

    <div class="form-card">
      <form @submit.prevent="submit">
        <div>
          <label>Repository</label>
          <select v-model="form.repoId" required>
            <option value="" disabled>Select a repository</option>
            <option v-for="repo in repoStore.repositories" :key="repo.repoId" :value="repo.repoId">
              {{ repo.name }}
            </option>
          </select>
        </div>
        <div>
          <label>Profile</label>
          <select v-model="form.profileId" required>
            <option value="" disabled>Select a profile</option>
            <option v-for="p in featureProfiles" :key="p.profileId" :value="p.profileId">
              {{ p.name }} (v{{ p.bundleVersion }})
            </option>
          </select>
        </div>
        <div>
          <label>AI Agent (optional)</label>
          <select v-model="form.aiAgentId">
            <option value="">None (default Kiro behavior)</option>
            <option v-for="a in aiAgentStore.aiAgents" :key="a.aiAgentId" :value="a.aiAgentId">
              {{ a.name }} ({{ formatCategory(a.category) }})
            </option>
          </select>
          <span class="field-hint">Select a specialized agent to customize how Kiro approaches this task</span>
        </div>
        <div class="field-with-improve">
          <label>Feature Description</label>
          <textarea v-model="form.description" rows="4" required placeholder="Describe the feature to implement..."></textarea>
          <button
            type="button"
            class="improve-btn"
            :disabled="improvingDescription || !form.description.trim()"
            @click="improveField('description')"
          >
            {{ improvingDescription ? 'Improving...' : 'Improve with Bedrock' }}
          </button>
        </div>
        <div class="field-with-improve">
          <label>Constraints (optional)</label>
          <textarea v-model="form.constraints" rows="3" placeholder="Any constraints or guidelines..."></textarea>
          <button
            type="button"
            class="improve-btn"
            :disabled="improvingConstraints || !form.constraints.trim()"
            @click="improveField('constraints')"
          >
            {{ improvingConstraints ? 'Improving...' : 'Improve with Bedrock' }}
          </button>
        </div>
        <button type="submit" :disabled="submitting">{{ submitting ? "Creating..." : "Create Job" }}</button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useRepositoriesStore, useProfilesStore, useJobsStore, useAIAgentsStore } from "../stores";
import { apiClient } from "../api";

const router = useRouter();
const repoStore = useRepositoriesStore();
const profileStore = useProfilesStore();
const jobsStore = useJobsStore();
const aiAgentStore = useAIAgentsStore();

const form = reactive({
  repoId: "",
  profileId: "",
  aiAgentId: "",
  description: "",
  constraints: "",
});
const submitting = ref(false);
const error = ref("");
const improvingDescription = ref(false);
const improvingConstraints = ref(false);

const featureProfiles = computed(() =>
  profileStore.profiles.filter((p) => p.profileType === "feature" && p.active),
);

onMounted(() => {
  repoStore.fetchAll();
  profileStore.fetchAll();
  aiAgentStore.fetchAll();
});

function formatCategory(cat: string): string {
  const map: Record<string, string> = {
    ui_frontend: "UI/Frontend", backend: "Backend", python: "Python",
    aws_serverless: "AWS", fullstack: "Full Stack", code_review: "Review",
    security_review: "Security", custom: "Custom",
  };
  return map[cat] || cat;
}

async function improveField(field: "description" | "constraints") {
  const text = form[field].trim();
  if (!text) return;

  if (field === "description") improvingDescription.value = true;
  else improvingConstraints.value = true;

  error.value = "";
  try {
    const result = await apiClient.bedrock.improveText(text, field);
    if (result.improved) {
      form[field] = result.improved;
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : `Failed to improve ${field}`;
  } finally {
    if (field === "description") improvingDescription.value = false;
    else improvingConstraints.value = false;
  }
}

async function submit() {
  submitting.value = true;
  error.value = "";
  try {
    const job = await jobsStore.create({
      jobType: "implement_feature",
      repoId: form.repoId,
      profileId: form.profileId,
      description: form.description,
      constraints: form.constraints || undefined,
      aiAgentId: form.aiAgentId || undefined,
    });
    router.push({ name: "job-detail", params: { jobId: job.jobId } });
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Job creation failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.field-with-improve {
  position: relative;
}

.field-with-improve textarea {
  width: 100%;
}

.improve-btn {
  display: inline-block;
  margin-top: 6px;
  padding: 5px 14px;
  font-size: 0.8rem;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.improve-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.improve-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 0.75rem;
  color: var(--color-text-tertiary, #9ca3af);
}
</style>
