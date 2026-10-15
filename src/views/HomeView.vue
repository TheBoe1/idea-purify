<script setup lang="ts">
import IdeaEntryPanel from '@/components/ideas/IdeaEntryPanel.vue'
import PageRegion from '@/components/workbench/PageRegion.vue'
</script>

<template>
    <IdeaEntryPanel input-id="idea-input" />
    <PageRegion page-key="home" region-key="after-entry" />
</template>
