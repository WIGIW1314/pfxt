<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { User, Lock } from "@element-plus/icons-vue";
import { useAuthStore } from "../stores/auth";
import { useSyncStore } from "../stores/sync";

const auth = useAuthStore();
const sync = useSyncStore();
const router = useRouter();
const loading = ref(false);
const logoUrl = "/api/assets/logo.svg";
const form = reactive({
  username: "",
  password: "",
});

async function submit() {
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    sync.connect();
    router.push(auth.isJudge ? "/judge/home" : "/admin/dashboard");
  } catch (error) {
    ElMessage.error("登录失败，请检查账号密码");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page-shell login-page">
    <section class="glass-panel login-card">
      <div class="login-header">
        <img :src="logoUrl" alt="logo" class="login-logo" />
        <h1 class="login-title">评分系统入口</h1>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入账号" autofocus :prefix-icon="User" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" class="login-submit" :loading="loading" @click="submit">登录</el-button>
      </el-form>

      <div class="login-home-wrap">
        <router-link to="/public/groups" class="login-home-link">返回公共首页</router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  display: grid;
  place-items: center;
  padding-bottom: 24px;
}

.login-card {
  width: min(420px, 100%);
  padding: 24px 22px 22px;
}

.login-header {
  margin-bottom: 20px;
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.login-logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.login-title {
  margin: 0;
  font-size: clamp(24px, 5.6vw, 32px);
  line-height: 1.1;
  color: var(--text);
}

.login-submit {
  width: 100%;
}

.login-home-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}

.login-home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 6px;
  background: rgba(64, 158, 255, 0.1);
  border: 1px solid rgba(64, 158, 255, 0.22);
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.login-home-link:hover {
  background: rgba(64, 158, 255, 0.16);
  border-color: rgba(64, 158, 255, 0.34);
  transform: translateY(-1px);
}

@media (max-width: 480px) {
  .login-card {
    padding: 20px 18px 18px;
  }

  .login-logo {
    width: 50px;
    height: 50px;
  }

  .login-home-link {
    width: 100%;
  }
}
</style>
