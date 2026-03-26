import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/", redirect: "/public/groups" },
    {
      path: "/public/:section?",
      component: () => import("./views/PublicView.vue"),
      meta: { public: true },
    },
    {
      path: "/admin/:section?",
      component: () => import("./views/AdminView.vue"),
      meta: { requiresAuth: true, roles: ["ACTIVITY_ADMIN", "SUPER_ADMIN"] },
    },
    {
      path: "/judge/:section?",
      component: () => import("./views/JudgeView.vue"),
      meta: { requiresAuth: true, roles: ["JUDGE", "SECRETARY"] },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized && auth.token) {
    await auth.fetchMe();
  }

  if (to.meta.public) {
    return true;
  }

  if (to.meta.requiresAuth && !auth.user) {
    return "/login";
  }

  const roles = (to.meta.roles as string[] | undefined) || [];
  if (roles.length && auth.user && !roles.includes(auth.user.role)) {
    return auth.user.role === "JUDGE" || auth.user.role === "SECRETARY" ? "/judge/home" : "/admin/dashboard";
  }

  if (to.path === "/login" && auth.user) {
    return auth.user.role === "JUDGE" || auth.user.role === "SECRETARY" ? "/judge/home" : "/admin/dashboard";
  }

  return true;
});

export { router };
