<template>
  <div class="repository-detail-page">
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h1>Repository Settings</h1>
        <p>Update configuration for this repository.</p>
      </div>
      <router-link :to="{ name: 'repositories' }" class="btn-secondary btn-sm" style="text-decoration:none">
        &larr; Back to Repositories
      </router-link>
    </div>

    <div v-if="repoStore.loading" class="loading-state">Loading...</div>
    <template v-else-if="repoStore.current">
      <!-- Status Banner -->
      <div v-if="repoStore.current.status === 'archived'" class="archived-banner">
        This repository is archived. It cannot be used for new jobs.
        <button class="btn-sm btn-primary" @click="handleReactivate" :disabled="saving" style="margin-left:12px">
          {{ saving ? 'Reactivating...' : 'Reactivate' }}
        </button>
      </div>

      <div class="form-card">
        <form @submit.prevent="save">
          <div>
            <label>Name</label>
            <p style="padding:10px 0;font-weight:600;color:var(--color-text)">{{ repoStore.current.name }}</p>
          </div>
          <div>
            <label>URL</label>
            <p style="padding:10px 0" class="mono">{{ repoStore.current.url }}</p>
          </div>
          <div>
            <label>Status</label>
            <p style="padding:10px 0">
              <span :class="repoStore.current.status === 'active' ? 'badge badge-success' : 'badge badge-neutral'">
                {{ repoStore.current.status }}
              </span>
            </p>
          </div>
          <div>
            <label>Default Branch</label>
            <input v-model="form.defaultBranch" />
          </div>
          <div>
            <label>Default Feature Profile</label>
            <select v-model="form.defaultFeatureProfileId" required>
              <option value="" disabled>Select a feature profile</option>
              <option v-for="p in featureProfiles" :key="p.profileId" :value="p.profileId">
                {{ p.name }} (v{{ p.bundleVersion }})
              </option>
            </select>
            <p v-if="!featureProfiles.length" style="font-size:0.8rem;color:var(--color-text-tertiary);margin-top:4px">
              No active feature profiles available.
            </p>
          </div>
          <div>
            <label>Default Review Profile</label>
            <select v-model="form.defaultReviewProfileId">
              <option value="">None</option>
              <option v-for="p in reviewerProfiles" :key="p.profileId" :value="p.profileId">
                {{ p.name }} (v{{ p.bundleVersion }})
              </option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="autoReviewDetail" v-model="form.autoReviewEnabled" />
            <label for="autoReviewDetail" style="margin:0">Auto PR Review</label>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="submit" :disabled="saving">{{ saving ? "Saving..." : "Save Changes" }}</button>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <p v-if="saved" class="success">Settings saved successfully.</p>
        </form>
      </div>

      <!-- MCP Servers Section -->
      <div class="form-card" style="margin-top:24px">
        <h3 style="margin-bottom:16px">MCP Servers</h3>
        <p style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:16px">
          Configure MCP (Model Context Protocol) servers for the agent to use when processing jobs for this repository.
        </p>

        <div v-if="mcpServers.length === 0 && !showMcpForm" class="cred-status-card cred-not-configured">
          <p style="margin-bottom:8px">No MCP servers configured.</p>
          <button class="btn-sm btn-primary" @click="addMcpServer">Add MCP Server</button>
        </div>

        <div v-for="(server, idx) in mcpServers" :key="idx" class="mcp-server-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span :class="server.enabled ? 'badge badge-success' : 'badge badge-neutral'">
              {{ server.enabled ? 'Enabled' : 'Disabled' }}
            </span>
            <strong>{{ server.name }}</strong>
          </div>
          <div class="mono" style="font-size:0.8rem;color:var(--color-text-secondary);margin-bottom:6px">
            {{ server.command }} {{ (server.args || []).join(' ') }}
          </div>
          <div v-if="server.env && Object.keys(server.env).length" style="font-size:0.75rem;color:var(--color-text-tertiary)">
            Env: {{ Object.keys(server.env).join(', ') }}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn-sm btn-secondary" @click="toggleMcpServer(idx)">
              {{ server.enabled ? 'Disable' : 'Enable' }}
            </button>
            <button class="btn-sm btn-outline-danger" @click="removeMcpServer(idx)">Remove</button>
          </div>
        </div>

        <div v-if="mcpServers.length > 0 && !showMcpForm" style="margin-top:12px">
          <button class="btn-sm btn-secondary" @click="addMcpServer">Add Another</button>
        </div>

        <!-- Add MCP Server Form -->
        <form v-if="showMcpForm" class="cred-form" @submit.prevent="saveMcpServer" style="margin-top:12px">
          <div>
            <label>Server Name</label>
            <input v-model="mcpForm.name" required placeholder="e.g. filesystem, github" />
          </div>
          <div>
            <label>Command</label>
            <input v-model="mcpForm.command" required placeholder="e.g. npx, node, python" />
          </div>
          <div>
            <label>Arguments <span style="font-weight:normal;color:var(--color-text-tertiary)">(one per line)</span></label>
            <textarea v-model="mcpForm.argsText" rows="3" placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir" style="font-family:monospace;font-size:0.8rem"></textarea>
          </div>
          <div>
            <label>Environment Variables <span style="font-weight:normal;color:var(--color-text-tertiary)">(KEY=VALUE, one per line)</span></label>
            <textarea v-model="mcpForm.envText" rows="2" placeholder="GITHUB_TOKEN=ghp_..." style="font-family:monospace;font-size:0.8rem"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="submit">Add Server</button>
            <button type="button" class="btn-secondary" @click="showMcpForm = false">Cancel</button>
          </div>
        </form>
      </div>

      <!-- Git Credentials Section -->
      <div class="form-card" style="margin-top:24px">
        <h3 style="margin-bottom:16px">Git Credentials</h3>
        <p style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:16px">
          Configure credentials so the agent can access this repository. Secrets are stored securely in AWS Secrets Manager.
        </p>

        <div v-if="credLoading" class="loading-state" style="padding:12px 0">Loading credential status...</div>
        <template v-else>
          <!-- Current credential info -->
          <div v-if="credConfigured" class="cred-status-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span class="badge badge-success">Configured</span>
              <span class="mono" style="font-size:0.85rem">{{ credTypeLabel(currentCredType) }}</span>
              <span v-if="currentCredUsername" style="font-size:0.85rem;color:var(--color-text-secondary)">
                ({{ currentCredUsername }})
              </span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn-sm btn-secondary" @click="showCredForm = !showCredForm">
                {{ showCredForm ? 'Cancel' : 'Update' }}
              </button>
              <button class="btn-sm btn-outline-danger" @click="deleteCred" :disabled="credSaving">
                Remove
              </button>
            </div>
          </div>
          <div v-else class="cred-status-card cred-not-configured">
            <p style="margin-bottom:8px">No credentials configured. The agent will attempt anonymous access.</p>
            <button class="btn-sm btn-primary" @click="showCredForm = true" v-if="!showCredForm">
              Configure Credentials
            </button>
          </div>

          <!-- Credential form -->
          <form v-if="showCredForm" class="cred-form" @submit.prevent="saveCred">
            <div>
              <label>Credential Type</label>
              <select v-model="credForm.credentialType" required>
                <option value="" disabled>Select type</option>
                <option value="https_basic">HTTPS Token / PAT</option>
                <option value="ssh_key">SSH Private Key</option>
                <option value="codecommit_iam">CodeCommit IAM (agent role)</option>
              </select>
            </div>

            <!-- HTTPS fields -->
            <template v-if="credForm.credentialType === 'https_basic'">
              <div>
                <label>Username <span style="font-weight:normal;color:var(--color-text-tertiary)">(optional)</span></label>
                <input v-model="credForm.username" placeholder="e.g. git or your username" />
              </div>
              <div>
                <label>Token / Password</label>
                <input v-model="credForm.token" type="password" required placeholder="ghp_... or personal access token" />
              </div>
            </template>

            <!-- SSH fields -->
            <template v-if="credForm.credentialType === 'ssh_key'">
              <div>
                <label>SSH Private Key</label>
                <textarea v-model="credForm.sshPrivateKey" required rows="6"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  style="font-family:monospace;font-size:0.8rem;resize:vertical" />
              </div>
            </template>

            <!-- CodeCommit IAM - no extra fields -->
            <p v-if="credForm.credentialType === 'codecommit_iam'" style="font-size:0.85rem;color:var(--color-text-secondary);padding:8px 0">
              The agent will use its IAM role to authenticate with CodeCommit. No additional secrets needed.
            </p>

            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="submit" :disabled="credSaving || !credForm.credentialType">
                {{ credSaving ? 'Saving...' : 'Save Credential' }}
              </button>
              <button type="button" class="btn-secondary" @click="showCredForm = false">Cancel</button>
            </div>
            <p v-if="credError" class="error">{{ credError }}</p>
            <p v-if="credSaved" class="success">Credential saved successfully.</p>
          </form>
        </template>
      </div>

      <!-- Danger Zone -->
      <div class="danger-zone">
        <h3>Danger Zone</h3>
        <div class="danger-zone-item">
          <div>
            <strong>Archive this repository</strong>
            <p>Archiving will prevent new jobs from being created against this repository. Existing jobs are unaffected.</p>
          </div>
          <button
            v-if="repoStore.current.status === 'active'"
            class="btn-sm btn-outline-danger"
            @click="showArchiveConfirm = true"
            :disabled="archiving"
          >
            Archive Repository
          </button>
          <span v-else class="badge badge-neutral">Already archived</span>
        </div>
      </div>

      <!-- Archive Confirmation Modal -->
      <div v-if="showArchiveConfirm" class="confirm-overlay" @click.self="showArchiveConfirm = false">
        <div class="confirm-dialog">
          <h3>Archive Repository?</h3>
          <p>Are you sure you want to archive <strong>{{ repoStore.current.name }}</strong>? No new jobs can be created for this repository until it is reactivated.</p>
          <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn-sm btn-secondary" @click="showArchiveConfirm = false">Cancel</button>
            <button class="btn-sm btn-danger" @click="handleArchive" :disabled="archiving">
              {{ archiving ? 'Archiving...' : 'Archive' }}
            </button>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty-state">Repository not found.</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { useRepositoriesStore, useProfilesStore } from "../stores";
import { repositories as repoApi } from "../api";

const props = defineProps<{ repoId: string }>();
const repoStore = useRepositoriesStore();
const profileStore = useProfilesStore();

const form = reactive({
  defaultBranch: "",
  defaultFeatureProfileId: "",
  defaultReviewProfileId: "",
  autoReviewEnabled: false,
});
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const archiving = ref(false);
const showArchiveConfirm = ref(false);

const featureProfiles = computed(() =>
  profileStore.profiles.filter((p) => p.profileType === "feature" && p.active),
);

const reviewerProfiles = computed(() =>
  profileStore.profiles.filter((p) => p.profileType === "reviewer" && p.active),
);

onMounted(() => {
  repoStore.fetchOne(props.repoId);
  profileStore.fetchAll();
  loadCredential();
});

watch(() => repoStore.current, (repo) => {
  if (repo) {
    form.defaultBranch = repo.defaultBranch;
    form.defaultFeatureProfileId = repo.defaultFeatureProfileId;
    form.defaultReviewProfileId = repo.defaultReviewProfileId ?? "";
    form.autoReviewEnabled = repo.autoReviewEnabled;
  }
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    await repoStore.update(props.repoId, {
      defaultBranch: form.defaultBranch,
      defaultFeatureProfileId: form.defaultFeatureProfileId,
      defaultReviewProfileId: form.defaultReviewProfileId || null,
      autoReviewEnabled: form.autoReviewEnabled,
    });
    saved.value = true;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Update failed";
  } finally {
    saving.value = false;
  }
}

async function handleArchive() {
  archiving.value = true;
  error.value = "";
  try {
    await repoStore.update(props.repoId, { status: "archived" });
    showArchiveConfirm.value = false;
    await repoStore.fetchOne(props.repoId);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Archive failed";
  } finally {
    archiving.value = false;
  }
}

async function handleReactivate() {
  saving.value = true;
  error.value = "";
  try {
    await repoStore.update(props.repoId, { status: "active" });
    await repoStore.fetchOne(props.repoId);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Reactivate failed";
  } finally {
    saving.value = false;
  }
}

// ─── MCP Servers ───

const mcpServers = ref<Array<{ name: string; command: string; args?: string[]; env?: Record<string, string>; enabled: boolean }>>([]);
const showMcpForm = ref(false);
const mcpForm = reactive({
  name: "",
  command: "",
  argsText: "",
  envText: "",
});

watch(() => repoStore.current, (repo) => {
  if (repo) {
    mcpServers.value = (repo as any).mcpServers ?? [];
  }
});

function addMcpServer() {
  mcpForm.name = "";
  mcpForm.command = "";
  mcpForm.argsText = "";
  mcpForm.envText = "";
  showMcpForm.value = true;
}

async function saveMcpServer() {
  const args = mcpForm.argsText.split("\n").map(s => s.trim()).filter(Boolean);
  const env: Record<string, string> = {};
  for (const line of mcpForm.envText.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }

  mcpServers.value.push({
    name: mcpForm.name,
    command: mcpForm.command,
    args: args.length > 0 ? args : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    enabled: true,
  });

  showMcpForm.value = false;
  await saveMcpServersToRepo();
}

function toggleMcpServer(idx: number) {
  mcpServers.value[idx].enabled = !mcpServers.value[idx].enabled;
  saveMcpServersToRepo();
}

function removeMcpServer(idx: number) {
  mcpServers.value.splice(idx, 1);
  saveMcpServersToRepo();
}

async function saveMcpServersToRepo() {
  try {
    await repoStore.update(props.repoId, { mcpServers: mcpServers.value } as any);
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Failed to update MCP servers";
  }
}

// ─── Git Credentials ───

const credLoading = ref(false);
const credConfigured = ref(false);
const currentCredType = ref("");
const currentCredUsername = ref("");
const showCredForm = ref(false);
const credSaving = ref(false);
const credSaved = ref(false);
const credError = ref("");

const credForm = reactive({
  credentialType: "" as string,
  username: "",
  token: "",
  sshPrivateKey: "",
});

function credTypeLabel(t: string) {
  if (t === "https_basic") return "HTTPS Token / PAT";
  if (t === "ssh_key") return "SSH Key";
  if (t === "codecommit_iam") return "CodeCommit IAM";
  return t;
}

async function loadCredential() {
  credLoading.value = true;
  try {
    const data = await repoApi.getCredential(props.repoId);
    credConfigured.value = !!data?.configured;
    currentCredType.value = data?.credentialType ?? "";
    currentCredUsername.value = data?.username ?? "";
  } catch {
    credConfigured.value = false;
  } finally {
    credLoading.value = false;
  }
}

async function saveCred() {
  credSaving.value = true;
  credSaved.value = false;
  credError.value = "";
  try {
    const payload: { credentialType: string; username?: string; token?: string; sshPrivateKey?: string } = {
      credentialType: credForm.credentialType,
    };
    if (credForm.credentialType === "https_basic") {
      if (credForm.username) payload.username = credForm.username;
      payload.token = credForm.token;
    } else if (credForm.credentialType === "ssh_key") {
      payload.sshPrivateKey = credForm.sshPrivateKey;
    }
    await repoApi.putCredential(props.repoId, payload);
    credSaved.value = true;
    showCredForm.value = false;
    await loadCredential();
  } catch (e: unknown) {
    credError.value = e instanceof Error ? e.message : "Failed to save credential";
  } finally {
    credSaving.value = false;
  }
}

async function deleteCred() {
  credSaving.value = true;
  credError.value = "";
  try {
    await repoApi.deleteCredential(props.repoId);
    credConfigured.value = false;
    currentCredType.value = "";
    currentCredUsername.value = "";
  } catch (e: unknown) {
    credError.value = e instanceof Error ? e.message : "Failed to remove credential";
  } finally {
    credSaving.value = false;
  }
}


</script>
