<template>
  <div class="admin-page">
    <div class="page-header">
      <h1>Admin</h1>
      <p>Publish configuration bundles to activate agent profiles.</p>
    </div>

    <div class="form-card">
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:20px">Publish Config Bundle</h3>
      <form @submit.prevent="publish">
        <div>
          <label>Select Profile</label>
          <select v-model="selectedProfileId">
            <option value="" disabled>Choose a profile</option>
            <option v-for="p in profileStore.profiles" :key="p.profileId" :value="p.profileId">
              {{ p.name }} ({{ p.profileType }}, v{{ p.bundleVersion }})
            </option>
          </select>
        </div>

        <div>
          <label>Bundle Archive (.zip)</label>
          <input type="file" accept=".zip" @change="onFileChange" />
        </div>

        <button type="submit" :disabled="!canPublish || publishing">
          {{ publishing ? "Publishing..." : "Publish Bundle" }}
        </button>

        <p v-if="error" class="error">{{ error }}</p>
        <p v-if="success" class="success">Bundle published successfully. New version: v{{ newVersion }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useProfilesStore } from "../stores";

const profileStore = useProfilesStore();

const selectedProfileId = ref("");
const bundleFile = ref<File | null>(null);
const publishing = ref(false);
const error = ref("");
const success = ref(false);
const newVersion = ref(0);

const canPublish = computed(() => selectedProfileId.value && bundleFile.value);

onMounted(() => {
  profileStore.fetchAll();
});

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  bundleFile.value = input.files?.[0] ?? null;
}

async function publish() {
  if (!selectedProfileId.value || !bundleFile.value) return;
  publishing.value = true;
  error.value = "";
  success.value = false;
  try {
    const updated = await profileStore.publishBundle(selectedProfileId.value, bundleFile.value);
    newVersion.value = updated.bundleVersion;
    success.value = true;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Publish failed";
  } finally {
    publishing.value = false;
  }
}
</script>
