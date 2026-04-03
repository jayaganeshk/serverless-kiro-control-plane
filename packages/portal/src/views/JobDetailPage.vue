<template>
  <div class="job-detail-page">
    <div class="page-header">
      <h1>Job Detail</h1>
    </div>

    <div v-if="jobsStore.loading" class="loading-state">Loading job...</div>
    <div v-else-if="jobsStore.error" class="error-state card" style="padding:32px;text-align:center">
      <p class="error" style="font-size:1rem;margin-bottom:12px">{{ jobsStore.error }}</p>
      <button class="btn btn-primary" @click="loadAll" style="font-size:0.85rem">Retry</button>
    </div>
    <div v-else-if="!jobsStore.current" class="empty-state" style="padding:48px;text-align:center">
      <p style="font-size:1rem;margin-bottom:8px">Job not found</p>
      <p style="color:var(--muted);font-size:0.85rem">The job may have been deleted or the ID is invalid.</p>
    </div>
    <template v-else>
      <!-- Job Header -->
      <div class="job-header">
        <StatusChip :status="jobsStore.current.status" />
        <span class="badge badge-neutral">{{ jobsStore.current.jobType }}</span>
        <code class="mono">{{ jobsStore.current.jobId }}</code>
      </div>

      <!-- PR Banner -->
      <div v-if="jobsStore.current.prUrl" class="pr-banner">
        <div class="pr-banner-icon">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
          </svg>
        </div>
        <div class="pr-banner-content">
          <div class="pr-banner-title">Pull Request Created</div>
          <a :href="jobsStore.current.prUrl" target="_blank" rel="noopener" class="pr-banner-link">
            {{ jobsStore.current.prUrl }}
            <span v-if="jobsStore.current.prNumber" class="pr-banner-number">#{{ jobsStore.current.prNumber }}</span>
          </a>
          <div v-if="jobsStore.current.commitSha" class="pr-banner-commit">
            Commit: <code>{{ jobsStore.current.commitSha?.substring(0, 8) }}</code>
          </div>
        </div>
        <div class="pr-banner-actions">
          <a :href="jobsStore.current.prUrl" target="_blank" rel="noopener" class="btn-sm btn-primary">
            View PR
          </a>
          <select v-model="selectedReviewAgentId" class="review-agent-select" :disabled="reviewingCode || reviewPolling">
            <option value="">Default reviewer</option>
            <option v-for="a in reviewAgentOptions" :key="a.aiAgentId" :value="a.aiAgentId">
              {{ a.name }}
            </option>
          </select>
          <button
            class="btn-sm btn-secondary"
            @click="handleReviewCode"
            :disabled="reviewingCode || reviewPolling"
          >
            {{ reviewPolling ? 'Review in progress...' : reviewingCode ? 'Requesting...' : 'Review Code' }}
          </button>
        </div>
      </div>

      <!-- Job Info Card -->
      <div class="job-info">
        <p><strong>Description:</strong> {{ jobsStore.current.description }}</p>
        <p><strong>Repository:</strong> <code class="mono">{{ jobsStore.current.repoId }}</code></p>
        <p><strong>Branch:</strong> {{ jobsStore.current.baseBranch }} → {{ jobsStore.current.workBranch }}</p>
        <p><strong>Created:</strong> {{ formatLocalDateTime(jobsStore.current.createdAt) }}</p>
        <p v-if="jobsStore.current.startedAt"><strong>Started:</strong> {{ formatLocalDateTime(jobsStore.current.startedAt) }}</p>
        <p v-if="jobsStore.current.completedAt"><strong>Completed:</strong> {{ formatLocalDateTime(jobsStore.current.completedAt) }}</p>
        <p v-if="jobsStore.current.assignedAgentId"><strong>Remote Agent:</strong> <code class="mono">{{ jobsStore.current.assignedAgentId }}</code></p>
        <p v-if="jobsStore.current.parentJobId && jobsStore.current.parentJobId.length > 10"><strong>Parent Job:</strong>
          <router-link :to="{ name: 'job-detail', params: { jobId: jobsStore.current.parentJobId } }" style="font-size:0.85rem">
            <code class="mono">{{ jobsStore.current.parentJobId.slice(0, 8) }}...</code>
          </router-link>
        </p>
        <p v-if="jobsStore.current.errorMessage" class="error" style="margin-top:12px"><strong>Error:</strong> {{ jobsStore.current.errorMessage }}</p>
      </div>

      <button
        v-if="canCancel"
        class="btn-outline-danger"
        @click="handleCancel"
        :disabled="cancelling"
      >
        {{ cancelling ? "Cancelling..." : "Cancel Job" }}
      </button>

      <!-- Review Report Panel (shown on both parent feature jobs and review_pr jobs) -->
      <div v-if="showReviewPanel || jobsStore.current.reviewReport || isReviewJob" class="review-panel card">
        <div class="review-panel-header" @click="reviewCollapsed = !reviewCollapsed" style="cursor:pointer">
          <h3>
            Code Review
            <span v-if="effectiveReviewOutcome" class="review-outcome-badge" :class="reviewOutcomeClass">
              {{ effectiveReviewOutcome }}
            </span>
          </h3>
          <div class="review-panel-actions" @click.stop>
            <button
              v-if="canFixReview"
              class="btn-sm btn-primary"
              @click="handleFixReview"
              :disabled="fixingReview || fixJobPolling"
              style="font-size:0.75rem"
            >
              {{ fixingReview ? 'Creating fix job...' : 'Fix Review Issues' }}
            </button>
            <div v-if="fixJobPolling" class="fix-status-indicator">
              <div class="fix-status-spinner"></div>
              <span>Fix in progress...</span>
            </div>
            <span v-if="fixJobCompleted" class="fix-applied-badge">Fixes Applied</span>
            <router-link
              v-if="fixReviewJobId"
              :to="{ name: 'review-fix', params: { jobId: fixReviewJobId } }"
              class="btn-sm btn-secondary"
              style="text-decoration:none;font-size:0.75rem"
            >
              View Fix Job
            </router-link>
            <router-link
              v-if="jobsStore.current.reviewJobId && !isReviewJob"
              :to="{ name: 'job-detail', params: { jobId: jobsStore.current.reviewJobId } }"
              class="btn-sm btn-secondary"
              style="text-decoration:none;font-size:0.75rem"
            >
              View Review Job
            </router-link>
            <router-link
              v-if="isReviewJob && jobsStore.current.parentJobId && jobsStore.current.parentJobId.length > 10"
              :to="{ name: 'job-detail', params: { jobId: jobsStore.current.parentJobId } }"
              class="btn-sm btn-secondary"
              style="text-decoration:none;font-size:0.75rem"
            >
              View Parent Job
            </router-link>
          </div>
          <span class="collapse-toggle" :class="{ 'is-collapsed': reviewCollapsed }">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
        <template v-if="!reviewCollapsed">
          <div v-if="reviewPolling" class="review-polling">
            <div class="review-polling-spinner"></div>
            <div class="review-polling-text">
              <strong>Review in progress...</strong>
              <p>The remote agent is reviewing your code. This typically takes 30-60 seconds.</p>
            </div>
          </div>
          <template v-else-if="reviewHistoryEntries.length > 0">
            <div v-if="lastReviewedAt" class="review-meta">
              <span class="review-meta-label">Last reviewed:</span>
              <span class="review-meta-value">{{ formatLocalDateTime(lastReviewedAt) }}</span>
              <span class="review-meta-count">{{ reviewHistoryEntries.length }} review{{ reviewHistoryEntries.length > 1 ? 's' : '' }}</span>
            </div>
            <div v-if="mergedReviewReport" class="review-findings" v-html="renderMarkdown(mergedReviewReport)"></div>
            <div v-else-if="effectiveReviewReport" class="review-findings" v-html="renderMarkdown(effectiveReviewReport)"></div>
            <details v-if="reviewHistoryEntries.length > 1" class="review-history-details">
              <summary>View individual review history ({{ reviewHistoryEntries.length }})</summary>
              <div v-for="(entry, idx) in reviewHistoryEntries" :key="entry.reviewJobId" class="review-history-entry">
                <div class="review-history-header">
                  <span class="review-history-num">Review #{{ idx + 1 }}</span>
                  <span class="review-outcome-badge" :class="outcomeClass(entry.reviewOutcome)">{{ entry.reviewOutcome }}</span>
                  <span class="review-history-date">{{ formatLocalDateTime(entry.reviewedAt) }}</span>
                </div>
                <div class="review-findings review-history-body" v-html="renderMarkdown(entry.reviewReport)"></div>
              </div>
            </details>
          </template>
          <div v-else-if="effectiveReviewReport" class="review-findings" v-html="renderMarkdown(effectiveReviewReport)"></div>
          <div v-else-if="isReviewJob && !effectiveReviewReport && reviewReportLoading" class="loading-state" style="padding:16px">Loading review report...</div>
          <div v-else-if="isReviewJob && !effectiveReviewReport" class="empty-state" style="padding:16px;font-size:0.85rem">Review report will appear here once the agent completes the review.</div>
          <div v-else-if="reviewError" class="error" style="margin:0">{{ reviewError }}</div>
        </template>
      </div>

      <!-- Spec Workflow -->
      <h2>Spec Workflow</h2>
      <div v-if="jobsStore.loadingSpec" class="loading-state">Loading spec...</div>
      <div v-else-if="jobsStore.spec" class="spec-workflow">
        <!-- Phase Progress Bar -->
        <div class="spec-phases-bar">
          <div
            v-for="phase in SPEC_PHASE_ORDER"
            :key="phase"
            class="spec-phase-indicator"
            :class="{
              'is-active': jobsStore.spec.currentPhase === phase,
              'is-approved': jobsStore.spec.phases[phase]?.status === 'approved',
              'is-draft': jobsStore.spec.phases[phase]?.status === 'draft',
              'is-generating': jobsStore.spec.phases[phase]?.status === 'generating',
              'is-rejected': jobsStore.spec.phases[phase]?.status === 'rejected',
            }"
            @click="selectedPhase = phase"
          >
            <div class="phase-dot"></div>
            <span class="phase-label">{{ formatPhase(phase) }}</span>
            <span class="phase-status-tag">{{ jobsStore.spec.phases[phase]?.status ?? 'pending' }}</span>
          </div>
        </div>

        <!-- Phase Detail Panel -->
        <div class="spec-phase-panel card" v-if="selectedPhase && currentPhaseData">
          <!-- Collapsible header -->
          <div class="phase-panel-header" @click="toggleSectionCollapse(selectedPhase!)" style="cursor:pointer">
            <h3>{{ formatPhase(selectedPhase!) }}</h3>
            <span class="badge" :class="phaseStatusBadgeClass(currentPhaseData.status)">
              {{ currentPhaseData.status }}
            </span>
            <span v-if="currentPhaseData.revision > 0" class="badge badge-neutral" style="margin-left:4px">
              Rev {{ currentPhaseData.revision }}
            </span>
            <span class="collapse-toggle" :class="{ 'is-collapsed': collapsedSections[selectedPhase!] }">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </span>
          </div>

          <div v-if="currentPhaseData.generatedAt && !collapsedSections[selectedPhase!]" class="phase-meta">
            Generated: {{ formatLocalDateTime(currentPhaseData.generatedAt) }}
            <template v-if="currentPhaseData.approvedAt">
              &bull; Approved: {{ formatLocalDateTime(currentPhaseData.approvedAt) }}
            </template>
          </div>

          <div v-if="currentPhaseData.rejectionReason && !collapsedSections[selectedPhase!]" class="error" style="margin-bottom:16px">
            Rejection feedback: {{ currentPhaseData.rejectionReason }}
          </div>

          <!-- Collapsible content -->
          <template v-if="!collapsedSections[selectedPhase!]">
            <!-- Full markdown document: design phase -->
            <div v-if="selectedPhase === 'design' && currentPhaseData.items.length" class="design-document">
              <div
                v-if="!editingItems"
                class="spec-item-body"
                v-html="renderMarkdown(currentPhaseData.items.map((i: any) => i.content).join('\n\n'))"
              ></div>
              <textarea
                v-else
                class="spec-item-edit design-edit"
                v-model="editableItems[0].content"
                rows="20"
              ></textarea>
            </div>

            <!-- Requirements: structured item cards -->
            <div v-else-if="selectedPhase !== 'tasks' && currentPhaseData.items.length" class="spec-items-list">
              <div class="spec-items-summary">
                {{ currentPhaseData.items.length }} {{ formatPhase(selectedPhase!) }} item{{ currentPhaseData.items.length !== 1 ? 's' : '' }}
              </div>
              <div
                v-for="(item, idx) in editableItems"
                :key="item.id"
                class="spec-item-card"
              >
                <div class="spec-item-header">
                  <span class="spec-item-badge">{{ item.id }}</span>
                </div>
                <div
                  v-if="!editingItems"
                  class="spec-item-body"
                  v-html="renderMarkdown(item.content)"
                ></div>
                <textarea
                  v-else
                  class="spec-item-edit"
                  v-model="editableItems[idx].content"
                  rows="6"
                ></textarea>
              </div>
            </div>

            <!-- Tasks: cards with per-task status -->
            <div v-else-if="selectedPhase === 'tasks' && currentPhaseData.items.length" class="spec-items-list">
              <div class="spec-items-summary">
                {{ currentPhaseData.items.length }} tasks
                <template v-if="taskStats.completed > 0">
                  &mdash; {{ taskStats.completed }}/{{ currentPhaseData.items.length }} completed
                </template>
              </div>
              <div v-if="taskStats.total > 0" class="task-progress-bar">
                <div class="task-progress-fill" :style="{ width: (taskStats.completed / taskStats.total * 100) + '%' }"></div>
              </div>
              <div
                v-for="(item, idx) in editableItems"
                :key="item.id"
                class="spec-item-card"
                :class="{
                  'is-completed': item.taskStatus === 'completed' || item.completed,
                  'is-in-progress': item.taskStatus === 'in_progress',
                  'is-failed': item.taskStatus === 'failed',
                }"
              >
                <div class="spec-item-header">
                  <span class="spec-item-badge">{{ item.id }}</span>
                  <span :class="taskStatusBadgeClass(item)" class="task-status-chip">
                    {{ taskStatusLabel(item) }}
                  </span>
                </div>
                <div
                  v-if="!editingItems"
                  class="spec-item-body"
                  v-html="renderMarkdown(item.content)"
                ></div>
                <textarea
                  v-else
                  class="spec-item-edit"
                  v-model="editableItems[idx].content"
                  rows="6"
                ></textarea>
              </div>
            </div>
            <div v-else class="empty-state" style="padding:24px;font-size:0.85rem">
              {{ currentPhaseData.status === 'generating' ? 'Generating...' : 'No items yet.' }}
            </div>

            <!-- Action Buttons -->
            <div class="phase-actions" v-if="currentPhaseData.items.length > 0">
              <template v-if="currentPhaseData.status === 'draft'">
                <button class="btn-sm" :class="editingItems ? 'btn-primary' : 'btn-secondary'" @click="toggleEdit">
                  {{ editingItems ? 'Save Changes' : 'Edit Items' }}
                </button>
                <button class="btn-sm btn-primary" @click="handleApprove" :disabled="approving">
                  {{ approving ? 'Approving...' : 'Approve' }}
                </button>
                <button class="btn-sm btn-outline-danger" @click="showRejectDialog = true" :disabled="rejecting">
                  Reject
                </button>
              </template>
              <template v-else-if="currentPhaseData.status === 'approved'">
                <button
                  v-if="editingItems"
                  class="btn-sm btn-primary"
                  @click="toggleEdit"
                >
                  Save Changes
                </button>
                <button
                  v-else
                  class="btn-sm btn-secondary"
                  @click="toggleEdit"
                >
                  Edit Items
                </button>
              </template>
            </div>

            <!-- Reject Dialog -->
            <div v-if="showRejectDialog" class="reject-dialog">
              <label>Rejection Reason</label>
              <textarea v-model="rejectReason" rows="3" placeholder="Explain what should be changed..."></textarea>
              <div style="display:flex;gap:8px;margin-top:8px">
                <button class="btn-sm btn-danger" @click="handleReject" :disabled="rejecting || !rejectReason.trim()">
                  {{ rejecting ? 'Rejecting...' : 'Confirm Reject' }}
                </button>
                <button class="btn-sm btn-secondary" @click="showRejectDialog = false; rejectReason = ''">Cancel</button>
              </div>
            </div>

            <!-- Chat / Submit Feedback -->
            <div class="phase-chat">
              <h4>Feedback &amp; Context</h4>
              <div v-if="phaseMessages.length" class="phase-messages">
                <div v-for="msg in phaseMessages" :key="msg.messageId" class="phase-msg">
                  <span class="phase-msg-time">{{ formatLocalTime(msg.createdAt) }}</span>
                  <span class="phase-msg-sender">{{ msg.sender }}</span>
                  <span class="phase-msg-text">{{ msg.message }}</span>
                </div>
              </div>
              <div class="phase-chat-input">
                <textarea
                  v-model="chatMessage"
                  rows="2"
                  :placeholder="currentPhaseData?.status === 'draft'
                    ? 'Describe what to change — the agent will revise this phase with your feedback...'
                    : 'Add notes or context for this phase...'"
                  :disabled="chatSending"
                ></textarea>
                <div class="feedback-actions">
                  <button
                    class="btn-sm"
                    :class="currentPhaseData?.status === 'draft' ? 'btn-accent' : 'btn-primary'"
                    @click="handlePostMessage"
                    :disabled="chatSending || !chatMessage.trim()"
                  >
                    <template v-if="chatSending">Sending...</template>
                    <template v-else-if="currentPhaseData?.status === 'draft'">Request Changes</template>
                    <template v-else>Add Note</template>
                  </button>
                  <span v-if="currentPhaseData?.status === 'draft'" class="feedback-hint">
                    The agent will re-generate this phase using your feedback and the current draft
                  </span>
                </div>
              </div>
              <div v-if="feedbackRegenTriggered" class="feedback-regen-banner">
                <div class="feedback-regen-spinner"></div>
                <span>Revision requested — the agent is re-generating {{ formatPhase(selectedPhase!) }} with your feedback...</span>
              </div>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="empty-state" style="padding:24px">No spec data available.</div>

      <!-- Vibe Coding Section -->
      <div class="vibe-section" v-if="isSpecDone">
        <div class="vibe-section-header" @click="vibeExpanded = !vibeExpanded">
          <div class="vibe-header-left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <h2 style="margin:0">Vibe Coding</h2>
            <span class="badge badge-info" style="font-size:0.65rem">BETA</span>
          </div>
          <span class="collapse-toggle" :class="{ 'is-collapsed': !vibeExpanded }">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
        <div v-if="vibeExpanded" class="vibe-content">
          <p class="vibe-description">
            Make quick changes conversationally. The agent will handle code modifications in the background.
          </p>

          <!-- Chat History -->
          <div class="vibe-chat-history" ref="vibeChatContainer">
            <div v-if="!vibeMessages.length" class="vibe-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p>Start a conversation to make changes to your project</p>
            </div>
            <div
              v-for="(msg, idx) in vibeMessages"
              :key="idx"
              class="vibe-msg"
              :class="{ 'vibe-msg-user': msg.role === 'user', 'vibe-msg-agent': msg.role === 'agent' }"
            >
              <div class="vibe-msg-avatar">{{ msg.role === 'user' ? 'You' : 'AI' }}</div>
              <div class="vibe-msg-bubble">
                <div v-if="msg.role === 'agent'" class="vibe-msg-content" v-html="renderMarkdown(msg.content)"></div>
                <div v-else class="vibe-msg-content">{{ msg.content }}</div>
                <div class="vibe-msg-time">{{ msg.timestamp }}</div>
              </div>
            </div>
            <div v-if="vibeProcessing" class="vibe-msg vibe-msg-agent">
              <div class="vibe-msg-avatar">AI</div>
              <div class="vibe-msg-bubble">
                <div class="vibe-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- Chat Input -->
          <div class="vibe-chat-input">
            <textarea
              v-model="vibeInput"
              rows="2"
              placeholder="e.g. 'Add a loading spinner to the submit button' or 'Fix the header alignment'..."
              :disabled="vibeProcessing"
              @keydown.enter.exact.prevent="handleVibeSend"
            ></textarea>
            <button
              class="btn-sm btn-primary vibe-send-btn"
              @click="handleVibeSend"
              :disabled="vibeProcessing || !vibeInput.trim()"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>

          <!-- Finalize Button -->
          <div v-if="vibeMessages.length > 0" class="vibe-finalize">
            <button
              class="btn-sm btn-primary"
              @click="handleVibeFinalize"
              :disabled="vibeProcessing || vibeFinalizingSpec"
            >
              {{ vibeFinalizingSpec ? 'Updating spec...' : 'Finalize & Update Spec' }}
            </button>
            <span class="vibe-finalize-hint">Update requirements, design, and tasks based on this conversation</span>
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useJobsStore, useAIAgentsStore } from "../stores";
import { TERMINAL_STATUSES, SPEC_PHASE_ORDER, type SpecPhase, type SpecPhaseData, type SpecItem } from "@remote-kiro/common";
import { marked } from "marked";
import StatusChip from "../components/StatusChip.vue";
import { jobs as jobsApi, bedrock as bedrockApi } from "../api";
import { formatLocalDateTime, formatLocalTime } from "../format-date";

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch {
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

const POLL_INTERVAL_MS = 10_000;

const props = defineProps<{ jobId: string }>();
const vueRouter = useRouter();
const jobsStore = useJobsStore();
const aiAgentsStore = useAIAgentsStore();
const cancelling = ref(false);
const approving = ref(false);
const rejecting = ref(false);
const editingItems = ref(false);
const editableItems = ref<SpecItem[]>([]);
const selectedPhase = ref<SpecPhase | null>(null);
const showRejectDialog = ref(false);
const rejectReason = ref("");
const chatMessage = ref("");
const chatSending = ref(false);
const phaseMessages = ref<Array<{ messageId: string; message: string; sender: string; createdAt: string }>>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const collapsedSections = ref<Record<string, boolean>>({});

const reviewingCode = ref(false);
const showReviewPanel = ref(false);
const reviewPolling = ref(false);
const reviewCollapsed = ref(false);
const reviewError = ref<string | null>(null);
const selectedReviewAgentId = ref("");

const reviewAgentOptions = computed(() => aiAgentsStore.aiAgents);
const parentJobData = ref<{ reviewReport?: string | null; reviewOutcome?: string | null } | null>(null);
const reviewReportLoading = ref(false);
let reviewPollTimer: ReturnType<typeof setInterval> | null = null;

const isReviewJob = computed(() => jobsStore.current?.jobType === "review_pr");

// Auto-redirect review fix jobs to the dedicated page
watch(() => jobsStore.current?.jobType, (jt) => {
  if (jt === "implement_review_fix") {
    vueRouter.replace({ name: "review-fix", params: { jobId: props.jobId } });
  }
});
const fixingReview = ref(false);
const fixReviewJobId = ref<string | null>(null);
const fixJobPolling = ref(false);
const fixJobCompleted = ref(false);
let fixPollTimer: ReturnType<typeof setInterval> | null = null;
const canFixReview = computed(() => {
  const job = jobsStore.current;
  if (!job || isReviewJob.value) return false;
  if (!job.reviewReport) return false;
  if (job.reviewOutcome !== "REQUEST_CHANGES") return false;
  if (fixReviewJobId.value) return false;
  if (fixJobPolling.value) return false;
  if (fixJobCompleted.value) return false;
  return true;
});

const reviewHistoryEntries = computed(() => {
  const job = jobsStore.current;
  if (!job) return [];
  return (job.reviewHistory ?? []).slice().sort(
    (a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime(),
  );
});

const lastReviewedAt = computed(() => {
  const entries = reviewHistoryEntries.value;
  return entries.length > 0 ? entries[entries.length - 1].reviewedAt : null;
});

const mergedReviewReport = ref<string | null>(null);
const mergingReviews = ref(false);

const effectiveReviewReport = computed(() => {
  if (jobsStore.current?.reviewReport) return jobsStore.current.reviewReport;
  if (isReviewJob.value && parentJobData.value?.reviewReport) return parentJobData.value.reviewReport;
  return null;
});

const effectiveReviewOutcome = computed(() => {
  if (jobsStore.current?.reviewOutcome) return jobsStore.current.reviewOutcome;
  if (isReviewJob.value && parentJobData.value?.reviewOutcome) return parentJobData.value.reviewOutcome;
  return null;
});

function outcomeClass(outcome: string): string {
  if (outcome === "APPROVE") return "review-outcome-approve";
  if (outcome === "REQUEST_CHANGES") return "review-outcome-changes";
  return "review-outcome-comment";
}

const vibeExpanded = ref(false);
const vibeInput = ref("");
const vibeProcessing = ref(false);
const vibeFinalizingSpec = ref(false);
const vibeChatContainer = ref<HTMLElement | null>(null);
const vibeMessages = ref<Array<{ role: "user" | "agent"; content: string; timestamp: string }>>([]);
const vibeLoaded = ref(false);

const canCancel = computed(() => {
  const s = jobsStore.current?.status;
  return s && !TERMINAL_STATUSES.has(s as any);
});

const isSpecDone = computed(() => {
  if (!jobsStore.spec) return false;
  const phases = jobsStore.spec.phases;
  return phases?.tasks?.status === "approved" || jobsStore.current?.status === "COMPLETED";
});

const currentPhaseData = computed<SpecPhaseData | null>(() => {
  if (!jobsStore.spec || !selectedPhase.value) return null;
  return jobsStore.spec.phases[selectedPhase.value] ?? null;
});

watch(currentPhaseData, (pd) => {
  if (pd) {
    editableItems.value = pd.items.map((i) => ({ ...i }));
  }
});

watch(() => jobsStore.spec?.currentPhase, (cp) => {
  if (cp && !selectedPhase.value) {
    selectedPhase.value = cp;
  }
});

watch(selectedPhase, async (phase) => {
  feedbackRegenTriggered.value = false;
  if (phase) {
    try {
      phaseMessages.value = await jobsStore.getPhaseMessages(props.jobId, phase);
    } catch {
      phaseMessages.value = [];
    }
  }
});

const taskStats = computed(() => {
  if (!currentPhaseData.value || selectedPhase.value !== "tasks") return { total: 0, completed: 0, inProgress: 0 };
  const items = currentPhaseData.value.items;
  return {
    total: items.length,
    completed: items.filter((i: any) => i.taskStatus === "completed" || i.completed).length,
    inProgress: items.filter((i: any) => i.taskStatus === "in_progress").length,
  };
});

function taskStatusLabel(item: SpecItem): string {
  const s = (item as any).taskStatus;
  if (s === "completed" || item.completed) return "Completed";
  if (s === "in_progress") return "In Progress";
  if (s === "failed") return "Failed";
  return "Pending";
}

function taskStatusBadgeClass(item: SpecItem): string {
  const s = (item as any).taskStatus;
  if (s === "completed" || item.completed) return "task-chip-completed";
  if (s === "in_progress") return "task-chip-in-progress";
  if (s === "failed") return "task-chip-failed";
  return "task-chip-pending";
}

function formatPhase(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function phaseStatusBadgeClass(status: string): string {
  switch (status) {
    case "approved": return "badge-success";
    case "draft": return "badge-info";
    case "generating": return "badge-warning";
    case "rejected": return "badge-danger";
    default: return "badge-neutral";
  }
}

const specSectionsCollapsed = ref(false);

function toggleSectionCollapse(_phase: string) {
  specSectionsCollapsed.value = !specSectionsCollapsed.value;
  for (const p of SPEC_PHASE_ORDER) {
    collapsedSections.value[p] = specSectionsCollapsed.value;
  }
}

function loadAll() {
  jobsStore.fetchOne(props.jobId);
  jobsStore.fetchEvents(props.jobId);
  jobsStore.fetchArtifacts(props.jobId);
  jobsStore.fetchSpec(props.jobId);
}

async function mergeReviewReports() {
  const entries = reviewHistoryEntries.value;
  if (entries.length < 2 || mergingReviews.value) return;
  mergingReviews.value = true;
  try {
    const combined = entries.map((e, i) =>
      `--- Review #${i + 1} (${formatLocalDateTime(e.reviewedAt)}, outcome: ${e.reviewOutcome}) ---\n${e.reviewReport}`,
    ).join("\n\n");

    const result = await bedrockApi.improveText(
      `Merge the following ${entries.length} code review reports into a single consolidated review summary.\n` +
      `Show the overall status, list all unique findings (deduplicate if the same issue appears in multiple reviews), ` +
      `and note which findings have been resolved in later reviews vs which are still outstanding.\n` +
      `Use markdown formatting with ## headings. Start with a "## Consolidated Review Summary" heading.\n\n${combined}`,
      "description",
    );
    mergedReviewReport.value = result.improved;
  } catch {
    mergedReviewReport.value = null;
  } finally {
    mergingReviews.value = false;
  }
}

watch(reviewHistoryEntries, (entries) => {
  if (entries.length >= 2 && !mergedReviewReport.value && !mergingReviews.value) {
    mergeReviewReports();
  }
});

function initJob() {
  jobsStore.resetDetail();
  parentJobData.value = null;
  showReviewPanel.value = false;
  reviewCollapsed.value = false;
  reviewError.value = null;
  reviewPolling.value = false;
  fixReviewJobId.value = null;
  fixingReview.value = false;
  fixJobPolling.value = false;
  fixJobCompleted.value = false;
  stopFixJobPolling();
  mergedReviewReport.value = null;
  mergingReviews.value = false;
  selectedPhase.value = null;
  vibeLoaded.value = false;
  vibeMessages.value = [];
  vibeExpanded.value = false;
  stopReviewPolling();
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

onMounted(() => {
  initJob();
  aiAgentsStore.fetchAll();
});

watch(() => props.jobId, () => {
  initJob();
});

watch(() => jobsStore.current, async (job) => {
  if (job?.jobType === "review_pr" && job.parentJobId && job.parentJobId.length > 10 && !parentJobData.value) {
    reviewReportLoading.value = true;
    try {
      const parent = await jobsApi.get(job.parentJobId);
      parentJobData.value = { reviewReport: parent.reviewReport, reviewOutcome: parent.reviewOutcome };
    } catch { /* parent not accessible */ }
    reviewReportLoading.value = false;
  }
}, { immediate: true });

// Detect existing fix jobs from parent events
watch(() => jobsStore.events, async (events) => {
  if (fixReviewJobId.value || fixJobCompleted.value || fixJobPolling.value) return;
  const fixEvent = events.find(
    (e) => (e.metadata as any)?.action === "review_fix_created" && (e.metadata as any)?.fixJobId,
  );
  if (!fixEvent) return;
  const childFixId = (fixEvent.metadata as any).fixJobId as string;
  fixReviewJobId.value = childFixId;
  try {
    const fixJob = await jobsApi.get(childFixId);
    if (fixJob.status === "COMPLETED") {
      fixJobCompleted.value = true;
    } else if (!TERMINAL_STATUSES.has(fixJob.status as any)) {
      startFixJobPolling(childFixId);
    }
  } catch { /* ignore */ }
}, { immediate: true });

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  stopReviewPolling();
  stopFixJobPolling();
});

async function handleCancel() {
  cancelling.value = true;
  try {
    await jobsStore.cancel(props.jobId);
    loadAll();
  } finally {
    cancelling.value = false;
  }
}

async function handleApprove() {
  if (!selectedPhase.value) return;
  approving.value = true;
  try {
    const currentIdx = SPEC_PHASE_ORDER.indexOf(selectedPhase.value);
    await jobsStore.approvePhase(props.jobId, selectedPhase.value);
    loadAll();
    const nextPhase = SPEC_PHASE_ORDER[currentIdx + 1];
    if (nextPhase) {
      selectedPhase.value = nextPhase;
    }
  } finally {
    approving.value = false;
  }
}

async function handleReject() {
  if (!selectedPhase.value || !rejectReason.value.trim()) return;
  rejecting.value = true;
  try {
    await jobsStore.rejectPhase(props.jobId, selectedPhase.value, rejectReason.value.trim());
    showRejectDialog.value = false;
    rejectReason.value = "";
    loadAll();
  } finally {
    rejecting.value = false;
  }
}

async function toggleEdit() {
  if (editingItems.value && selectedPhase.value) {
    await jobsStore.updateSpecItems(props.jobId, selectedPhase.value, editableItems.value);
    editingItems.value = false;
    loadAll();
  } else {
    editingItems.value = true;
  }
}

const feedbackRegenTriggered = ref(false);

async function handlePostMessage() {
  if (!selectedPhase.value || !chatMessage.value.trim()) return;
  chatSending.value = true;
  feedbackRegenTriggered.value = false;
  try {
    const result = await jobsStore.postPhaseMessage(props.jobId, selectedPhase.value, chatMessage.value.trim());
    chatMessage.value = "";
    phaseMessages.value = await jobsStore.getPhaseMessages(props.jobId, selectedPhase.value);
    if (result?.regenerating) {
      feedbackRegenTriggered.value = true;
      loadAll();
    }
  } finally {
    chatSending.value = false;
  }
}

const reviewOutcomeClass = computed(() => {
  const outcome = effectiveReviewOutcome.value;
  if (outcome === "APPROVE") return "review-outcome-approve";
  if (outcome === "REQUEST_CHANGES") return "review-outcome-changes";
  return "review-outcome-comment";
});

async function handleFixReview() {
  fixingReview.value = true;
  reviewError.value = null;
  try {
    const resp = await jobsApi.triggerReviewFix(props.jobId);
    fixReviewJobId.value = resp.fixJobId;
    startFixJobPolling(resp.fixJobId);
  } catch (err: any) {
    reviewError.value = err.message ?? "Failed to create review fix job";
  } finally {
    fixingReview.value = false;
  }
}

function startFixJobPolling(fixJobId: string) {
  stopFixJobPolling();
  fixJobPolling.value = true;
  let attempts = 0;
  const maxAttempts = 120;
  fixPollTimer = setInterval(async () => {
    attempts++;
    try {
      const fixJob = await jobsApi.get(fixJobId);
      if (TERMINAL_STATUSES.has(fixJob.status as any)) {
        fixJobPolling.value = false;
        if (fixJob.status === "COMPLETED") {
          fixJobCompleted.value = true;
        }
        stopFixJobPolling();
        loadAll();
      } else if (attempts >= maxAttempts) {
        fixJobPolling.value = false;
        stopFixJobPolling();
      }
    } catch {
      // ignore polling errors
    }
  }, 5000);
}

function stopFixJobPolling() {
  if (fixPollTimer) {
    clearInterval(fixPollTimer);
    fixPollTimer = null;
  }
}

async function handleReviewCode() {
  reviewingCode.value = true;
  showReviewPanel.value = true;
  reviewPolling.value = true;
  reviewError.value = null;

  try {
    await jobsApi.triggerReview(props.jobId, selectedReviewAgentId.value || undefined);
    startReviewPolling();
  } catch (err: any) {
    reviewPolling.value = false;
    reviewError.value = err.message ?? "Failed to trigger review";
  } finally {
    reviewingCode.value = false;
  }
}

function startReviewPolling() {
  stopReviewPolling();
  let attempts = 0;
  const maxAttempts = 60; // ~5 minutes at 5s intervals
  reviewPollTimer = setInterval(async () => {
    attempts++;
    try {
      await jobsStore.fetchOne(props.jobId);
      if (jobsStore.current?.reviewReport) {
        reviewPolling.value = false;
        stopReviewPolling();
      } else if (attempts >= maxAttempts) {
        reviewPolling.value = false;
        reviewError.value = "Review timed out. Check the Jobs dashboard for the review job status.";
        stopReviewPolling();
      }
    } catch {
      // ignore polling errors
    }
  }, 5000);
}

function stopReviewPolling() {
  if (reviewPollTimer) {
    clearInterval(reviewPollTimer);
    reviewPollTimer = null;
  }
}

async function handleVibeSend() {
  const text = vibeInput.value.trim();
  if (!text || vibeProcessing.value) return;

  vibeMessages.value.push({
    role: "user",
    content: text,
    timestamp: new Date().toLocaleTimeString(),
  });
  vibeInput.value = "";
  vibeProcessing.value = true;

  await nextTick();
  scrollVibeToBottom();

  try {
    await jobsApi.postPhaseMessage(props.jobId, "vibe", text);

    const agentReply = `Got it! I'm working on: **${text}**\n\nI'll make the changes in the background. You can continue chatting or check the event timeline for progress.`;
    vibeMessages.value.push({
      role: "agent",
      content: agentReply,
      timestamp: new Date().toLocaleTimeString(),
    });
    // Persist the agent reply so it survives page reload
    await jobsApi.postPhaseMessage(props.jobId, "vibe", `[AGENT] ${agentReply}`);
  } catch (err: any) {
    const errReply = `Sorry, I encountered an error: ${err.message}. Please try again.`;
    vibeMessages.value.push({
      role: "agent",
      content: errReply,
      timestamp: new Date().toLocaleTimeString(),
    });
  } finally {
    vibeProcessing.value = false;
    await nextTick();
    scrollVibeToBottom();
  }
}

async function handleVibeFinalize() {
  vibeFinalizingSpec.value = true;
  try {
    const conversation = vibeMessages.value
      .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n\n");
    
    await jobsApi.postPhaseMessage(props.jobId, "vibe",
      `[FINALIZE] Based on the following conversation, update the requirements, design, and tasks:\n\n${conversation}`
    );

    const finalizeReply = "Spec update request submitted. The agent will update requirements, design, and tasks based on our conversation. Reloading spec...";
    vibeMessages.value.push({
      role: "agent",
      content: finalizeReply,
      timestamp: new Date().toLocaleTimeString(),
    });
    await jobsApi.postPhaseMessage(props.jobId, "vibe", `[AGENT] ${finalizeReply}`);

    setTimeout(() => loadAll(), 3000);
  } catch (err: any) {
    const errReply = `Failed to finalize: ${err.message}`;
    vibeMessages.value.push({
      role: "agent",
      content: errReply,
      timestamp: new Date().toLocaleTimeString(),
    });
  } finally {
    vibeFinalizingSpec.value = false;
    await nextTick();
    scrollVibeToBottom();
  }
}

watch(vibeExpanded, async (expanded) => {
  if (expanded && !vibeLoaded.value) {
    vibeLoaded.value = true;
    try {
      const result = await jobsApi.getPhaseMessages(props.jobId, "vibe");
      for (const msg of result.items) {
        const isAgent = msg.message.startsWith("[AGENT] ");
        vibeMessages.value.push({
          role: isAgent ? "agent" : "user",
          content: isAgent ? msg.message.slice(8) : msg.message,
          timestamp: new Date(msg.createdAt).toLocaleTimeString(),
        });
      }
      await nextTick();
      scrollVibeToBottom();
    } catch { /* first time - no messages */ }
  }
});

function scrollVibeToBottom() {
  if (vibeChatContainer.value) {
    vibeChatContainer.value.scrollTop = vibeChatContainer.value.scrollHeight;
  }
}
</script>

<style scoped>
/* ─── PR Banner ─── */
.pr-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
  border: 1px solid #a7f3d0;
  border-radius: var(--radius-lg, 14px);
  margin-bottom: 20px;
  box-shadow: 0 1px 3px rgba(16, 185, 129, 0.1);
}

.pr-banner-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #dcfce7;
  border-radius: 10px;
  color: #16a34a;
  flex-shrink: 0;
}

.pr-banner-content {
  flex: 1;
  min-width: 0;
}

.pr-banner-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #166534;
  margin-bottom: 4px;
}

.pr-banner-link {
  font-size: 0.875rem;
  color: #15803d;
  word-break: break-all;
  text-decoration: none;
  font-weight: 600;
}

.pr-banner-link:hover {
  text-decoration: underline;
}

.pr-banner-number {
  display: inline-block;
  padding: 1px 6px;
  background: #dcfce7;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #166534;
  margin-left: 6px;
}

.pr-banner-commit {
  font-size: 0.75rem;
  color: #16a34a;
  margin-top: 4px;
}

.pr-banner-commit code {
  background: #dcfce7;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.7rem;
}

.pr-banner-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: center;
}

.pr-banner-actions a {
  text-decoration: none;
  color: #fff;
}

.review-agent-select {
  padding: 4px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.75rem;
  background: #fff;
  max-width: 180px;
}

/* ─── Review Panel ─── */
.review-panel {
  margin-bottom: 20px;
  border: 1px solid #c7d2fe;
  background: #f5f3ff;
}

.review-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.review-panel-header h3 {
  font-size: 1rem;
  font-weight: 700;
  color: #4f46e5;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.review-panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.review-outcome-badge {
  display: inline-block;
  padding: 3px 10px;
  font-size: 0.68rem;
  font-weight: 700;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.review-outcome-approve {
  background: #dcfce7;
  color: #166534;
}

.review-outcome-changes {
  background: #fef3c7;
  color: #92400e;
}

.review-outcome-comment {
  background: #e0e7ff;
  color: #3730a3;
}

.review-polling {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px;
}

.review-polling-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid #e0e7ff;
  border-top-color: #4f46e5;
  animation: review-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes review-spin {
  to { transform: rotate(360deg); }
}

.review-polling-text strong {
  display: block;
  font-size: 0.9rem;
  color: #4f46e5;
  margin-bottom: 4px;
}

.review-polling-text p {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text-secondary, #6b7280);
}

.review-findings {
  font-size: 0.875rem;
  line-height: 1.65;
  max-height: 600px;
  overflow-y: auto;
  padding: 4px 0;
}

.review-findings :deep(h1) {
  font-size: 1.15rem;
  margin-top: 0;
  margin-bottom: 12px;
  color: #1e293b;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 8px;
}

.review-findings :deep(h2) {
  font-size: 1rem;
  margin-top: 20px;
  margin-bottom: 8px;
  color: #334155;
}

.review-findings :deep(h3) {
  font-size: 0.9rem;
  margin-top: 16px;
  margin-bottom: 6px;
  color: #475569;
  padding: 8px 12px;
  background: #eef2ff;
  border-radius: 6px;
  border-left: 3px solid #6366f1;
}

.review-findings :deep(ul) {
  padding-left: 20px;
}

.review-findings :deep(p) {
  margin: 0 0 8px;
}

.review-findings :deep(strong) {
  color: #1e293b;
}

.review-findings :deep(code) {
  background: #e0e7ff;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.82em;
}

.review-findings :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.82rem;
  margin: 8px 0;
}

.review-findings :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}

/* ─── Review Meta & History ─── */
.review-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-bg-secondary, #f1f5f9);
  border-bottom: 1px solid var(--color-border, #e2e8f0);
  font-size: 0.8rem;
  color: var(--color-text-secondary, #64748b);
}

.review-meta-label {
  font-weight: 600;
}

.review-meta-count {
  margin-left: auto;
  background: var(--color-primary, #4f46e5);
  color: white;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}

.review-history-details {
  border-top: 1px solid var(--color-border, #e2e8f0);
  padding: 0;
}

.review-history-details summary {
  padding: 10px 16px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary, #64748b);
  cursor: pointer;
  user-select: none;
}

.review-history-details summary:hover {
  background: var(--color-bg-secondary, #f1f5f9);
}

.review-history-entry {
  border-top: 1px solid var(--color-border, #e2e8f0);
}

.review-history-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--color-bg-secondary, #f8fafc);
  font-size: 0.78rem;
}

.review-history-num {
  font-weight: 700;
  color: var(--color-text-primary, #1e293b);
}

.review-history-date {
  margin-left: auto;
  color: var(--color-text-tertiary, #9ca3af);
  font-size: 0.72rem;
}

.review-history-body {
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--color-border, #e2e8f0);
}

/* ─── Fix Job Status ─── */
.fix-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #4f46e5;
  animation: fadeIn 0.3s ease;
}

.fix-status-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #e0e7ff;
  border-top-color: #4f46e5;
  animation: review-spin 0.8s linear infinite;
  flex-shrink: 0;
}

.fix-applied-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #059669;
  animation: fadeIn 0.3s ease;
}

/* ─── Collapse Toggle ─── */
.collapse-toggle {
  margin-left: auto;
  color: var(--color-text-tertiary, #9ca3af);
  transition: transform 0.2s;
  display: flex;
  align-items: center;
}

.collapse-toggle.is-collapsed {
  transform: rotate(-90deg);
}

/* ─── Design Document ─── */
.design-document {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  padding: 24px 28px;
  margin: 16px 0;
  background: var(--color-bg, #fff);
  max-height: 70vh;
  overflow-y: auto;
}

.design-edit {
  min-height: 400px;
}

/* ─── Spec Items ─── */
.spec-items-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 16px 0;
}

.spec-items-summary {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-text-secondary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.spec-item-card {
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  padding: 16px 20px;
  background: var(--color-bg-secondary, #f8fafc);
  transition: box-shadow 0.15s;
}

.spec-item-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.spec-item-card.is-completed {
  opacity: 0.75;
  border-left: 3px solid #22c55e;
}

.spec-item-card.is-in-progress {
  border-left: 3px solid #3b82f6;
  background: #eff6ff;
}

.spec-item-card.is-failed {
  border-left: 3px solid #ef4444;
  background: #fef2f2;
}

.task-progress-bar {
  height: 6px;
  background: var(--color-border, #e2e8f0);
  border-radius: 3px;
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #16a34a);
  border-radius: 3px;
  transition: width 0.4s ease;
}

.task-status-chip {
  display: inline-block;
  padding: 2px 10px;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.task-chip-completed {
  background: #dcfce7;
  color: #166534;
}

.task-chip-in-progress {
  background: #dbeafe;
  color: #1e40af;
  animation: pulse-bg 1.5s infinite;
}

.task-chip-failed {
  background: #fee2e2;
  color: #991b1b;
}

.task-chip-pending {
  background: #f1f5f9;
  color: #64748b;
}

@keyframes pulse-bg {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.spec-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.spec-item-badge {
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

.spec-item-body {
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--color-text, #1e293b);
}

.spec-item-body :deep(p) { margin: 0 0 8px; }
.spec-item-body :deep(p:last-child) { margin-bottom: 0; }
.spec-item-body :deep(strong) { color: var(--color-text-heading, #0f172a); }
.spec-item-body :deep(code) { background: var(--color-bg-code, #e2e8f0); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
.spec-item-body :deep(pre) { background: #1e293b; color: #e2e8f0; padding: 12px 16px; border-radius: 8px; overflow-x: auto; font-size: 0.82rem; margin: 8px 0; }
.spec-item-body :deep(pre code) { background: none; padding: 0; color: inherit; }
.spec-item-body :deep(table) { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 0.85rem; }
.spec-item-body :deep(th), .spec-item-body :deep(td) { border: 1px solid var(--color-border, #e2e8f0); padding: 6px 10px; text-align: left; }
.spec-item-body :deep(th) { background: var(--color-bg-tertiary, #f1f5f9); font-weight: 600; }
.spec-item-body :deep(ul), .spec-item-body :deep(ol) { margin: 4px 0; padding-left: 20px; }
.spec-item-body :deep(li) { margin-bottom: 2px; }

.spec-item-edit {
  width: 100%;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 10px;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 6px;
  resize: vertical;
}

/* ─── Phase Msg Sender ─── */
.phase-msg-sender {
  font-weight: 600;
  color: var(--color-primary, #4f46e5);
  font-size: 0.78rem;
  margin-right: 6px;
}

.btn-accent { background: #8b5cf6; color: #fff; border: none; border-radius: 6px; }
.btn-accent:hover { background: #7c3aed; }
.btn-accent:disabled { opacity: 0.6; cursor: not-allowed; }

.feedback-actions { display: flex; gap: 10px; align-items: center; margin-top: 6px; }
.feedback-hint {
  font-size: 0.72rem;
  color: var(--color-text-tertiary, #94a3b8);
  font-style: italic;
}

.feedback-regen-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  font-size: 0.82rem;
  color: #4f46e5;
  font-weight: 500;
  animation: fadeIn 0.3s ease;
}

.feedback-regen-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #e0e7ff;
  border-top-color: #4f46e5;
  animation: review-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ─── Vibe Coding Section ─── */
.vibe-section {
  margin-top: 32px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: var(--radius-lg, 14px);
  overflow: hidden;
  background: var(--color-surface, #fff);
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
}

.vibe-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  cursor: pointer;
  background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  transition: background 0.15s;
}

.vibe-section-header:hover {
  background: linear-gradient(135deg, #e0e7ff 0%, #ede9fe 100%);
}

.vibe-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-primary, #4f46e5);
}

.vibe-header-left h2 {
  font-size: 1rem;
  font-weight: 700;
}

.vibe-content {
  padding: 20px;
}

.vibe-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary, #6b7280);
  margin-bottom: 16px;
}

.vibe-chat-history {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 10px;
  padding: 16px;
  background: #fafbfc;
  margin-bottom: 12px;
  scroll-behavior: smooth;
}

.vibe-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: var(--color-text-tertiary, #9ca3af);
}

.vibe-empty p {
  font-size: 0.85rem;
}

.vibe-msg {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.vibe-msg:last-child {
  margin-bottom: 0;
}

.vibe-msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
  text-transform: uppercase;
}

.vibe-msg-user .vibe-msg-avatar {
  background: var(--color-primary, #4f46e5);
  color: #fff;
}

.vibe-msg-agent .vibe-msg-avatar {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
}

.vibe-msg-bubble {
  flex: 1;
  min-width: 0;
}

.vibe-msg-user .vibe-msg-bubble {
  background: var(--color-primary-light, #eef2ff);
  border: 1px solid #c7d2fe;
  border-radius: 12px 12px 12px 4px;
  padding: 10px 14px;
}

.vibe-msg-agent .vibe-msg-bubble {
  background: #fff;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}

.vibe-msg-content {
  font-size: 0.875rem;
  line-height: 1.55;
  color: var(--color-text, #111827);
}

.vibe-msg-content :deep(p) { margin: 0 0 6px; }
.vibe-msg-content :deep(p:last-child) { margin-bottom: 0; }
.vibe-msg-content :deep(strong) { color: var(--color-text, #111827); }
.vibe-msg-content :deep(code) { background: #e2e8f0; padding: 1px 4px; border-radius: 3px; font-size: 0.82em; }

.vibe-msg-time {
  font-size: 0.7rem;
  color: var(--color-text-tertiary, #9ca3af);
  margin-top: 4px;
}

/* Typing animation */
.vibe-typing {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.vibe-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary, #9ca3af);
  animation: vibe-bounce 1.4s infinite;
}

.vibe-typing span:nth-child(2) { animation-delay: 0.2s; }
.vibe-typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes vibe-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.vibe-chat-input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.vibe-chat-input textarea {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 10px;
  font-size: 0.85rem;
  resize: none;
  font-family: inherit;
  transition: border-color 0.15s;
}

.vibe-chat-input textarea:focus {
  outline: none;
  border-color: var(--color-primary, #4f46e5);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.vibe-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 !important;
  flex-shrink: 0;
}

.vibe-finalize {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border, #e5e7eb);
}

.vibe-finalize-hint {
  font-size: 0.78rem;
  color: var(--color-text-tertiary, #9ca3af);
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
