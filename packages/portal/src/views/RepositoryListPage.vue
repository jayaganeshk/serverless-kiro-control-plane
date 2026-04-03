<template>
  <div class="repository-list-page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1>Repositories</h1>
        <p>Manage your connected code repositories.</p>
      </div>
      <button class="btn-primary" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : '+ Add Repository' }}
      </button>
    </div>

    <div v-if="showForm" class="form-card" style="margin-bottom:24px">
      <form @submit.prevent="handleCreate">
        <div>
          <label>Repository Name</label>
          <input v-model="form.name" placeholder="my-awesome-project" required />
        </div>
        <div>
          <label>Repository URL</label>
          <input v-model="form.url" placeholder="https://github.com/user/repo" required />
        </div>
        <div>
          <label>Default Branch</label>
          <input v-model="form.defaultBranch" placeholder="main" required />
        </div>
        <div>
          <label>Default Feature Profile</label>
          <select v-model="form.defaultFeatureProfileId" required>
            <option value="" disabled>Select a profile</option>
            <option v-for="p in featureProfiles" :key="p.profileId" :value="p.profileId">
              {{ p.name }} (v{{ p.bundleVersion }})
            </option>
          </select>
          <p v-if="!featureProfiles.length" class="error">
            No active feature profiles found. Create and publish a profile first.
          </p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <input id="autoReview" type="checkbox" v-model="form.autoReviewEnabled" />
          <label for="autoReview" style="margin:0">Enable auto review</label>
        </div>
        <button type="submit" :disabled="creating || !featureProfiles.length">
          {{ creating ? 'Creating...' : 'Create Repository' }}
        </button>
        <p v-if="formError" class="error">{{ formError }}</p>
        <p v-if="formSuccess" class="success">{{ formSuccess }}</p>
      </form>
    </div>

    <div v-if="repoStore.loading" class="loading-state">Loading repositories...</div>
    <table v-else-if="repoStore.repositories.length">
      <thead>
        <tr>
          <th>Name</th>
          <th>URL</th>
          <th>Branch</th>
          <th>Profile</th>
          <th>Auto Review</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="repo in repoStore.repositories" :key="repo.repoId">
          <td>
            <router-link :to="{ name: 'repository-detail', params: { repoId: repo.repoId } }">
              <strong>{{ repo.name }}</strong>
            </router-link>
          </td>
          <td class="mono">{{ repo.url }}</td>
          <td><span class="badge badge-neutral">{{ repo.defaultBranch }}</span></td>
          <td>{{ getProfileName(repo.defaultFeatureProfileId) }}</td>
          <td>
            <span :class="repo.autoReviewEnabled ? 'badge badge-success' : 'badge badge-neutral'">
              {{ repo.autoReviewEnabled ? "Enabled" : "Disabled" }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty-state">No repositories registered. Click "Add Repository" to get started.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useRepositoriesStore, useProfilesStore } from "../stores";

const repoStore = useRepositoriesStore();
const profileStore = useProfilesStore();

const showForm = ref(false);
const creating = ref(false);
const formError = ref("");
const formSuccess = ref("");

const form = reactive({
  name: "",
  url: "",
  defaultBranch: "main",
  defaultFeatureProfileId: "",
  autoReviewEnabled: false,
});

const featureProfiles = computed(() =>
  profileStore.profiles.filter((p) => p.profileType === "feature"),
);

function getProfileName(profileId: string): string {
  const profile = profileStore.profiles.find((p) => p.profileId === profileId);
  return profile ? `${profile.name} (v${profile.bundleVersion})` : profileId.slice(0, 12) + '...';
}

onMounted(() => {
  repoStore.fetchAll();
  profileStore.fetchAll();
});

async function handleCreate() {
  creating.value = true;
  formError.value = "";
  formSuccess.value = "";
  try {
    await repoStore.create({ ...form });
    formSuccess.value = `Repository "${form.name}" created successfully!`;
    form.name = "";
    form.url = "";
    form.defaultBranch = "main";
    form.defaultFeatureProfileId = "";
    form.autoReviewEnabled = false;
    showForm.value = false;
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : "Failed to create repository";
  } finally {
    creating.value = false;
  }
}
</script>
