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
  <div class="page-shell" style="display: grid; place-items: center; padding-bottom: 24px">
    <section class="glass-panel" style="width: min(420px, 100%); padding: 22px">
      <div style="margin-bottom: 18px; display: flex; align-items: center; gap: 10px">
        <img :src="logoUrl" alt="logo" style="width: 38px; height: 38px" />
        <h1 style="margin: 0">线上评分系统</h1>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入账号" autofocus :prefix-icon="User" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" style="width: 100%" :loading="loading" @click="submit">登录</el-button>
      </el-form>

      

      <div style="margin-top: 14px; text-align: center">
        <router-link to="/public/groups" style="color: var(--primary); font-size: 13px; text-decoration: none">← 回到首页</router-link>
      </div>
    </section>
  </div>
</template>
