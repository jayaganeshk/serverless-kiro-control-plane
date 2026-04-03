<template>
  <div class="callback-page">
    <p>Completing sign-in...</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { handleCallback } from "../auth";

const router = useRouter();

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (!code) {
    router.replace({ name: "login" });
    return;
  }

  const success = await handleCallback(code);
  if (success) {
    router.replace({ name: "dashboard" });
  } else {
    router.replace({ name: "login" });
  }
});
</script>
