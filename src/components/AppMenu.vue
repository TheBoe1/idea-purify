<script setup lang="ts">
</script>
<template>
    <div id="MenuBar">
        <div id="MenuBarLeft">
            <router-link to="/" id="home-link">首页</router-link>
            <router-link to="/archive" id="archive-link">归档</router-link>
        </div>
    </div>
</template>
<style scoped>
#MenuBar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 50px;
    background-color: #f5f5f5;
    padding: 0 20px;
}

#home-link,
#archive-link {
    text-decoration: none;
    color: #333;
    font-size: 20px;
    margin-right: 40px;
}
</style>