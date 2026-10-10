<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessageBox, ElNotification } from 'element-plus'
import { loadUsers, setUserDisabled } from '@/api/auth'
import { authState } from '@/stores/auth'
import type { AuthUser } from '../../shared/contracts/auth.ts'

const isAdmin = computed(() => authState.user?.role === 'admin')
const users = ref<AuthUser[]>([])
const loading = ref(false)
const pendingUserId = ref('')
const errorMessage = ref('')
async function refresh() {
    if (loading.value || !isAdmin.value) return
    loading.value = true
    errorMessage.value = ''
    try { users.value = await loadUsers() }
    catch (error) { errorMessage.value = error instanceof Error ? error.message : '加载用户失败' }
    finally { loading.value = false }
}
async function toggleUser(user: AuthUser) {
    if (pendingUserId.value || user.role === 'admin' || user.userId === authState.user?.userId) return
    try { await ElMessageBox.confirm(`${user.disabled ? '启用' : '禁用'}用户 ${user.username}？`, '确认用户状态', { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' }) }
    catch { return }
    pendingUserId.value = user.userId
    try {
        const updated = await setUserDisabled(user.userId, !user.disabled)
        users.value = users.value.map(item => item.userId === updated.userId ? updated : item)
        ElNotification({ title: '修改成功', message: updated.disabled ? '用户已禁用，现有会话已失效。' : '用户已启用。', type: 'success' })
    } catch (error) { ElNotification({ title: '修改失败', message: error instanceof Error ? error.message : '请重试', type: 'error' }) }
    finally { pendingUserId.value = '' }
}
onMounted(refresh)
</script>

<template>
    <section class="admin-area">
        <el-alert v-if="!isAdmin" title="仅管理员可以管理用户" type="error" :closable="false" />
        <template v-else>
            <div class="page-header"><h1>用户管理</h1><el-button :loading="loading" @click="refresh">刷新</el-button></div>
            <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" />
            <el-table v-loading="loading" :data="users" empty-text="暂无用户" :aria-busy="loading">
                <el-table-column prop="username" label="用户名" min-width="140" />
                <el-table-column label="邮箱" min-width="220"><template #default="{ row }">{{ row.email ?? '未设置' }}<span v-if="row.email">（{{ row.emailVerified ? '已验证' : '未验证' }}）</span></template></el-table-column>
                <el-table-column label="角色" width="100"><template #default="{ row }">{{ row.role === 'admin' ? '管理员' : '用户' }}</template></el-table-column>
                <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.disabled ? 'danger' : 'success'">{{ row.disabled ? '已禁用' : '正常' }}</el-tag></template></el-table-column>
                <el-table-column label="操作" width="130"><template #default="{ row }"><el-button :type="row.disabled ? 'primary' : 'danger'" :disabled="Boolean(pendingUserId) || row.role === 'admin' || row.userId === authState.user?.userId" :loading="pendingUserId === row.userId" @click="toggleUser(row)">{{ row.disabled ? '启用' : '禁用' }}</el-button></template></el-table-column>
            </el-table>
        </template>
    </section>
</template>

<style scoped>
.admin-area { max-width: 1100px; margin: 24px auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.page-header h1 { margin: 0; }
</style>
