<template>
  <div class="ai-agents-page">
    <div class="page-header">
      <h1>AI Agents</h1>
      <p>Manage AI agent configurations for Kiro CLI. Select specialized agents when creating jobs or reviews.</p>
    </div>

    <!-- Create Agent Panel -->
    <div class="create-panel card">
      <h3>Create Custom Agent</h3>
      <p class="hint">Describe the kind of agent you want. Bedrock AI will generate the configuration.</p>
      <div class="create-form">
        <div class="form-row">
          <textarea
            v-model="createPrompt"
            placeholder="e.g., A Vue.js 3 frontend expert with Pinia state management, Tailwind CSS, and accessibility best practices..."
            rows="3"
            class="prompt-input"
            :disabled="generating"
          />
        </div>
        <div class="form-row-inline">
          <select v-model="createCategory" class="filter-select" :disabled="generating">
            <option value="custom">Custom</option>
            <option value="ui_frontend">UI / Frontend</option>
            <option value="backend">Backend</option>
            <option value="python">Python</option>
            <option value="aws_serverless">AWS Serverless</option>
            <option value="fullstack">Full Stack</option>
            <option value="code_review">Code Review</option>
            <option value="security_review">Security Review</option>
          </select>
          <button class="btn btn-sm btn-secondary" @click="refinePrompt" :disabled="!createPrompt.trim() || refining">
            {{ refining ? 'Refining...' : 'Refine Prompt' }}
          </button>
          <button class="btn btn-primary" @click="generateAgent" :disabled="!createPrompt.trim() || generating">
            {{ generating ? 'Generating...' : 'Generate Agent' }}
          </button>
        </div>
      </div>

      <!-- MCP Configuration Section -->
      <div class="mcp-config-section">
        <div class="mcp-config-header">
          <h4>
            <span class="mcp-icon">&#9881;</span> MCP Servers
            <span v-if="selectedMcpServers.length" class="mcp-count">{{ selectedMcpServers.length }}</span>
          </h4>
          <div class="mcp-actions">
            <button
              class="btn btn-sm btn-accent"
              @click="suggestMcpServers"
              :disabled="!createPrompt.trim() || suggestingMcp"
              title="AI will suggest relevant MCP servers based on your agent description"
            >
              {{ suggestingMcp ? 'Suggesting...' : 'AI Suggest' }}
            </button>
            <button class="btn btn-sm btn-secondary" @click="showMcpPicker = true">
              Browse Registry
            </button>
            <button class="btn btn-sm btn-secondary" @click="showManualMcp = true">
              Add Custom
            </button>
            <a href="https://mcpservers.org/" target="_blank" rel="noopener" class="btn btn-sm btn-outline" title="Discover 7000+ MCP servers">
              mcpservers.org &#8599;
            </a>
          </div>
        </div>

        <!-- Selected MCP Servers -->
        <div v-if="selectedMcpServers.length" class="selected-mcps">
          <div v-for="(mcp, idx) in selectedMcpServers" :key="mcp.id" class="selected-mcp-card">
            <div class="mcp-card-main">
              <div class="mcp-card-info">
                <strong>{{ mcp.name || mcp.id }}</strong>
                <span class="mcp-card-cat">{{ mcp.category || 'Custom' }}</span>
              </div>
              <p class="mcp-card-desc">{{ mcp.description || `${mcp.command} ${(mcp.args || []).join(' ')}` }}</p>
              <code class="mcp-card-cmd">{{ mcp.command }} {{ (mcp.args || []).join(' ') }}</code>
              <div v-if="mcp.env && Object.keys(mcp.env).length" class="mcp-card-env">
                <span v-for="(v, k) in mcp.env" :key="k" class="env-chip">{{ k }}={{ v }}</span>
              </div>
            </div>
            <button class="btn-icon btn-remove" @click="removeMcpServer(idx)" title="Remove">&times;</button>
          </div>
        </div>
        <p v-else class="mcp-empty">No MCP servers configured. Use AI Suggest, browse the registry, or add a custom server.</p>

        <!-- AI Suggestions -->
        <div v-if="mcpSuggestions.length" class="mcp-suggestions">
          <h5>AI Suggestions <span class="sug-source">powered by Bedrock + mcpservers.org ecosystem</span></h5>
          <div v-for="sug in mcpSuggestions" :key="sug.id" class="suggestion-card" :class="{ 'sug-added': isMcpSelected(sug.id) }">
            <div class="sug-main">
              <div class="sug-header">
                <strong>{{ sug.name || sug.id }}</strong>
                <span class="priority-badge" :class="`priority-${sug.priority}`">{{ sug.priority }}</span>
                <span v-if="sug.isCustom" class="source-badge source-web">ecosystem</span>
                <span v-else class="source-badge source-registry">registry</span>
              </div>
              <p class="sug-reason">{{ sug.reason }}</p>
              <code v-if="sug.command" class="sug-cmd">{{ sug.command }} {{ (sug.args || []).join(' ') }}</code>
            </div>
            <button
              v-if="!isMcpSelected(sug.id)"
              class="btn btn-sm btn-primary"
              @click="addSuggestion(sug)"
            >Add</button>
            <span v-else class="sug-check">&#10003;</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-state">Loading agents...</div>

    <!-- Error -->
    <div v-else-if="store.error" class="error-state card" style="padding:24px;text-align:center">
      <p class="error">{{ store.error }}</p>
      <button class="btn btn-primary btn-sm" @click="store.fetchAll()">Retry</button>
    </div>

    <template v-else>
      <!-- Default Agents -->
      <div class="section">
        <h2>Default Agents <span class="section-count">{{ store.defaultAgents.length }}</span></h2>
        <div class="agents-grid">
          <div v-for="agent in store.defaultAgents" :key="agent.aiAgentId" class="agent-card card">
            <div class="agent-card-header">
              <span class="category-badge" :class="categoryClass(agent.category)">{{ formatCategory(agent.category) }}</span>
              <span class="badge badge-success" style="font-size:0.65rem">Default</span>
            </div>
            <h4>{{ agent.name }}</h4>
            <p class="agent-desc">{{ agent.description }}</p>
            <div class="agent-meta">
              <span>Model: {{ agent.kiroConfig.model || 'default' }}</span>
              <span v-if="mcpCount(agent) > 0" class="mcp-badge" :title="mcpNames(agent)">MCP: {{ mcpCount(agent) }}</span>
            </div>
            <button class="btn btn-sm btn-secondary" @click="viewAgent(agent)" style="margin-top:8px">View Config</button>
          </div>
        </div>
      </div>

      <!-- Custom Agents -->
      <div class="section">
        <h2>Custom Agents <span class="section-count">{{ store.customAgents.length }}</span></h2>
        <div v-if="store.customAgents.length" class="agents-grid">
          <div v-for="agent in store.customAgents" :key="agent.aiAgentId" class="agent-card card">
            <div class="agent-card-header">
              <span class="category-badge" :class="categoryClass(agent.category)">{{ formatCategory(agent.category) }}</span>
            </div>
            <h4>{{ agent.name }}</h4>
            <p class="agent-desc">{{ agent.description }}</p>
            <div class="agent-meta">
              <span>Created {{ formatLocalDateTime(agent.createdAt) }}</span>
              <span v-if="mcpCount(agent) > 0" class="mcp-badge" :title="mcpNames(agent)">MCP: {{ mcpCount(agent) }}</span>
            </div>
            <div class="agent-actions">
              <button class="btn btn-sm btn-secondary" @click="viewAgent(agent)">View</button>
              <button class="btn btn-sm btn-accent" @click="editAgentMcp(agent)">Edit MCP</button>
              <button class="btn btn-sm btn-danger" @click="deleteAgent(agent)" :disabled="deleting === agent.aiAgentId">
                {{ deleting === agent.aiAgentId ? 'Deleting...' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>No custom agents yet. Use the form above to generate one from a prompt.</p>
        </div>
      </div>
    </template>

    <!-- View Config Modal -->
    <div v-if="viewingAgent" class="modal-overlay" @click.self="viewingAgent = null">
      <div class="modal-content card">
        <div class="modal-header">
          <h3>{{ viewingAgent.name }}</h3>
          <button class="btn-close" @click="viewingAgent = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="config-field">
            <label>Category</label>
            <span class="category-badge" :class="categoryClass(viewingAgent.category)">{{ formatCategory(viewingAgent.category) }}</span>
          </div>
          <div class="config-field">
            <label>Description</label>
            <p>{{ viewingAgent.description }}</p>
          </div>
          <div class="config-field">
            <label>System Prompt</label>
            <pre class="config-pre">{{ viewingAgent.kiroConfig.prompt }}</pre>
          </div>
          <div v-if="viewingAgent.kiroConfig.mcpServers && Object.keys(viewingAgent.kiroConfig.mcpServers).length" class="config-field">
            <label>MCP Servers</label>
            <div class="mcp-list">
              <div v-for="(cfg, name) in viewingAgent.kiroConfig.mcpServers" :key="name" class="mcp-item">
                <strong>{{ name }}</strong>
                <code>{{ cfg.command }} {{ (cfg.args || []).join(' ') }}</code>
                <span v-if="cfg.env" class="mcp-env">env: {{ Object.keys(cfg.env).join(', ') }}</span>
              </div>
            </div>
          </div>
          <div class="config-field">
            <label>Full Kiro Config</label>
            <pre class="config-pre">{{ JSON.stringify(viewingAgent.kiroConfig, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- MCP Registry Picker Modal -->
    <div v-if="showMcpPicker" class="modal-overlay" @click.self="showMcpPicker = false">
      <div class="modal-content card modal-wide">
        <div class="modal-header">
          <h3>MCP Server Registry</h3>
          <button class="btn-close" @click="showMcpPicker = false">&times;</button>
        </div>
        <div class="modal-body">
          <input
            v-model="registrySearch"
            class="registry-search"
            placeholder="Search MCP servers..."
          />
          <div class="registry-categories">
            <button
              v-for="cat in registryCategories"
              :key="cat"
              class="cat-filter-btn"
              :class="{ active: registryFilter === cat }"
              @click="registryFilter = registryFilter === cat ? '' : cat"
            >{{ cat }}</button>
          </div>
          <div class="registry-grid">
            <div
              v-for="entry in filteredRegistry"
              :key="entry.id"
              class="registry-card"
              :class="{ 'registry-selected': isMcpSelected(entry.id) }"
            >
              <div class="registry-card-top">
                <strong>{{ entry.name }}</strong>
                <span class="registry-cat">{{ entry.category }}</span>
              </div>
              <p class="registry-desc">{{ entry.description }}</p>
              <code class="registry-cmd">{{ entry.command }} {{ entry.args.join(' ') }}</code>
              <div class="registry-tools">
                <span v-for="t in entry.tools.slice(0, 4)" :key="t" class="tool-chip">{{ t }}</span>
                <span v-if="entry.tools.length > 4" class="tool-chip tool-more">+{{ entry.tools.length - 4 }}</span>
              </div>
              <button
                v-if="!isMcpSelected(entry.id)"
                class="btn btn-sm btn-primary registry-add-btn"
                @click="addFromRegistry(entry)"
              >Add to Agent</button>
              <span v-else class="registry-added">Added &#10003;</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Manual MCP Add Modal -->
    <div v-if="showManualMcp" class="modal-overlay" @click.self="showManualMcp = false">
      <div class="modal-content card">
        <div class="modal-header">
          <h3>Add Custom MCP Server</h3>
          <button class="btn-close" @click="showManualMcp = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Server ID <span class="req">*</span></label>
            <input v-model="manualMcp.id" class="form-input" placeholder="e.g., my-org.my-mcp-server" />
          </div>
          <div class="form-group">
            <label>Name</label>
            <input v-model="manualMcp.name" class="form-input" placeholder="e.g., My Custom Server" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <input v-model="manualMcp.description" class="form-input" placeholder="What does this MCP server do?" />
          </div>
          <div class="form-group">
            <label>Command <span class="req">*</span></label>
            <input v-model="manualMcp.command" class="form-input" placeholder="e.g., uvx, npx, node" />
          </div>
          <div class="form-group">
            <label>Arguments (one per line)</label>
            <textarea v-model="manualMcp.argsText" class="form-input" rows="2" placeholder="e.g., my-package@latest&#10;--flag" />
          </div>
          <div class="form-group">
            <label>Environment Variables (KEY=VALUE per line)</label>
            <textarea v-model="manualMcp.envText" class="form-input" rows="2" placeholder="e.g., LOG_LEVEL=ERROR&#10;MY_VAR=value" />
          </div>
          <div class="form-actions">
            <button class="btn btn-secondary" @click="showManualMcp = false">Cancel</button>
            <button class="btn btn-primary" @click="addManualMcp" :disabled="!manualMcp.id.trim() || !manualMcp.command.trim()">
              Add Server
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit MCP Modal for existing agent -->
    <div v-if="editingAgent" class="modal-overlay" @click.self="editingAgent = null">
      <div class="modal-content card modal-wide">
        <div class="modal-header">
          <h3>Edit MCP — {{ editingAgent.name }}</h3>
          <button class="btn-close" @click="editingAgent = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="edit-mcp-actions">
            <button
              class="btn btn-sm btn-accent"
              @click="suggestMcpForEdit"
              :disabled="suggestingMcpEdit"
              title="AI will suggest relevant MCP servers based on this agent's description"
            >{{ suggestingMcpEdit ? 'Suggesting...' : 'AI Suggest' }}</button>
            <button class="btn btn-sm btn-secondary" @click="showEditRegistry = true">Browse Registry</button>
            <button class="btn btn-sm btn-secondary" @click="showEditManual = true">Add Custom</button>
            <a href="https://mcpservers.org/" target="_blank" rel="noopener" class="btn btn-sm btn-outline" title="Discover 7000+ MCP servers">
              mcpservers.org &#8599;
            </a>
          </div>

          <!-- Current MCPs -->
          <div v-if="editMcpList.length" class="selected-mcps">
            <div v-for="(mcp, idx) in editMcpList" :key="mcp.id" class="selected-mcp-card">
              <div class="mcp-card-main">
                <div class="mcp-card-info">
                  <strong>{{ mcp.name || mcp.id }}</strong>
                  <span class="mcp-card-cat">{{ mcp.category || 'Custom' }}</span>
                </div>
                <p class="mcp-card-desc">{{ mcp.description || `${mcp.command} ${(mcp.args || []).join(' ')}` }}</p>
                <code class="mcp-card-cmd">{{ mcp.command }} {{ (mcp.args || []).join(' ') }}</code>
                <div v-if="mcp.env && Object.keys(mcp.env).length" class="mcp-card-env">
                  <span v-for="(v, k) in mcp.env" :key="k" class="env-chip">{{ k }}={{ v }}</span>
                </div>
              </div>
              <button class="btn-icon btn-remove" @click="editMcpList.splice(idx, 1)" title="Remove">&times;</button>
            </div>
          </div>
          <p v-else class="mcp-empty">No MCP servers configured. Use AI Suggest, browse the registry, or add a custom server.</p>

          <!-- Edit suggestions -->
          <div v-if="editMcpSuggestions.length" class="mcp-suggestions">
            <h5>AI Suggestions <span class="sug-source">powered by Bedrock + mcpservers.org ecosystem</span></h5>
            <div v-for="sug in editMcpSuggestions" :key="sug.id" class="suggestion-card" :class="{ 'sug-added': editMcpList.some(m => m.id === sug.id) }">
              <div class="sug-main">
                <div class="sug-header">
                  <strong>{{ sug.name || sug.id }}</strong>
                  <span class="priority-badge" :class="`priority-${sug.priority}`">{{ sug.priority }}</span>
                  <span v-if="sug.isCustom" class="source-badge source-web">ecosystem</span>
                  <span v-else class="source-badge source-registry">registry</span>
                </div>
                <p class="sug-reason">{{ sug.reason }}</p>
                <code v-if="sug.command" class="sug-cmd">{{ sug.command }} {{ (sug.args || []).join(' ') }}</code>
              </div>
              <button
                v-if="!editMcpList.some(m => m.id === sug.id)"
                class="btn btn-sm btn-primary"
                @click="addSuggestionToEdit(sug)"
              >Add</button>
              <span v-else class="sug-check">&#10003;</span>
            </div>
          </div>

          <div class="form-actions" style="margin-top:16px">
            <button class="btn btn-secondary" @click="editingAgent = null">Cancel</button>
            <button class="btn btn-primary" @click="saveEditMcp" :disabled="savingMcp">
              {{ savingMcp ? 'Saving...' : 'Save MCP Config' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Registry sub-modal -->
    <div v-if="showEditRegistry" class="modal-overlay" @click.self="showEditRegistry = false" style="z-index:1100">
      <div class="modal-content card modal-wide">
        <div class="modal-header">
          <h3>MCP Server Registry</h3>
          <button class="btn-close" @click="showEditRegistry = false">&times;</button>
        </div>
        <div class="modal-body">
          <input v-model="editRegistrySearch" class="registry-search" placeholder="Search MCP servers..." />
          <div class="registry-categories">
            <button
              v-for="cat in editRegistryCategories"
              :key="cat"
              class="cat-filter-btn"
              :class="{ active: editRegistryFilter === cat }"
              @click="editRegistryFilter = editRegistryFilter === cat ? '' : cat"
            >{{ cat }}</button>
          </div>
          <div class="registry-grid">
            <div v-for="entry in filteredEditRegistry" :key="entry.id" class="registry-card" :class="{ 'registry-selected': editMcpList.some(m => m.id === entry.id) }">
              <div class="registry-card-top">
                <strong>{{ entry.name }}</strong>
                <span class="registry-cat">{{ entry.category }}</span>
              </div>
              <p class="registry-desc">{{ entry.description }}</p>
              <code class="registry-cmd">{{ entry.command }} {{ entry.args.join(' ') }}</code>
              <div class="registry-tools">
                <span v-for="t in (entry.tools || []).slice(0, 4)" :key="t" class="tool-chip">{{ t }}</span>
                <span v-if="(entry.tools || []).length > 4" class="tool-chip tool-more">+{{ entry.tools.length - 4 }}</span>
              </div>
              <button
                v-if="!editMcpList.some(m => m.id === entry.id)"
                class="btn btn-sm btn-primary registry-add-btn"
                @click="addRegistryToEdit(entry)"
              >Add to Agent</button>
              <span v-else class="registry-added">Added &#10003;</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Manual sub-modal -->
    <div v-if="showEditManual" class="modal-overlay" @click.self="showEditManual = false" style="z-index:1100">
      <div class="modal-content card">
        <div class="modal-header">
          <h3>Add Custom MCP Server</h3>
          <button class="btn-close" @click="showEditManual = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Server ID <span class="req">*</span></label>
            <input v-model="editManualMcp.id" class="form-input" placeholder="e.g., my-org.my-mcp-server" />
          </div>
          <div class="form-group">
            <label>Name</label>
            <input v-model="editManualMcp.name" class="form-input" placeholder="e.g., My Custom Server" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <input v-model="editManualMcp.description" class="form-input" placeholder="What does this MCP server do?" />
          </div>
          <div class="form-group">
            <label>Command <span class="req">*</span></label>
            <input v-model="editManualMcp.command" class="form-input" placeholder="e.g., uvx, npx, node" />
          </div>
          <div class="form-group">
            <label>Arguments (one per line)</label>
            <textarea v-model="editManualMcp.argsText" class="form-input" rows="2" placeholder="e.g., my-package@latest&#10;--flag" />
          </div>
          <div class="form-group">
            <label>Environment Variables (KEY=VALUE per line)</label>
            <textarea v-model="editManualMcp.envText" class="form-input" rows="2" placeholder="e.g., LOG_LEVEL=ERROR&#10;MY_VAR=value" />
          </div>
          <div class="form-actions">
            <button class="btn btn-secondary" @click="showEditManual = false">Cancel</button>
            <button class="btn btn-primary" @click="addManualToEdit" :disabled="!editManualMcp.id.trim() || !editManualMcp.command.trim()">
              Add Server
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue";
import { useAIAgentsStore } from "../stores";
import { aiAgents as aiAgentApi } from "../api";
import type { McpRegistryEntry, McpSuggestion } from "../api";
import type { AIAgentConfig, AIAgentCategory, KiroMcpServerEntry } from "@remote-kiro/common";
import { formatLocalDateTime } from "../format-date";

interface SelectedMcp {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const store = useAIAgentsStore();
const createPrompt = ref("");
const createCategory = ref<AIAgentCategory>("custom");
const generating = ref(false);
const refining = ref(false);
const deleting = ref<string | null>(null);
const viewingAgent = ref<AIAgentConfig | null>(null);

// MCP state for create form
const selectedMcpServers = ref<SelectedMcp[]>([]);
const mcpSuggestions = ref<McpSuggestion[]>([]);
const suggestingMcp = ref(false);
const showMcpPicker = ref(false);
const showManualMcp = ref(false);
const registrySearch = ref("");
const registryFilter = ref("");
const mcpRegistry = ref<McpRegistryEntry[]>([]);

const manualMcp = reactive({
  id: "", name: "", description: "", command: "", argsText: "", envText: "",
});

// MCP edit state
const editingAgent = ref<AIAgentConfig | null>(null);
const editMcpList = ref<SelectedMcp[]>([]);
const editMcpSuggestions = ref<McpSuggestion[]>([]);
const suggestingMcpEdit = ref(false);
const savingMcp = ref(false);
const showEditRegistry = ref(false);
const showEditManual = ref(false);
const editRegistrySearch = ref("");
const editRegistryFilter = ref("");
const editManualMcp = reactive({ id: "", name: "", description: "", command: "", argsText: "", envText: "" });

const registryCategories = computed(() => {
  const cats = new Set(mcpRegistry.value.map((e) => e.category));
  return Array.from(cats).sort();
});

const filteredRegistry = computed(() => {
  let entries = mcpRegistry.value;
  if (registryFilter.value) {
    entries = entries.filter((e) => e.category === registryFilter.value);
  }
  if (registrySearch.value.trim()) {
    const q = registrySearch.value.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    );
  }
  return entries;
});

const editRegistryCategories = computed(() => {
  const cats = new Set(mcpRegistry.value.map((e) => e.category));
  return Array.from(cats).sort();
});

const filteredEditRegistry = computed(() => {
  let entries = mcpRegistry.value;
  if (editRegistryFilter.value) {
    entries = entries.filter((e) => e.category === editRegistryFilter.value);
  }
  if (editRegistrySearch.value.trim()) {
    const q = editRegistrySearch.value.toLowerCase();
    entries = entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q),
    );
  }
  return entries;
});

onMounted(async () => {
  store.fetchAll();
  try {
    mcpRegistry.value = await aiAgentApi.mcpRegistry();
  } catch {
    // Registry will be populated from suggest call if direct fetch fails
  }
});

function isMcpSelected(id: string): boolean {
  return selectedMcpServers.value.some((m) => m.id === id);
}

function removeMcpServer(idx: number) {
  selectedMcpServers.value.splice(idx, 1);
}

function addFromRegistry(entry: McpRegistryEntry) {
  if (isMcpSelected(entry.id)) return;
  selectedMcpServers.value.push({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    command: entry.command,
    args: entry.args,
    env: entry.env,
  });
}

function addSuggestion(sug: McpSuggestion) {
  if (isMcpSelected(sug.id)) return;
  const registry = mcpRegistry.value.find((r) => r.id === sug.id);
  if (registry) {
    addFromRegistry(registry);
  } else if (sug.command) {
    selectedMcpServers.value.push({
      id: sug.id,
      name: sug.name,
      description: sug.description,
      category: sug.category,
      command: sug.command,
      args: sug.args,
      env: sug.env,
    });
  }
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return env;
}

function addManualMcp() {
  if (!manualMcp.id.trim() || !manualMcp.command.trim()) return;
  const args = manualMcp.argsText.split("\n").map((a) => a.trim()).filter(Boolean);
  const env = parseEnv(manualMcp.envText);
  selectedMcpServers.value.push({
    id: manualMcp.id.trim(),
    name: manualMcp.name.trim() || undefined,
    description: manualMcp.description.trim() || undefined,
    command: manualMcp.command.trim(),
    args: args.length ? args : undefined,
    env: Object.keys(env).length ? env : undefined,
  });
  Object.assign(manualMcp, { id: "", name: "", description: "", command: "", argsText: "", envText: "" });
  showManualMcp.value = false;
}

async function suggestMcpServers() {
  if (!createPrompt.value.trim()) return;
  suggestingMcp.value = true;
  mcpSuggestions.value = [];
  try {
    const currentIds = selectedMcpServers.value.map((m) => m.id);
    const result = await aiAgentApi.suggestMcp(createPrompt.value, createCategory.value, currentIds);
    mcpSuggestions.value = result.suggestions;
    if (result.registry?.length) {
      mcpRegistry.value = result.registry;
    }
  } catch (err) {
    alert(`Failed to get suggestions: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    suggestingMcp.value = false;
  }
}

function buildMcpServersConfig(): Record<string, KiroMcpServerEntry> | undefined {
  if (!selectedMcpServers.value.length) return undefined;
  const servers: Record<string, KiroMcpServerEntry> = {};
  for (const mcp of selectedMcpServers.value) {
    servers[mcp.id] = {
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
    };
  }
  return servers;
}

function buildAllowedToolsWithMcp(base: string[]): string[] {
  const tools = [...base];
  for (const mcp of selectedMcpServers.value) {
    const toolRef = `@${mcp.id}`;
    if (!tools.includes(toolRef)) tools.push(toolRef);
  }
  return tools;
}

async function generateAgent() {
  if (!createPrompt.value.trim()) return;
  generating.value = true;
  try {
    const agent = await store.generate(createPrompt.value, createCategory.value);
    // Patch MCP servers if the user configured any
    const mcpServers = buildMcpServersConfig();
    if (mcpServers && agent.aiAgentId) {
      const updatedConfig = {
        ...agent.kiroConfig,
        mcpServers,
        allowedTools: buildAllowedToolsWithMcp(agent.kiroConfig.allowedTools || ["read", "write", "shell"]),
      };
      await store.update(agent.aiAgentId, { kiroConfig: updatedConfig });
    }
    createPrompt.value = "";
    selectedMcpServers.value = [];
    mcpSuggestions.value = [];
  } catch (err) {
    alert(`Failed to generate agent: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    generating.value = false;
  }
}

async function refinePrompt() {
  if (!createPrompt.value.trim()) return;
  refining.value = true;
  try {
    const result = await aiAgentApi.refinePrompt(createPrompt.value);
    createPrompt.value = result.refined;
  } catch (err) {
    alert(`Failed to refine prompt: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    refining.value = false;
  }
}

async function deleteAgent(agent: AIAgentConfig) {
  if (!confirm(`Delete agent "${agent.name}"?`)) return;
  deleting.value = agent.aiAgentId;
  try {
    await store.remove(agent.aiAgentId);
  } catch (err) {
    alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    deleting.value = null;
  }
}

function viewAgent(agent: AIAgentConfig) {
  viewingAgent.value = agent;
}

// ─── Edit MCP for existing agent ───

function editAgentMcp(agent: AIAgentConfig) {
  editingAgent.value = agent;
  editMcpSuggestions.value = [];
  const mcpServers = agent.kiroConfig.mcpServers || {};
  editMcpList.value = Object.entries(mcpServers).map(([id, cfg]) => {
    const reg = mcpRegistry.value.find((r) => r.id === id);
    return {
      id,
      name: reg?.name,
      description: reg?.description,
      category: reg?.category,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
    };
  });
}

async function suggestMcpForEdit() {
  if (!editingAgent.value) return;
  suggestingMcpEdit.value = true;
  editMcpSuggestions.value = [];
  try {
    const currentIds = editMcpList.value.map((m) => m.id);
    const result = await aiAgentApi.suggestMcp(
      editingAgent.value.description,
      editingAgent.value.category,
      currentIds,
    );
    editMcpSuggestions.value = result.suggestions;
    if (result.registry?.length) mcpRegistry.value = result.registry;
  } catch (err) {
    alert(`Failed to get suggestions: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    suggestingMcpEdit.value = false;
  }
}

function addSuggestionToEdit(sug: McpSuggestion) {
  if (editMcpList.value.some((m) => m.id === sug.id)) return;
  const reg = mcpRegistry.value.find((r) => r.id === sug.id);
  if (reg) {
    editMcpList.value.push({
      id: reg.id, name: reg.name, description: reg.description,
      category: reg.category, command: reg.command, args: reg.args, env: reg.env,
    });
  } else if (sug.command) {
    editMcpList.value.push({
      id: sug.id, name: sug.name, description: sug.description,
      command: sug.command, args: sug.args, env: sug.env,
    });
  }
}

function addRegistryToEdit(entry: McpRegistryEntry) {
  if (editMcpList.value.some((m) => m.id === entry.id)) return;
  editMcpList.value.push({
    id: entry.id, name: entry.name, description: entry.description,
    category: entry.category, command: entry.command, args: entry.args, env: entry.env,
  });
}

function addManualToEdit() {
  if (!editManualMcp.id.trim() || !editManualMcp.command.trim()) return;
  const args = editManualMcp.argsText.split("\n").map((a) => a.trim()).filter(Boolean);
  const env = parseEnv(editManualMcp.envText);
  editMcpList.value.push({
    id: editManualMcp.id.trim(),
    name: editManualMcp.name.trim() || undefined,
    description: editManualMcp.description.trim() || undefined,
    command: editManualMcp.command.trim(),
    args: args.length ? args : undefined,
    env: Object.keys(env).length ? env : undefined,
  });
  Object.assign(editManualMcp, { id: "", name: "", description: "", command: "", argsText: "", envText: "" });
  showEditManual.value = false;
}

async function saveEditMcp() {
  if (!editingAgent.value) return;
  savingMcp.value = true;
  try {
    const mcpServers: Record<string, KiroMcpServerEntry> = {};
    for (const mcp of editMcpList.value) {
      mcpServers[mcp.id] = { command: mcp.command, args: mcp.args, env: mcp.env };
    }
    const allowedTools = [...(editingAgent.value.kiroConfig.allowedTools || ["read", "write", "shell"])];
    for (const mcp of editMcpList.value) {
      const toolRef = `@${mcp.id}`;
      if (!allowedTools.includes(toolRef)) allowedTools.push(toolRef);
    }
    const filtered = allowedTools.filter((t) => {
      if (!t.startsWith("@")) return true;
      const id = t.slice(1);
      return editMcpList.value.some((m) => m.id === id);
    });
    const updatedConfig = {
      ...editingAgent.value.kiroConfig,
      mcpServers: Object.keys(mcpServers).length ? mcpServers : undefined,
      allowedTools: filtered,
    };
    await store.update(editingAgent.value.aiAgentId, { kiroConfig: updatedConfig });
    editingAgent.value = null;
  } catch (err) {
    alert(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    savingMcp.value = false;
  }
}

// ─── Helpers ───

function formatCategory(cat: string): string {
  const map: Record<string, string> = {
    ui_frontend: "UI / Frontend", backend: "Backend", python: "Python",
    aws_serverless: "AWS Serverless", fullstack: "Full Stack",
    code_review: "Code Review", security_review: "Security Review", custom: "Custom",
  };
  return map[cat] || cat;
}

function mcpCount(agent: AIAgentConfig): number {
  return agent.kiroConfig.mcpServers ? Object.keys(agent.kiroConfig.mcpServers).length : 0;
}

function mcpNames(agent: AIAgentConfig): string {
  if (!agent.kiroConfig.mcpServers) return "";
  return Object.keys(agent.kiroConfig.mcpServers).join(", ");
}

function categoryClass(cat: string): string {
  const map: Record<string, string> = {
    ui_frontend: "cat-frontend", backend: "cat-backend", python: "cat-python",
    aws_serverless: "cat-aws", fullstack: "cat-fullstack",
    code_review: "cat-review", security_review: "cat-security", custom: "cat-custom",
  };
  return map[cat] || "cat-custom";
}
</script>

<style scoped>
.create-panel { padding: 20px; margin-bottom: 24px; }
.create-panel h3 { margin: 0 0 4px; font-size: 1rem; }
.hint { color: var(--color-text-secondary, #64748b); font-size: 0.82rem; margin-bottom: 12px; }
.create-form { display: flex; flex-direction: column; gap: 10px; }
.prompt-input {
  width: 100%; padding: 10px 12px; border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px; font-size: 0.85rem; font-family: inherit; resize: vertical; background: #fff;
}
.prompt-input:focus { outline: none; border-color: var(--color-primary, #4f46e5); box-shadow: 0 0 0 2px rgba(79,70,229,0.1); }
.form-row-inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter-select {
  padding: 6px 28px 6px 10px; border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px; font-size: 0.8rem; background: #fff; appearance: auto; min-width: 140px;
}

/* MCP Config Section */
.mcp-config-section {
  margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--color-border, #e2e8f0);
}
.mcp-config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.mcp-config-header h4 { margin: 0; font-size: 0.92rem; display: flex; align-items: center; gap: 6px; }
.mcp-icon { font-size: 1.1rem; }
.mcp-count {
  background: var(--color-primary, #4f46e5); color: #fff; border-radius: 10px;
  padding: 1px 8px; font-size: 0.7rem; font-weight: 700;
}
.mcp-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.mcp-empty { font-size: 0.8rem; color: var(--color-text-secondary, #94a3b8); font-style: italic; margin: 8px 0; }

.selected-mcps { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.selected-mcp-card {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 12px;
}
.mcp-card-main { flex: 1; min-width: 0; }
.mcp-card-info { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.mcp-card-info strong { font-size: 0.85rem; }
.mcp-card-cat { font-size: 0.65rem; color: #64748b; background: #e2e8f0; padding: 1px 6px; border-radius: 3px; }
.mcp-card-desc { font-size: 0.78rem; color: #475569; margin: 2px 0; }
.mcp-card-cmd { font-size: 0.72rem; color: #64748b; font-family: 'SF Mono', monospace; }
.mcp-card-env { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.env-chip { font-size: 0.65rem; background: #e0e7ff; color: #3730a3; padding: 1px 5px; border-radius: 3px; font-family: monospace; }

.btn-icon { background: none; border: none; cursor: pointer; font-size: 1.2rem; padding: 2px 6px; line-height: 1; }
.btn-remove { color: #ef4444; }
.btn-remove:hover { color: #dc2626; }

/* Suggestions */
.mcp-suggestions { margin-top: 12px; }
.mcp-suggestions h5 { margin: 0 0 8px; font-size: 0.82rem; color: var(--color-text-secondary); }
.suggestion-card {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 6px;
  transition: background 0.15s;
}
.suggestion-card:hover { background: #f8fafc; }
.suggestion-card.sug-added { background: #f0fdf4; border-color: #86efac; }
.sug-main { flex: 1; min-width: 0; }
.sug-header { display: flex; align-items: center; gap: 8px; }
.sug-header strong { font-size: 0.82rem; }
.sug-reason { font-size: 0.75rem; color: #64748b; margin: 2px 0 0; }
.sug-check { color: #22c55e; font-weight: bold; font-size: 1.1rem; }
.priority-badge { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; }
.priority-high { background: #fecaca; color: #991b1b; }
.priority-medium { background: #fed7aa; color: #9a3412; }
.priority-low { background: #e0e7ff; color: #3730a3; }

/* Registry */
.registry-search {
  width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.85rem; margin-bottom: 10px; background: #fff;
}
.registry-categories { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.cat-filter-btn {
  padding: 3px 10px; border: 1px solid #e2e8f0; border-radius: 12px;
  font-size: 0.72rem; cursor: pointer; background: #fff; transition: all 0.15s;
}
.cat-filter-btn:hover { border-color: #a5b4fc; }
.cat-filter-btn.active { background: var(--color-primary, #4f46e5); color: #fff; border-color: var(--color-primary, #4f46e5); }
.registry-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.registry-card {
  border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; display: flex;
  flex-direction: column; gap: 4px; transition: border-color 0.15s;
}
.registry-card:hover { border-color: #a5b4fc; }
.registry-card.registry-selected { background: #f0fdf4; border-color: #86efac; }
.registry-card-top { display: flex; justify-content: space-between; align-items: center; }
.registry-card-top strong { font-size: 0.82rem; }
.registry-cat { font-size: 0.62rem; background: #f1f5f9; color: #64748b; padding: 1px 6px; border-radius: 3px; }
.registry-desc { font-size: 0.75rem; color: #64748b; margin: 0; line-height: 1.3; }
.registry-cmd { font-size: 0.68rem; color: #94a3b8; font-family: monospace; }
.registry-tools { display: flex; flex-wrap: wrap; gap: 3px; }
.tool-chip { font-size: 0.6rem; background: #ede9fe; color: #5b21b6; padding: 1px 5px; border-radius: 3px; }
.tool-more { background: #f1f5f9; color: #64748b; }
.registry-add-btn { margin-top: 4px; align-self: flex-start; }
.registry-added { color: #22c55e; font-size: 0.8rem; font-weight: 600; }
.modal-wide { max-width: 900px; }

/* Form groups */
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 0.78rem; font-weight: 600; margin-bottom: 4px; color: #334155; }
.form-input {
  width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px;
  font-size: 0.82rem; font-family: inherit; background: #fff;
}
.form-input:focus { outline: none; border-color: var(--color-primary, #4f46e5); }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; }
.req { color: #ef4444; }

.edit-mcp-actions { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }

/* Sections */
.section { margin-bottom: 28px; }
.section h2 { margin: 0 0 12px; font-size: 1.1rem; }
.section-count { font-size: 0.8rem; font-weight: 400; color: var(--color-text-secondary, #64748b); }
.agents-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.agent-card { padding: 16px; display: flex; flex-direction: column; gap: 6px; }
.agent-card h4 { margin: 0; font-size: 0.95rem; }
.agent-card-header { display: flex; justify-content: space-between; align-items: center; }
.agent-desc {
  font-size: 0.82rem; color: var(--color-text-secondary, #64748b); margin: 0; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.agent-meta { font-size: 0.72rem; color: var(--color-text-tertiary, #9ca3af); }
.agent-actions { display: flex; gap: 6px; margin-top: 8px; }

.category-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
}
.cat-frontend { background: #dbeafe; color: #1e40af; }
.cat-backend { background: #dcfce7; color: #166534; }
.cat-python { background: #fef3c7; color: #92400e; }
.cat-aws { background: #fce7f3; color: #9d174d; }
.cat-fullstack { background: #e0e7ff; color: #3730a3; }
.cat-review { background: #f3e8ff; color: #6b21a8; }
.cat-security { background: #fee2e2; color: #991b1b; }
.cat-custom { background: #f1f5f9; color: #475569; }

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 24px;
}
.modal-content { width: 100%; max-width: 700px; max-height: 80vh; overflow-y: auto; padding: 24px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-header h3 { margin: 0; }
.btn-close { background: none; border: none; font-size: 1.4rem; cursor: pointer; color: var(--color-text-secondary); padding: 4px 8px; }
.config-field { margin-bottom: 14px; }
.config-field label {
  display: block; font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--color-text-secondary, #64748b); margin-bottom: 4px;
}
.config-pre {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px;
  font-size: 0.78rem; font-family: 'SF Mono', 'Fira Code', monospace;
  white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto;
}
.mcp-badge {
  display: inline-block; padding: 1px 6px; border-radius: 4px;
  font-size: 0.65rem; font-weight: 600; background: #dbeafe; color: #1e40af; margin-left: 6px;
}
.mcp-list { display: flex; flex-direction: column; gap: 8px; }
.mcp-item {
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px;
  font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px;
}
.mcp-item strong { font-size: 0.82rem; }
.mcp-item code { font-family: 'SF Mono', monospace; font-size: 0.75rem; color: #475569; }
.mcp-env { font-size: 0.7rem; color: #94a3b8; }

.btn-accent { background: #8b5cf6; color: #fff; border: none; border-radius: 6px; }
.btn-accent:hover { background: #7c3aed; }
.btn-accent:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-outline {
  background: transparent; color: #64748b; border: 1px solid #e2e8f0; border-radius: 6px;
  text-decoration: none; display: inline-flex; align-items: center; font-size: 0.78rem;
}
.btn-outline:hover { border-color: #8b5cf6; color: #8b5cf6; }
.btn-danger { background: #ef4444; color: #fff; border: none; }
.btn-danger:hover { background: #dc2626; }

.sug-source { font-size: 0.65rem; font-weight: 400; color: #94a3b8; margin-left: 6px; }
.sug-cmd { font-size: 0.68rem; color: #94a3b8; font-family: 'SF Mono', monospace; display: block; margin-top: 2px; }
.source-badge {
  font-size: 0.58rem; font-weight: 600; text-transform: uppercase; padding: 1px 5px;
  border-radius: 3px; letter-spacing: 0.3px;
}
.source-registry { background: #dbeafe; color: #1e40af; }
.source-web { background: #fef3c7; color: #92400e; }
</style>
