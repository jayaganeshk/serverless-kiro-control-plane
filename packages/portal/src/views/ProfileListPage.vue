<template>
  <div class="profile-list-page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1>Profiles</h1>
        <p>Configure feature and reviewer profiles for your agents.</p>
      </div>
      <button class="btn-primary" @click="showForm = !showForm">
        {{ showForm ? 'Cancel' : '+ Add Profile' }}
      </button>
    </div>

    <div v-if="showForm" class="form-card" style="margin-bottom:24px">
      <form @submit.prevent="handleCreate">
        <div>
          <label>Profile Name</label>
          <input v-model="form.name" placeholder="my-feature-profile" required />
        </div>
        <div>
          <label>Profile Type</label>
          <select v-model="form.profileType" required>
            <option value="feature">Feature</option>
            <option value="reviewer">Reviewer</option>
          </select>
        </div>
        <div>
          <label>Description</label>
          <textarea v-model="form.description" rows="3" required placeholder="Describe what this profile does..."></textarea>
        </div>
        <div>
          <label>Manifest JSON (optional)</label>
          <textarea
            v-model="form.manifestRaw"
            rows="8"
            class="manifest-editor-textarea"
            placeholder='{ "mcpServers": {}, "rules": [] }'
            @input="validateManifestInput"
          ></textarea>
          <p v-if="form.manifestError" class="manifest-error" style="margin-top:4px">{{ form.manifestError }}</p>
        </div>
        <button type="submit" :disabled="creating">
          {{ creating ? 'Creating...' : 'Create Profile' }}
        </button>
        <p v-if="formError" class="error">{{ formError }}</p>
        <p v-if="formSuccess" class="success">{{ formSuccess }}</p>
      </form>
    </div>

    <div v-if="showUpload" class="form-card" style="margin-bottom:24px">
      <h3 style="margin-bottom:12px;font-size:1rem;font-weight:700">Publish Bundle for: {{ uploadTarget?.name }}</h3>
      <form @submit.prevent="handleUpload">
        <div>
          <label>Bundle ZIP file (must contain manifest.json)</label>
          <input type="file" accept=".zip" @change="onFileChange" required />
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="submit" :disabled="uploading || !bundleFile">
            {{ uploading ? 'Uploading...' : 'Publish Bundle' }}
          </button>
          <button type="button" class="btn-secondary" @click="showUpload = false; uploadTarget = null">Cancel</button>
        </div>
        <p v-if="uploadError" class="error">{{ uploadError }}</p>
        <p v-if="uploadSuccess" class="success">{{ uploadSuccess }}</p>
      </form>
    </div>

    <div v-if="profileStore.loading" class="loading-state">Loading profiles...</div>
    <template v-else-if="profileStore.profiles.length">
      <div v-for="profile in profileStore.profiles" :key="profile.profileId" class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:4px">{{ profile.name }}</h3>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
              <span class="badge badge-neutral">{{ profile.profileType }}</span>
              <code class="mono">v{{ profile.bundleVersion }}</code>
              <span :class="profile.active ? 'badge badge-success' : 'badge badge-neutral'">
                {{ profile.active ? "Active" : "Inactive" }}
              </span>
            </div>
            <p style="font-size:0.85rem;color:var(--color-text-secondary)">{{ profile.description }}</p>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-sm btn-secondary" @click="startUpload(profile)">Upload Bundle</button>
            <button class="btn-sm btn-secondary" @click="toggleManifestEditor(profile)">
              {{ editingManifestId === profile.profileId ? 'Close Editor' : 'Edit Manifest' }}
            </button>
          </div>
        </div>

        <!-- Inline Manifest Editor -->
        <div v-if="editingManifestId === profile.profileId" class="manifest-editor">
          <label style="font-size:0.8rem;font-weight:600;color:var(--color-text-secondary)">Manifest JSON</label>
          <textarea
            class="manifest-editor-textarea"
            :value="manifestEditorContent"
            @input="onManifestInput"
            rows="16"
            spellcheck="false"
          ></textarea>
          <div class="manifest-editor-actions">
            <button class="btn-sm btn-primary" @click="handleSaveManifest(profile.profileId)" :disabled="savingManifest || !!manifestParseError">
              {{ savingManifest ? 'Saving...' : 'Save Manifest' }}
            </button>
            <button class="btn-sm btn-secondary" @click="handleFormatManifest">Format JSON</button>
            <span v-if="manifestParseError" class="manifest-error">{{ manifestParseError }}</span>
            <span v-if="manifestSaveSuccess" class="success" style="padding:4px 10px;font-size:0.8rem">Saved!</span>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty-state">No profiles found. Click "Add Profile" to get started.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import type { Profile } from "@remote-kiro/common";
import { useProfilesStore } from "../stores";

const profileStore = useProfilesStore();

const showForm = ref(false);
const creating = ref(false);
const formError = ref("");
const formSuccess = ref("");

const form = reactive({
  name: "",
  profileType: "feature" as "feature" | "reviewer",
  description: "",
  manifestRaw: "",
  manifestError: "",
});

const showUpload = ref(false);
const uploadTarget = ref<Profile | null>(null);
const bundleFile = ref<File | null>(null);
const uploading = ref(false);
const uploadError = ref("");
const uploadSuccess = ref("");

const editingManifestId = ref<string | null>(null);
const manifestEditorContent = ref("");
const manifestParseError = ref("");
const savingManifest = ref(false);
const manifestSaveSuccess = ref(false);

onMounted(() => {
  profileStore.fetchAll();
});

function validateManifestInput() {
  if (!form.manifestRaw.trim()) {
    form.manifestError = "";
    return;
  }
  try {
    JSON.parse(form.manifestRaw);
    form.manifestError = "";
  } catch (e: unknown) {
    form.manifestError = `Invalid JSON: ${(e as Error).message}`;
  }
}

async function handleCreate() {
  creating.value = true;
  formError.value = "";
  formSuccess.value = "";
  try {
    let manifest: Record<string, unknown> | null = null;
    if (form.manifestRaw.trim()) {
      try {
        manifest = JSON.parse(form.manifestRaw);
      } catch {
        formError.value = "Invalid manifest JSON";
        creating.value = false;
        return;
      }
    }
    await profileStore.create({ ...form, manifest } as any);
    formSuccess.value = `Profile "${form.name}" created! Upload a bundle to activate it.`;
    form.name = "";
    form.profileType = "feature";
    form.description = "";
    form.manifestRaw = "";
    showForm.value = false;
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : "Failed to create profile";
  } finally {
    creating.value = false;
  }
}

function startUpload(profile: Profile) {
  uploadTarget.value = profile;
  showUpload.value = true;
  bundleFile.value = null;
  uploadError.value = "";
  uploadSuccess.value = "";
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  bundleFile.value = input.files?.[0] ?? null;
}

async function handleUpload() {
  if (!uploadTarget.value || !bundleFile.value) return;
  uploading.value = true;
  uploadError.value = "";
  uploadSuccess.value = "";
  try {
    await profileStore.publishBundle(uploadTarget.value.profileId, bundleFile.value);
    uploadSuccess.value = "Bundle published successfully! Profile is now active.";
    showUpload.value = false;
    uploadTarget.value = null;
  } catch (e: unknown) {
    uploadError.value = e instanceof Error ? e.message : "Bundle upload failed";
  } finally {
    uploading.value = false;
  }
}

function toggleManifestEditor(profile: Profile) {
  if (editingManifestId.value === profile.profileId) {
    editingManifestId.value = null;
    return;
  }
  editingManifestId.value = profile.profileId;
  manifestParseError.value = "";
  manifestSaveSuccess.value = false;
  const manifest = profile.manifest ?? {};
  manifestEditorContent.value = JSON.stringify(manifest, null, 2);
}

function onManifestInput(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value;
  manifestEditorContent.value = value;
  manifestParseError.value = "";
  manifestSaveSuccess.value = false;
  if (!value.trim()) return;
  try {
    JSON.parse(value);
  } catch (err: unknown) {
    manifestParseError.value = `Invalid JSON: ${(err as Error).message}`;
  }
}

function handleFormatManifest() {
  try {
    const parsed = JSON.parse(manifestEditorContent.value);
    manifestEditorContent.value = JSON.stringify(parsed, null, 2);
    manifestParseError.value = "";
  } catch (err: unknown) {
    manifestParseError.value = `Cannot format: ${(err as Error).message}`;
  }
}

async function handleSaveManifest(profileId: string) {
  savingManifest.value = true;
  manifestSaveSuccess.value = false;
  try {
    const manifest = manifestEditorContent.value.trim()
      ? JSON.parse(manifestEditorContent.value)
      : null;
    await profileStore.updateManifest(profileId, manifest);
    manifestSaveSuccess.value = true;
    setTimeout(() => { manifestSaveSuccess.value = false; }, 3000);
  } catch (e: unknown) {
    manifestParseError.value = e instanceof Error ? e.message : "Save failed";
  } finally {
    savingManifest.value = false;
  }
}
</script>
