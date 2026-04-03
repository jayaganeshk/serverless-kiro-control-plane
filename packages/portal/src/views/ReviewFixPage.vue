<template>
  <div class="review-fix-page">
    <div class="page-header">
      <h1>Review Fix</h1>
    </div>

    <div v-if="jobsStore.loading" class="loading-state">Loading job...</div>
    <div v-else-if="jobsStore.error" class="error-state card" style="padding:32px;text-align:center">
      <p class="error" style="font-size:1rem;margin-bottom:12px">{{ jobsStore.error }}</p>
      <button class="btn btn-primary" @click="loadAll" style="font-size:0.85rem">Retry</button>
    </div>
    <div v-else-if="!jobsStore.current" class="empty-state" style="padding:48px;text-align:center">
      <p style="font-size:1rem;margin-bottom:8px">Job not found</p>
    </div>
    <template v-else>
      <!-- Job Header -->
      <div class="rf-job-header">
        <div class="rf-job-header-left">
          <StatusChip :status="jobsStore.current.status" />
          <span class="badge badge-accent">Review Fix</span>
          <code class="mono">{{ jobsStore.current.jobId.slice(0, 8) }}...</code>
        </div>
        <div class="rf-job-header-actions">
          <button
            v-if="canCancel"
            class="btn-sm btn-outline-danger"
            @click="handleCancel"
            :disabled="cancelling"
          >{{ cancelling ? 'Cancelling...' : 'Cancel Job' }}</button>
        </div>
      </div>

      <!-- Job Info -->
      <div class="rf-info-bar">
        <div class="rf-info-item">
          <span class="rf-info-label">Description</span>
          <span class="rf-info-value">{{ jobsStore.current.description }}</span>
        </div>
        <div class="rf-info-item">
          <span class="rf-info-label">Repository</span>
          <code class="mono" style="font-size:0.8rem">{{ jobsStore.current.repoId }}</code>
        </div>
        <div class="rf-info-item">
          <span class="rf-info-label">Branch</span>
          <span class="rf-info-value">{{ jobsStore.current.baseBranch }} &rarr; {{ jobsStore.current.workBranch }}</span>
        </div>
        <div v-if="jobsStore.current.parentJobId" class="rf-info-item">
          <span class="rf-info-label">Parent Job</span>
          <router-link :to="{ name: 'job-detail', params: { jobId: jobsStore.current.parentJobId } }" class="rf-parent-link">
            <code class="mono">{{ jobsStore.current.parentJobId.slice(0, 8) }}...</code>
          </router-link>
        </div>
        <div class="rf-info-item">
          <span class="rf-info-label">Created</span>
          <span class="rf-info-value">{{ formatLocalDateTime(jobsStore.current.createdAt) }}</span>
        </div>
      </div>

      <!-- PR Banner (if fix job has PR info) -->
      <div v-if="jobsStore.current.prUrl" class="rf-pr-banner">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
        </svg>
        <a :href="jobsStore.current.prUrl" target="_blank" rel="noopener">
          PR #{{ jobsStore.current.prNumber }}
        </a>
      </div>

      <!-- Main Two-Panel Layout -->
      <div class="rf-panels">
        <!-- Left: Review Findings -->
        <div class="rf-panel rf-findings-panel">
          <div class="rf-panel-header">
            <div class="rf-panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <h3>Review Findings</h3>
            </div>
            <span class="badge badge-info" v-if="reviewReport">{{ reviewFindingsCount }} findings</span>
          </div>
          <div v-if="loadingParent" class="rf-loading-inline">
            <div class="rf-spinner"></div>
            <span>Loading review report...</span>
          </div>
          <div v-else-if="reviewReport" class="rf-findings-body" v-html="renderMarkdown(reviewReport)"></div>
          <div v-else class="rf-empty-panel">
            <p>No review report available. The findings may still be loading or the parent job has no review data.</p>
          </div>
        </div>

        <!-- Right: Fix Tasks -->
        <div class="rf-panel rf-tasks-panel">
          <div class="rf-panel-header">
            <div class="rf-panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <h3>Fix Tasks</h3>
            </div>
            <span class="badge" :class="tasksStatusBadge">{{ tasksStatusLabel }}</span>
          </div>

          <!-- Task Progress -->
          <div v-if="tasks.length" class="rf-tasks-progress">
            <div class="rf-tasks-progress-text">
              {{ taskStats.completed }}/{{ taskStats.total }} tasks completed
            </div>
            <div class="rf-progress-bar">
              <div class="rf-progress-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
          </div>

          <!-- Approve Tasks (if tasks are in draft) -->
          <div v-if="tasksPhaseData?.status === 'draft' && tasks.length > 0" class="rf-approve-bar">
            <span class="rf-approve-hint">The agent generated {{ tasks.length }} fix tasks. Review and approve to start implementation.</span>
            <div class="rf-approve-actions">
              <button class="btn-sm btn-primary" @click="handleApproveTasks" :disabled="approving">
                {{ approving ? 'Approving...' : 'Approve Tasks' }}
              </button>
              <button class="btn-sm btn-outline-danger" @click="showRejectDialog = true" :disabled="rejecting">
                Reject
              </button>
            </div>
          </div>

          <!-- Reject Dialog -->
          <div v-if="showRejectDialog" class="rf-reject-dialog">
            <label>Rejection Reason</label>
            <textarea v-model="rejectReason" rows="3" placeholder="Explain what should be changed..."></textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn-sm btn-danger" @click="handleRejectTasks" :disabled="rejecting || !rejectReason.trim()">
                {{ rejecting ? 'Rejecting...' : 'Confirm Reject' }}
              </button>
              <button class="btn-sm btn-secondary" @click="showRejectDialog = false; rejectReason = ''">Cancel</button>
            </div>
          </div>

          <!-- Task Cards -->
          <div v-if="tasks.length" class="rf-tasks-list">
            <div
              v-for="task in tasks"
              :key="task.id"
              class="rf-task-card"
              :class="{
                'is-completed': task.taskStatus === 'completed' || task.completed,
                'is-in-progress': task.taskStatus === 'in_progress',
                'is-failed': task.taskStatus === 'failed',
              }"
            >
              <div class="rf-task-header">
                <span class="rf-task-id">{{ task.id }}</span>
                <span class="rf-task-chip" :class="taskChipClass(task)">{{ taskLabel(task) }}</span>
              </div>
              <div class="rf-task-body" v-html="renderMarkdown(task.content)"></div>
            </div>
          </div>
          <div v-else class="rf-empty-panel">
            <div v-if="tasksPhaseData?.status === 'generating'" class="rf-generating">
              <div class="rf-spinner"></div>
              <div>
                <strong>Generating fix tasks...</strong>
                <p>The agent is analyzing the review findings and creating tasks.</p>
              </div>
            </div>
            <div v-else-if="isRunning" class="rf-generating">
              <div class="rf-spinner"></div>
              <div>
                <strong>Working...</strong>
                <p>The agent is processing. Tasks will appear here shortly.</p>
              </div>
            </div>
            <p v-else>No tasks generated yet.</p>
          </div>

          <!-- Feedback Chat (when tasks are in draft) -->
          <div v-if="tasksPhaseData?.status === 'draft'" class="rf-chat">
            <h4>Feedback</h4>
            <div v-if="phaseMessages.length" class="rf-messages">
              <div v-for="msg in phaseMessages" :key="msg.messageId" class="rf-msg">
                <span class="rf-msg-time">{{ formatLocalTime(msg.createdAt) }}</span>
                <span class="rf-msg-sender">{{ msg.sender }}</span>
                <span class="rf-msg-text">{{ msg.message }}</span>
              </div>
            </div>
            <div class="rf-chat-input">
              <textarea
                v-model="chatMessage"
                rows="2"
                placeholder="Describe what to change — the agent will revise tasks with your feedback..."
                :disabled="chatSending"
              ></textarea>
              <button
                class="btn-sm btn-accent"
                @click="handlePostMessage"
                :disabled="chatSending || !chatMessage.trim()"
              >{{ chatSending ? 'Sending...' : 'Request Changes' }}</button>
            </div>
            <div v-if="feedbackRegenTriggered" class="rf-regen-banner">
              <div class="rf-spinner"></div>
              <span>Revision requested — the agent is re-generating tasks with your feedback...</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Event Timeline -->
      <h2>Event Timeline</h2>
      <div v-if="jobsStore.loadingEvents" class="loading-state">Loading events...</div>
      <div v-else-if="jobsStore.events.length" class="event-timeline-container">
        <ul class="event-timeline">
          <li v-for="event in jobsStore.events" :key="event.eventTs">
            <span class="event-time">{{ formatLocalTime(event.eventTs) }}</span>
            <span class="event-type">{{ event.eventType }}</span>
            <span v-if="event.stage" class="event-stage">[{{ event.stage }}]</span>
            <span class="event-msg">{{ event.message }}</span>
          </li>
        </ul>
      </div>
      <div v-else class="empty-state" style="padding:24px">No events recorded.</div>

      <h2>Artifacts</h2>
      <div v-if="jobsStore.loadingArtifacts" class="loading-state">Loading artifacts...</div>
      <ul v-else-if="jobsStore.artifacts.length" style="list-style:none;padding:0">
        <li v-for="artifact in jobsStore.artifacts" :key="artifact.artifactId" class="card" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px">
          <span class="badge badge-neutral">{{ artifact.artifactType }}</span>
          <a v-if="artifact.downloadUrl" :href="artifact.downloadUrl" target="_blank" rel="noopener" class="btn btn-sm btn-primary" style="text-decoration:none;color:#fff">Download</a>
        </li>
      </ul>
      <div v-else class="empty-state" style="padding:24px">No artifacts.</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useJobsStore } from "../stores";
import { TERMINAL_STATUSES, type SpecItem } from "@remote-kiro/common";
import { marked } from "marked";
import StatusChip from "../components/StatusChip.vue";
import { jobs as jobsApi } from "../api";
import { formatLocalDateTime, formatLocalTime } from "../format-date";

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  try { return marked.parse(text) as string; }
  catch { return text.replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
}

const POLL_INTERVAL_MS = 8_000;

const props = defineProps<{ jobId: string }>();
const jobsStore = useJobsStore();

const cancelling = ref(false);
const approving = ref(false);
const rejecting = ref(false);
const showRejectDialog = ref(false);
const rejectReason = ref("");
const chatMessage = ref("");
const chatSending = ref(false);
const feedbackRegenTriggered = ref(false);
const phaseMessages = ref<Array<{ messageId: string; message: string; sender: string; createdAt: string }>>([]);
const loadingParent = ref(false);
const parentReviewReport = ref<string | null>(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const canCancel = computed(() => {
  const s = jobsStore.current?.status;
  return s && !TERMINAL_STATUSES.has(s as any);
});

const isRunning = computed(() => {
  const s = jobsStore.current?.status;
  return s === "RUNNING" || s === "CLAIMED" || s === "QUEUED";
});

const reviewReport = computed(() => {
  if (parentReviewReport.value) return parentReviewReport.value;
  const reqPhase = jobsStore.spec?.phases?.requirements;
  if (reqPhase?.items?.length) {
    return reqPhase.items.map((i: any) => i.content).join("\n\n");
  }
  return null;
});

const reviewFindingsCount = computed(() => {
  const report = reviewReport.value;
  if (!report) return 0;
  const headings = report.match(/^##+ /gm);
  return headings?.length ?? 0;
});

const tasksPhaseData = computed(() => {
  return jobsStore.spec?.phases?.tasks ?? null;
});

const tasks = computed<SpecItem[]>(() => {
  return (tasksPhaseData.value?.items ?? []) as SpecItem[];
});

const taskStats = computed(() => {
  const items = tasks.value;
  return {
    total: items.length,
    completed: items.filter((i: any) => i.taskStatus === "completed" || i.completed).length,
    inProgress: items.filter((i: any) => i.taskStatus === "in_progress").length,
  };
});

const progressPercent = computed(() => {
  if (taskStats.value.total === 0) return 0;
  return Math.round((taskStats.value.completed / taskStats.value.total) * 100);
});

const tasksStatusLabel = computed(() => {
  const s = tasksPhaseData.value?.status;
  if (!s || s === "pending") return "Pending";
  if (s === "generating") return "Generating...";
  if (s === "draft") return "Awaiting Approval";
  if (s === "approved") return taskStats.value.completed === taskStats.value.total && taskStats.value.total > 0 ? "Complete" : "In Progress";
  if (s === "rejected") return "Rejected";
  return s;
});

const tasksStatusBadge = computed(() => {
  const s = tasksPhaseData.value?.status;
  if (s === "approved") return "badge-success";
  if (s === "draft") return "badge-warning";
  if (s === "generating") return "badge-info";
  if (s === "rejected") return "badge-danger";
  return "badge-neutral";
});

function taskChipClass(item: SpecItem): string {
  const s = (item as any).taskStatus;
  if (s === "completed" || item.completed) return "chip-completed";
  if (s === "in_progress") return "chip-in-progress";
  if (s === "failed") return "chip-failed";
  return "chip-pending";
}

function taskLabel(item: SpecItem): string {
  const s = (item as any).taskStatus;
  if (s === "completed" || item.completed) return "Completed";
  if (s === "in_progress") return "In Progress";
  if (s === "failed") return "Failed";
  return "Pending";
}

function loadAll() {
  jobsStore.fetchOne(props.jobId);
  jobsStore.fetchEvents(props.jobId);
  jobsStore.fetchArtifacts(props.jobId);
  jobsStore.fetchSpec(props.jobId);
}

async function loadParentReview() {
  const parentId = jobsStore.current?.parentJobId;
  if (!parentId || parentId.length < 10) return;
  loadingParent.value = true;
  try {
    const parent = await jobsApi.get(parentId);
    if (parent.reviewReport) {
      parentReviewReport.value = parent.reviewReport;
    }
  } catch { /* ignore */ }
  finally { loadingParent.value = false; }
}

function initJob() {
  jobsStore.resetDetail();
  parentReviewReport.value = null;
  feedbackRegenTriggered.value = false;
  phaseMessages.value = [];
  if (pollTimer) clearInterval(pollTimer);

  loadAll();
  pollTimer = setInterval(() => {
    if (jobsStore.current && TERMINAL_STATUSES.has(jobsStore.current.status as any)) {
      if (pollTimer) clearInterval(pollTimer);
      return;
    }
    loadAll();
  }, POLL_INTERVAL_MS);
}

onMounted(() => { initJob(); });
watch(() => props.jobId, () => { initJob(); });

watch(() => jobsStore.current, (job) => {
  if (job?.parentJobId && !parentReviewReport.value && !loadingParent.value) {
    loadParentReview();
  }
}, { immediate: true });

watch(tasksPhaseData, async (td) => {
  if (td?.status === "draft") {
    try {
      phaseMessages.value = await jobsStore.getPhaseMessages(props.jobId, "tasks");
    } catch { phaseMessages.value = []; }
  }
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

async function handleCancel() {
  cancelling.value = true;
  try { await jobsStore.cancel(props.jobId); loadAll(); }
  finally { cancelling.value = false; }
}

async function handleApproveTasks() {
  approving.value = true;
  try { await jobsStore.approvePhase(props.jobId, "tasks"); loadAll(); }
  finally { approving.value = false; }
}

async function handleRejectTasks() {
  if (!rejectReason.value.trim()) return;
  rejecting.value = true;
  try {
    await jobsStore.rejectPhase(props.jobId, "tasks", rejectReason.value.trim());
    showRejectDialog.value = false;
    rejectReason.value = "";
    loadAll();
  } finally { rejecting.value = false; }
}

async function handlePostMessage() {
  if (!chatMessage.value.trim()) return;
  chatSending.value = true;
  feedbackRegenTriggered.value = false;
  try {
    const result = await jobsStore.postPhaseMessage(props.jobId, "tasks", chatMessage.value.trim());
    chatMessage.value = "";
    phaseMessages.value = await jobsStore.getPhaseMessages(props.jobId, "tasks");
    if (result?.regenerating) {
      feedbackRegenTriggered.value = true;
      loadAll();
    }
  } finally { chatSending.value = false; }
}
</script>

<style scoped>
/* ─── Job Header ─── */
.rf-job-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.rf-job-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.badge-accent {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ─── Info Bar ─── */
.rf-info-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  padding: 16px 20px;
  background: var(--color-bg-secondary, #f8fafc);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: var(--radius-lg, 14px);
  margin-bottom: 16px;
}
.rf-info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rf-info-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary, #94a3b8);
}
.rf-info-value {
  font-size: 0.85rem;
  color: var(--color-text, #1e293b);
}
.rf-parent-link {
  font-size: 0.85rem;
  text-decoration: none;
  color: var(--color-primary, #4f46e5);
}
.rf-parent-link:hover { text-decoration: underline; }

/* ─── PR Banner ─── */
.rf-pr-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 8px;
  margin-bottom: 20px;
  color: #16a34a;
  font-size: 0.85rem;
  font-weight: 600;
}
.rf-pr-banner a {
  color: #15803d;
  text-decoration: none;
}
.rf-pr-banner a:hover { text-decoration: underline; }

/* ─── Two-Panel Layout ─── */
.rf-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 32px;
}
@media (max-width: 1024px) {
  .rf-panels { grid-template-columns: 1fr; }
}

/* ─── Panel ─── */
.rf-panel {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: var(--radius-lg, 14px);
  background: var(--color-surface, #fff);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.rf-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-bg-secondary, #f8fafc);
}
.rf-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rf-panel-title h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}
.rf-findings-panel .rf-panel-header {
  background: linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%);
  border-bottom-color: #c7d2fe;
}
.rf-findings-panel .rf-panel-title { color: #4f46e5; }
.rf-tasks-panel .rf-panel-header {
  background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
  border-bottom-color: #a7f3d0;
}
.rf-tasks-panel .rf-panel-title { color: #059669; }

/* ─── Findings Body ─── */
.rf-findings-body {
  padding: 20px;
  font-size: 0.875rem;
  line-height: 1.65;
  max-height: 70vh;
  overflow-y: auto;
  flex: 1;
}
.rf-findings-body :deep(h1) { font-size: 1.1rem; margin: 0 0 12px; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.rf-findings-body :deep(h2) { font-size: 0.95rem; margin: 18px 0 8px; color: #334155; }
.rf-findings-body :deep(h3) { font-size: 0.88rem; margin: 14px 0 6px; color: #475569; padding: 8px 12px; background: #eef2ff; border-radius: 6px; border-left: 3px solid #6366f1; }
.rf-findings-body :deep(p) { margin: 0 0 8px; }
.rf-findings-body :deep(strong) { color: #1e293b; }
.rf-findings-body :deep(code) { background: #e0e7ff; padding: 1px 5px; border-radius: 3px; font-size: 0.82em; }
.rf-findings-body :deep(pre) { background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 8px; overflow-x: auto; font-size: 0.82rem; margin: 8px 0; }
.rf-findings-body :deep(pre code) { background: none; padding: 0; color: inherit; }
.rf-findings-body :deep(ul) { padding-left: 20px; }

/* ─── Tasks ─── */
.rf-tasks-progress {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border, #e2e8f0);
}
.rf-tasks-progress-text {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary, #64748b);
  margin-bottom: 8px;
}
.rf-progress-bar {
  height: 6px;
  background: var(--color-border, #e2e8f0);
  border-radius: 3px;
  overflow: hidden;
}
.rf-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 3px;
  transition: width 0.4s ease;
}

.rf-approve-bar {
  padding: 14px 20px;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.rf-approve-hint {
  font-size: 0.82rem;
  color: #92400e;
  flex: 1;
}
.rf-approve-actions {
  display: flex;
  gap: 8px;
}

.rf-reject-dialog {
  padding: 16px 20px;
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
}
.rf-reject-dialog label {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 6px;
  color: #991b1b;
}
.rf-reject-dialog textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
}

.rf-tasks-list {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
  max-height: 60vh;
}

.rf-task-card {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  padding: 14px 18px;
  background: var(--color-bg-secondary, #f8fafc);
  transition: box-shadow 0.15s;
}
.rf-task-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.rf-task-card.is-completed { opacity: 0.75; border-left: 3px solid #22c55e; }
.rf-task-card.is-in-progress { border-left: 3px solid #3b82f6; background: #eff6ff; }
.rf-task-card.is-failed { border-left: 3px solid #ef4444; background: #fef2f2; }

.rf-task-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.rf-task-id {
  display: inline-block;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', monospace;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border-radius: 6px;
  letter-spacing: 0.3px;
}
.rf-task-chip {
  display: inline-block;
  padding: 2px 10px;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.chip-completed { background: #dcfce7; color: #166534; }
.chip-in-progress { background: #dbeafe; color: #1e40af; animation: pulse-bg 1.5s infinite; }
.chip-failed { background: #fee2e2; color: #991b1b; }
.chip-pending { background: #f1f5f9; color: #64748b; }

@keyframes pulse-bg {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.rf-task-body {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text, #1e293b);
}
.rf-task-body :deep(p) { margin: 0 0 6px; }
.rf-task-body :deep(p:last-child) { margin-bottom: 0; }
.rf-task-body :deep(strong) { color: var(--color-text-heading, #0f172a); }
.rf-task-body :deep(code) { background: var(--color-bg-code, #e2e8f0); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
.rf-task-body :deep(pre) { background: #1e293b; color: #e2e8f0; padding: 10px 14px; border-radius: 8px; overflow-x: auto; font-size: 0.82rem; margin: 6px 0; }
.rf-task-body :deep(pre code) { background: none; padding: 0; color: inherit; }
.rf-task-body :deep(ul), .rf-task-body :deep(ol) { margin: 4px 0; padding-left: 20px; }

/* ─── Empty / Loading ─── */
.rf-empty-panel {
  padding: 32px 20px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-text-secondary, #6b7280);
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rf-loading-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 20px;
  font-size: 0.85rem;
  color: var(--color-text-secondary, #6b7280);
}
.rf-generating {
  display: flex;
  align-items: center;
  gap: 16px;
  text-align: left;
}
.rf-generating strong { display: block; font-size: 0.9rem; color: var(--color-primary, #4f46e5); margin-bottom: 4px; }
.rf-generating p { margin: 0; font-size: 0.82rem; color: var(--color-text-secondary, #6b7280); }

.rf-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 3px solid #e0e7ff;
  border-top-color: #4f46e5;
  animation: rf-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes rf-spin { to { transform: rotate(360deg); } }

/* ─── Chat / Feedback ─── */
.rf-chat {
  padding: 16px 20px;
  border-top: 1px solid var(--color-border, #e2e8f0);
}
.rf-chat h4 {
  margin: 0 0 10px;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-text-secondary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.rf-messages {
  max-height: 150px;
  overflow-y: auto;
  margin-bottom: 10px;
  font-size: 0.82rem;
}
.rf-msg { margin-bottom: 6px; }
.rf-msg-time { font-size: 0.7rem; color: var(--color-text-tertiary, #94a3b8); margin-right: 6px; }
.rf-msg-sender { font-weight: 600; color: var(--color-primary, #4f46e5); font-size: 0.78rem; margin-right: 6px; }
.rf-msg-text { font-size: 0.82rem; }

.rf-chat-input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.rf-chat-input textarea {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  font-size: 0.82rem;
  font-family: inherit;
  resize: none;
}
.rf-chat-input textarea:focus {
  outline: none;
  border-color: var(--color-primary, #4f46e5);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.btn-accent { background: #8b5cf6; color: #fff; border: none; border-radius: 6px; }
.btn-accent:hover { background: #7c3aed; }
.btn-accent:disabled { opacity: 0.6; cursor: not-allowed; }

.rf-regen-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  font-size: 0.82rem;
  color: #4f46e5;
  font-weight: 500;
}

/* ─── Event Timeline Container ─── */
.event-timeline-container {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  background: var(--color-bg-secondary, #f8fafc);
  padding: 12px 16px 12px 40px;
}
.event-timeline-container .event-timeline {
  margin: 0;
  padding-left: 0;
  border-left-color: var(--color-border, #e2e8f0);
}
</style>
