<template>
  <span class="status-chip" :class="chipClass" :title="status">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();

const chipClass = computed(() => {
  switch (props.status) {
    case "QUEUED": return "chip-queued";
    case "CLAIMED": return "chip-claimed";
    case "RUNNING": return "chip-running";
    case "AWAITING_APPROVAL": return "chip-awaiting";
    case "COMPLETED": return "chip-completed";
    case "FAILED": return "chip-failed";
    case "CANCELLED": return "chip-cancelled";
    case "TIMED_OUT": return "chip-timed-out";
    default: return "chip-queued";
  }
});

const label = computed(() => {
  return props.status.replace(/_/g, ' ');
});
</script>

<style scoped>
.status-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.chip-queued {
  background: #f3f4f6;
  color: #6b7280;
  border: 1px solid #e5e7eb;
}
.chip-claimed {
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #bfdbfe;
}
.chip-running {
  background: #eef2ff;
  color: #4f46e5;
  border: 1px solid #c7d2fe;
}
.chip-awaiting {
  background: #fffbeb;
  color: #d97706;
  border: 1px solid #fde68a;
}
.chip-completed {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.chip-failed {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.chip-cancelled {
  background: #fff7ed;
  color: #ea580c;
  border: 1px solid #fed7aa;
}
.chip-timed-out {
  background: #fffbeb;
  color: #b45309;
  border: 1px solid #fde68a;
}
</style>
