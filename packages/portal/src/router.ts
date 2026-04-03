// ─── Vue Router with Auth Guards ───

import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { isAuthenticated } from "./auth";

// Lazy-loaded route components (will be implemented in task 12)
const LoginPage = () => import("./views/LoginPage.vue");
const CallbackPage = () => import("./views/CallbackPage.vue");
const DashboardPage = () => import("./views/DashboardPage.vue");
const RepositoryListPage = () => import("./views/RepositoryListPage.vue");
const RepositoryDetailPage = () => import("./views/RepositoryDetailPage.vue");
const ProfileListPage = () => import("./views/ProfileListPage.vue");
const JobCreatePage = () => import("./views/JobCreatePage.vue");
const JobDetailPage = () => import("./views/JobDetailPage.vue");
const ReviewFixPage = () => import("./views/ReviewFixPage.vue");
const AdminPage = () => import("./views/AdminPage.vue");
const AIAgentsPage = () => import("./views/AIAgentsPage.vue");

const routes: RouteRecordRaw[] = [
  // ─── Public Routes ───
  {
    path: "/login",
    name: "login",
    component: LoginPage,
    meta: { public: true },
  },
  {
    path: "/callback",
    name: "callback",
    component: CallbackPage,
    meta: { public: true },
  },

  // ─── Protected Routes ───
  {
    path: "/",
    name: "dashboard",
    component: DashboardPage,
  },
  {
    path: "/repositories",
    name: "repositories",
    component: RepositoryListPage,
  },
  {
    path: "/repositories/:repoId",
    name: "repository-detail",
    component: RepositoryDetailPage,
    props: true,
  },
  {
    path: "/profiles",
    name: "profiles",
    component: ProfileListPage,
  },
  {
    path: "/jobs/create",
    name: "job-create",
    component: JobCreatePage,
  },
  {
    path: "/jobs/:jobId",
    name: "job-detail",
    component: JobDetailPage,
    props: true,
  },
  {
    path: "/jobs/:jobId/review-fix",
    name: "review-fix",
    component: ReviewFixPage,
    props: true,
  },
  {
    path: "/ai-agents",
    name: "ai-agents",
    component: AIAgentsPage,
  },
  {
    path: "/admin",
    name: "admin",
    component: AdminPage,
  },

  // ─── Catch-all redirect ───
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// ─── Navigation Guard ───
// Redirect unauthenticated users to login for protected routes

router.beforeEach((to, _from, next) => {
  const isPublicRoute = to.meta.public === true;

  if (!isPublicRoute && !isAuthenticated()) {
    next({ name: "login" });
  } else {
    next();
  }
});
