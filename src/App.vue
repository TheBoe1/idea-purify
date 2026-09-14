<script setup lang="ts">
import AppMenu from './components/AppMenu.vue'
</script>
<template>
    <div class="common-layout">
        <el-container>
            <el-header>
                <AppMenu />
            </el-header>
            <el-container>
                <el-aside width="200px"></el-aside>
                <el-main>
                    <RouterView />
                </el-main>
                <el-footer></el-footer>
            </el-container>
        </el-container>
    </div>


</template>