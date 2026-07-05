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
  // 変更差分は重いDOMになるため専用ページに分離する(issue #65)。
  {
    path: "/repos/:owner/:name/pull/:number/diff",
    name: "pull-diff",
    component: () => import("./views/PullDiffView.vue"),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
