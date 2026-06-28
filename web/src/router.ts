import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "dashboard", component: () => import("./views/DashboardView.vue") },
  { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
  {
    path: "/repos/:owner/:name",
    name: "repo",
    component: () => import("./views/RepoPullsView.vue"),
  },
  {
    path: "/repos/:owner/:name/settings",
    name: "repo-settings",
    component: () => import("./views/RepoSettingsView.vue"),
  },
  {
    path: "/repos/:owner/:name/pull/:number",
    name: "pull",
    component: () => import("./views/PullDetailView.vue"),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
