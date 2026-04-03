<template>
  <!-- Login/Callback pages render without sidebar -->
  <template v-if="isPublicRoute">
    <router-view />
  </template>

  <!-- Authenticated layout with sidebar -->
  <div v-else class="app-layout">
    <aside class="app-sidebar">
      <div class="sidebar-brand">
        <h2><Zap :size="20" /> Remote Kiro</h2>
        <span>Remote Agent Portal</span>
      </div>
      <nav class="sidebar-nav">
        <router-link :to="{ name: 'dashboard' }">
          <LayoutDashboard :size="18" /> Dashboard
        </router-link>
        <router-link :to="{ name: 'repositories' }">
          <FolderGit2 :size="18" /> Repositories
        </router-link>
        <router-link :to="{ name: 'profiles' }">
          <Puzzle :size="18" /> Profiles
        </router-link>
        <router-link :to="{ name: 'ai-agents' }">
          <Bot :size="18" /> AI Agents
        </router-link>
        <router-link :to="{ name: 'job-create' }">
          <PlusCircle :size="18" /> New Job
        </router-link>
        <router-link :to="{ name: 'admin' }">
          <Settings :size="18" /> Admin
        </router-link>
      </nav>
      <div class="sidebar-footer">
        <button @click="handleLogout"><LogOut :size="16" /> Sign Out</button>
      </div>
    </aside>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { logout } from "./auth";
import {
  LayoutDashboard,
  FolderGit2,
  Puzzle,
  PlusCircle,
  Settings,
  LogOut,
  Zap,
  Bot,
} from "lucide-vue-next";

const route = useRoute();

const isPublicRoute = computed(() => route.meta.public === true);

function handleLogout() {
  logout();
}
</script>
