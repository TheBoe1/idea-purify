<template>
  <el-timeline>
    <el-timeline-item
      v-for="(activity, index) in activities"
      :key="index"
      :timestamp="activity.timestamp"
    >
      {{ activity.content }}
    </el-timeline-item>
  </el-timeline>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { loadIdeas } from '@/api/ideas'
interface Activity {
  content: string
  timestamp: string
}
const activities = ref<Activity[]>([])

onMounted(async () => {
  const ideas = await  loadIdeas()
  console.log('Loaded ideas:', ideas)
})



</script>
