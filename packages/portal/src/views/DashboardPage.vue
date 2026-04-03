<template>
  <div class="dashboard-page">
    <div class="page-header">
      <h1>Dashboard</h1>
      <p>Overview of your remote agent jobs and infrastructure.</p>
    </div>

    <!-- Tabs -->
    <div class="dashboard-tabs">
      <button
        class="dashboard-tab"
        :class="{ active: activeTab === 'jobs' }"
        @click="activeTab = 'jobs'"
      >
        Jobs
        <span v-if="!initialLoading" class="tab-count">{{ jobsStore.jobs.length }}</span>
      </button>
      <button
        class="dashboard-tab"
        :class="{ active: activeTab === 'agents' }"
        @click="activeTab = 'agents'"
      >
        Remote Agents
        <span class="tab-count" :class="{ 'count-online': agentsStore.onlineAgents.length > 0, 'count-offline': agentsStore.onlineAgents.length === 0 }">
          {{ agentsStore.onlineAgents.length }} / {{ agentsStore.agents.length }}
        </span>
      </button>
    </div>

    <!-- Jobs Tab -->
    <div v-if="activeTab === 'jobs'">
      <div v-if="initialLoading" class="loading-state">Loading jobs...</div>
      <template v-else>
        <div class="status-summary">
          <div
            v-for="(count, status) in jobsStore.jobCountsByStatus"
            :key="status"
            class="status-card"
            :class="{ 'status-card-active': filterStatus === String(status) }"
            @click="toggleStatusFilter(String(status))"
            style="cursor:pointer"
          >
            <StatusChip :status="String(status)" />
            <span class="count">{{ count }}</span>
          </div>
        </div>

        <!-- Filters Row -->
        <div class="filters-row">
          <div class="filter-group">
            <label>Repository</label>
            <select v-model="filterRepo" class="filter-select">
              <option value="">All Repos</option>
              <option v-for="r in uniqueRepos" :key="r" :value="r">{{ resolveRepoName(r) }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Status</label>
            <select v-model="filterStatus" class="filter-select">
              <option value="">All Statuses</option>
              <option v-for="s in uniqueStatuses" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Type</label>
            <select v-model="filterType" class="filter-select">
              <option value="">All Types</option>
              <option v-for="t in uniqueTypes" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="filter-group" style="align-self:flex-end">
            <label>View</label>
            <div class="view-toggle">
              <button class="view-toggle-btn" :class="{ active: treeView }" @click="treeView = true" title="Tree View">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M15 6a9 9 0 0 0-9 9"/><path d="M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M15 18H9"/></svg>
              </button>
              <button class="view-toggle-btn" :class="{ active: !treeView }" @click="treeView = false" title="Flat View">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
            </div>
          </div>
          <button v-if="filterRepo || filterStatus || filterType" class="btn-sm btn-secondary filter-clear" @click="filterRepo = ''; filterStatus = ''; filterType = ''">
            Clear Filters
          </button>
        </div>

        <div class="section-header">
          <h2 style="margin:0">Recent Jobs <span v-if="filteredJobs.length !== jobsStore.jobs.length" class="filter-count">({{ filteredJobs.length }} of {{ jobsStore.jobs.length }})</span></h2>
          <router-link :to="{ name: 'job-create' }" class="btn btn-primary" style="font-size:0.8rem;padding:8px 16px;text-decoration:none;color:#fff">
            + New Job
          </router-link>
        </div>

        <table v-if="filteredJobs.length" class="jobs-table">
          <thead>
            <tr>
              <th v-if="treeView" style="width:20px"></th>
              <th>Job ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Repository</th>
              <th>Description</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="node in displayJobs" :key="node.job.jobId">
              <tr :class="{ 'job-row-child': node.isChild }">
                <td v-if="treeView" class="tree-toggle-cell">
                  <button
                    v-if="node.children && node.children.length"
                    class="tree-toggle-btn"
                    @click="toggleTreeNode(node.job.jobId)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                      :style="{ transform: expandedNodes[node.job.jobId] ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </button>
                  <span v-else-if="node.isChild" class="tree-branch-icon">&#x2514;</span>
                </td>
                <td>
                  <router-link :to="{ name: 'job-detail', params: { jobId: node.job.jobId } }">
                    <code class="mono">{{ node.job.jobId.slice(0, 8) }}</code>
                  </router-link>
                </td>
                <td>
                  <span class="badge" :class="jobTypeBadgeClass(node.job.jobType)">{{ formatJobType(node.job.jobType) }}</span>
                </td>
                <td><StatusChip :status="node.job.status" /></td>
                <td>
                  <span class="repo-chip" :title="node.job.repoId">{{ resolveRepoName(node.job.repoId) }}</span>
                </td>
                <td>
                  {{ node.job.title || node.job.description.slice(0, 60) }}
                  <span v-if="node.job.specPhase && node.job.status === 'AWAITING_APPROVAL'" class="badge badge-warning" style="margin-left:6px">
                    {{ node.job.specPhase }}
                  </span>
                  <span v-if="treeView && node.children && node.children.length" class="badge badge-neutral" style="margin-left:6px;font-size:0.65rem">
                    {{ node.children.length }} sub-job{{ node.children.length > 1 ? 's' : '' }}
                  </span>
                </td>
                <td class="mono" :title="formatLocalDateTime(node.job.createdAt)">{{ fmtRelative(node.job.createdAt) }} <span class="time-local">{{ formatLocalDateTime(node.job.createdAt) }}</span></td>
              </tr>
              <!-- Expanded children rows -->
              <template v-if="treeView && node.children && expandedNodes[node.job.jobId]">
                <tr v-for="child in node.children" :key="child.jobId" class="job-row-child">
                  <td class="tree-toggle-cell"><span class="tree-branch-icon">&#x2514;</span></td>
                  <td>
                    <router-link :to="{ name: 'job-detail', params: { jobId: child.jobId } }">
                      <code class="mono">{{ child.jobId.slice(0, 8) }}</code>
                    </router-link>
                  </td>
                  <td>
                    <span class="badge" :class="jobTypeBadgeClass(child.jobType)">{{ formatJobType(child.jobType) }}</span>
                  </td>
                  <td><StatusChip :status="child.status" /></td>
                  <td>
                    <span class="repo-chip" :title="child.repoId">{{ resolveRepoName(child.repoId) }}</span>
                  </td>
                  <td>{{ child.title || child.description.slice(0, 60) }}</td>
                  <td class="mono" :title="formatLocalDateTime(child.createdAt)">{{ fmtRelative(child.createdAt) }} <span class="time-local">{{ formatLocalDateTime(child.createdAt) }}</span></td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
        <div v-else class="empty-state">No jobs found. Create a new job to get started.</div>
      </template>
    </div>

    <!-- Remote Agents Tab -->
    <div v-if="activeTab === 'agents'">
      <div v-if="agentsStore.loading" class="loading-state">Loading remote agents...</div>
      <div v-else-if="agentsStore.error" class="error-state card" style="padding:24px;text-align:center">
        <p class="error" style="font-size:0.9rem;margin-bottom:12px">{{ agentsStore.error }}</p>
        <button class="btn btn-primary btn-sm" @click="agentsStore.fetchAll()">Retry</button>
      </div>
      <template v-else>
        <!-- Agent Summary -->
        <div class="agent-summary">
          <div class="agent-summary-card summary-online">
            <div class="summary-icon">&#9679;</div>
            <div>
              <div class="summary-count">{{ agentsStore.onlineAgents.length }}</div>
              <div class="summary-label">Online</div>
            </div>
          </div>
          <div class="agent-summary-card summary-offline">
            <div class="summary-icon">&#9679;</div>
            <div>
              <div class="summary-count">{{ agentsStore.offlineAgents.length }}</div>
              <div class="summary-label">Offline</div>
            </div>
          </div>
          <div class="agent-summary-card summary-total">
            <div class="summary-icon">&#9632;</div>
            <div>
              <div class="summary-count">{{ agentsStore.agents.length }}</div>
              <div class="summary-label">Total Remote Agents</div>
            </div>
          </div>
          <div class="agent-summary-card summary-jobs">
            <div class="summary-icon">&#9654;</div>
            <div>
              <div class="summary-count">{{ totalRunningJobs }}</div>
              <div class="summary-label">Running Jobs</div>
            </div>
          </div>
        </div>

        <!-- Agent Cards -->
        <div v-if="agentsStore.agents.length" class="agent-cards">
          <div
            v-for="agent in agentsStore.agents"
            :key="agent.agentId"
            class="agent-card card"
            :class="{ 'agent-online': agentsStore.isOnline(agent), 'agent-offline': !agentsStore.isOnline(agent) }"
          >
            <div class="agent-card-header">
              <div class="agent-status-dot" :class="agentsStore.isOnline(agent) ? 'dot-online' : 'dot-offline'"></div>
              <div class="agent-card-title">
                <h3>{{ agent.machineLabel }}</h3>
                <code class="mono">{{ agent.agentId }}</code>
              </div>
              <span class="badge" :class="agentsStore.isOnline(agent) ? 'badge-success' : 'badge-neutral'">
                {{ agentsStore.isOnline(agent) ? 'Online' : 'Offline' }}
              </span>
            </div>

            <!-- Machine Info -->
            <div class="agent-machine-info" v-if="agent.machine">
              <div class="machine-row">
                <span class="machine-label">Host</span>
                <span class="machine-value">{{ agent.machine.hostname }}</span>
              </div>
              <div class="machine-row">
                <span class="machine-label">OS / Arch</span>
                <span class="machine-value">{{ agent.machine.os }} / {{ agent.machine.arch }}</span>
              </div>
              <div class="machine-row">
                <span class="machine-label">CPU / Memory</span>
                <span class="machine-value">{{ agent.machine.cpuCores }} cores / {{ agent.machine.memoryGB }} GB</span>
              </div>
              <div class="machine-row" v-if="agent.machine.ipAddress">
                <span class="machine-label">IP Address</span>
                <span class="machine-value mono">{{ agent.machine.ipAddress }}</span>
              </div>
              <div class="machine-row" v-if="agent.machine.nodeVersion">
                <span class="machine-label">Node.js</span>
                <span class="machine-value">{{ agent.machine.nodeVersion }}</span>
              </div>
            </div>
            <div v-else class="agent-machine-info">
              <p style="color:var(--color-text-tertiary);font-size:0.8rem;font-style:italic">Machine info not reported</p>
            </div>

            <!-- Agent Details -->
            <div class="agent-details">
              <div class="machine-row">
                <span class="machine-label">Workspace</span>
                <span class="machine-value mono" style="font-size:0.75rem">{{ agent.workspaceRoot }}</span>
              </div>
              <div class="machine-row">
                <span class="machine-label">Max Concurrent</span>
                <span class="machine-value">{{ agent.maxConcurrentJobs }} job{{ agent.maxConcurrentJobs !== 1 ? 's' : '' }}</span>
              </div>
              <div class="machine-row" v-if="agent.currentJobIds && agent.currentJobIds.length">
                <span class="machine-label">Current Jobs</span>
                <span class="machine-value">
                  <router-link
                    v-for="jid in agent.currentJobIds"
                    :key="jid"
                    :to="{ name: 'job-detail', params: { jobId: jid } }"
                    class="current-job-link"
                  >{{ jid.slice(0, 8) }}</router-link>
                </span>
              </div>
              <div class="machine-row" v-else>
                <span class="machine-label">Current Jobs</span>
                <span class="machine-value" style="color:var(--color-text-tertiary)">Idle</span>
              </div>
              <div class="machine-row" v-if="agent.agentVersion">
                <span class="machine-label">Agent Version</span>
                <span class="machine-value">{{ agent.agentVersion }}</span>
              </div>
              <div class="machine-row" v-if="agent.capabilities?.length">
                <span class="machine-label">Capabilities</span>
                <span class="machine-value">
                  <span v-for="cap in agent.capabilities" :key="cap" class="badge badge-neutral" style="margin-right:4px;font-size:0.7rem">{{ cap }}</span>
                </span>
              </div>
            </div>

            <!-- Footer -->
            <div class="agent-card-footer">
              <span>Last heartbeat: {{ fmtRelative(agent.lastHeartbeatAt) }}</span>
              <span>Registered: {{ formatLocalDateTime(agent.createdAt) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <p style="font-size:1rem;margin-bottom:8px">No remote agents registered</p>
          <p style="color:var(--color-text-tertiary);font-size:0.85rem">Start a local agent to see it appear here.</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useJobsStore, useAgentsStore, useRepositoriesStore } from "../stores";
import type { Job } from "@remote-kiro/common";
import StatusChip from "../components/StatusChip.vue";
import { formatLocalDateTime, formatRelativeTime as fmtRelative } from "../format-date";

const POLL_INTERVAL_MS = 10_000;

const jobsStore = useJobsStore();
const agentsStore = useAgentsStore();
const repoStore = useRepositoriesStore();
const activeTab = ref("jobs");
const initialLoading = ref(true);
const filterRepo = ref("");
const filterStatus = ref("");
const filterType = ref("");
const treeView = ref(true);
const expandedNodes = ref<Record<string, boolean>>({});
let pollTimer: ReturnType<typeof setInterval> | null = null;

const totalRunningJobs = computed(() =>
  agentsStore.agents.reduce((sum, a) => sum + (a.currentJobIds?.length ?? 0), 0),
);

const uniqueRepos = computed(() => [...new Set(jobsStore.jobs.map(j => j.repoId))].sort());
const uniqueStatuses = computed(() => [...new Set(jobsStore.jobs.map(j => j.status))].sort());
const uniqueTypes = computed(() => [...new Set(jobsStore.jobs.map(j => j.jobType))].sort());

const filteredJobs = computed(() => {
  return jobsStore.jobs.filter(j => {
    if (filterRepo.value && j.repoId !== filterRepo.value) return false;
    if (filterStatus.value && j.status !== filterStatus.value) return false;
    if (filterType.value && j.jobType !== filterType.value) return false;
    return true;
  });
});

interface TreeNode {
  job: Job;
  isChild: boolean;
  children?: Job[];
}

const displayJobs = computed<TreeNode[]>(() => {
  const jobs = filteredJobs.value;
  if (!treeView.value) {
    return jobs.map(j => ({ job: j, isChild: false }));
  }

  const childIds = new Set<string>();
  const childrenMap = new Map<string, Job[]>();

  for (const j of jobs) {
    if (j.parentJobId) {
      childIds.add(j.jobId);
      const existing = childrenMap.get(j.parentJobId) ?? [];
      existing.push(j);
      childrenMap.set(j.parentJobId, existing);
    }
  }

  // Also map review jobs: if a parent has a reviewJobId, that child goes under the parent
  for (const j of jobs) {
    if (j.reviewJobId && !childrenMap.has(j.jobId)) {
      const reviewJob = jobs.find(rj => rj.jobId === j.reviewJobId);
      if (reviewJob) {
        childIds.add(reviewJob.jobId);
        const existing = childrenMap.get(j.jobId) ?? [];
        if (!existing.find(c => c.jobId === reviewJob.jobId)) {
          existing.push(reviewJob);
        }
        childrenMap.set(j.jobId, existing);
      }
    }
  }

  const result: TreeNode[] = [];
  for (const j of jobs) {
    if (childIds.has(j.jobId)) continue;
    result.push({
      job: j,
      isChild: false,
      children: childrenMap.get(j.jobId),
    });
  }
  return result;
});

function toggleTreeNode(jobId: string) {
  expandedNodes.value[jobId] = !expandedNodes.value[jobId];
}

function toggleStatusFilter(status: string) {
  filterStatus.value = filterStatus.value === status ? "" : status;
}

const repoNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const repo of repoStore.repositories) {
    map.set(repo.repoId, repo.name);
  }
  return map;
});

function resolveRepoName(repoId: string): string {
  if (!repoId) return "";
  return repoNameMap.value.get(repoId) || shortRepoName(repoId);
}

function shortRepoName(repoId: string): string {
  if (!repoId) return "";
  const parts = repoId.split("/");
  return parts[parts.length - 1] || repoId;
}

function formatJobType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function jobTypeBadgeClass(type: string): string {
  if (type === "review_pr") return "badge-info";
  if (type === "implement_review_fix") return "badge-warning";
  if (type === "implement_feature") return "badge-neutral";
  return "badge-neutral";
}


onMounted(async () => {
  await Promise.all([jobsStore.fetchAll(), agentsStore.fetchAll(), repoStore.fetchAll()]);
  initialLoading.value = false;
  pollTimer = setInterval(() => {
    jobsStore.fetchAll();
    agentsStore.fetchAll();
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.time-local {
  display: block;
  font-size: 0.75rem;
  color: var(--color-text-muted, #94a3b8);
  white-space: nowrap;
}

/* ─── Filters ─── */
.filters-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--color-bg-secondary, #f8fafc);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-group label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary, #64748b);
}

.filter-select {
  padding: 6px 28px 6px 10px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  font-size: 0.8rem;
  background: #fff;
  appearance: auto;
  min-width: 140px;
}

.filter-select:focus {
  outline: none;
  border-color: var(--color-primary, #4f46e5);
  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
}

.filter-clear {
  align-self: flex-end;
  margin-left: auto;
}

.filter-count {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-secondary, #64748b);
}

.view-toggle {
  display: flex;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
}

.view-toggle-btn {
  padding: 5px 8px;
  background: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  color: var(--color-text-secondary, #64748b);
  transition: all 0.15s;
}

.view-toggle-btn + .view-toggle-btn {
  border-left: 1px solid var(--color-border, #e2e8f0);
}

.view-toggle-btn.active {
  background: var(--color-primary, #4f46e5);
  color: #fff;
}

.status-card-active {
  outline: 2px solid var(--color-primary, #4f46e5);
  outline-offset: -2px;
  border-radius: 10px;
}

/* ─── Tree View ─── */
.tree-toggle-cell {
  width: 24px;
  text-align: center;
  padding: 0 4px !important;
}

.tree-toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--color-text-secondary, #64748b);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.tree-toggle-btn:hover {
  background: var(--color-bg-secondary, #f1f5f9);
}

.tree-branch-icon {
  color: var(--color-text-tertiary, #9ca3af);
  font-size: 0.8rem;
  font-family: monospace;
}

.job-row-child {
  background: var(--color-bg-secondary, #f8fafc);
}

.job-row-child td:first-child {
  padding-left: 8px;
}

/* ─── Repo Chip ─── */
.repo-chip {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  color: #475569;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.badge-info {
  background: #dbeafe;
  color: #1e40af;
}

.jobs-table {
  width: 100%;
}
</style>
