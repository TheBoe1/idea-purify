<script lang="ts" setup>
import {  onMounted, ref } from 'vue'
import { ElNotification } from 'element-plus'
import { loadAll } from '@/api/ideas'
import type { IdeaSuggestion, Idea } from '@/types/idea'

const suggestions = ref<IdeaSuggestion[]>([])
const ideaText = ref('')
const loading1 = ref(false)

const querySearch = (queryString: string, cb: any) => {
    const results = queryString
    ? suggestions.value.filter(createFilter(queryString))
    : suggestions.value

    cb(results)
}
const createFilter = (queryString: string) => {
    return (ideaSuggestion: IdeaSuggestion) => {
        return (
            queryString.length >= 2 &&
            ideaSuggestion.ideaContent.toLowerCase().indexOf(queryString.toLowerCase()) != -1

        )
    }
}


const handleSelect = (idea: Idea) => {
    console.log('Selected:', idea)
}
const handleSubmit = async () => {

    if (!ideaText.value.trim().length) {
        ElNotification({
            title: '告警',
            message: '请勿输入空格',
            type: 'error',
        })
        return
    }
    if (ideaText.value.trim().length < 2) {
        ElNotification({
            title: '告警',
            message: '请输入至少两个字符',
            type: 'warning',
        })
        return
    }
    if (ideaText.value) {
        loading1.value = true
        try {
            const createIdeaRequest: IdeaSuggestion = {
                ideaContent: ideaText.value,
            }
            const responseidea = await fetch('/api/idea', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(createIdeaRequest),
            })
            console.log('Node 返回：responseidea', responseidea)
            const result = await responseidea.json()

            console.log('Node 返回：result', result)
            ElNotification({
                title: 'Success',
                message: '成功提交想法',
                type: 'success',
            })
            ideaText.value = ''
            loading1.value = false

        } catch (error) {
            console.error('Error submitting idea:', error)
            ElNotification({
                title: 'Error',
                message: '提交想法时出错',
                type: 'error',
            })
            loading1.value = false
        }

    } else {
        ElNotification({
            title: '告警',
            message: '请输入内容',
            type: 'warning',
        })
        return

    }


}
onMounted(async () => {
    const defaultIdeas = loadAll()

    // restaurants.value = [
    //     ...defaultIdeas,
    //     ...ideas
    // ]
    suggestions.value = defaultIdeas
    console.log('suggestions', suggestions.value)
})
</script>


<template>
    <div class="idea-area">
        <div class="idea-input">
            <div class="idea-title">请输入一个想法</div>
            <div v-loading="loading1" class="loading">
                <el-autocomplete v-model="ideaText" :fetch-suggestions="querySearch" value-key="ideaContent" :trigger-on-focus="false" clearable
                    class="w-50" placeholder="Please Input" @select="handleSelect" />
                <div class="idea-commit">
                    <el-button type="primary" @click="handleSubmit">提交</el-button>
                </div>
            </div>
        </div>

    </div>
</template>

<style scoped>
.loading {
    width: 200px;
    height: 200px;
}

.idea-area {

    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 2rem;
}

.idea-title {
    font-size: 1.825rem;
    min-height: 2.5em;
    justify-content: center;
    display: flex;
    align-items: center;
}

.idea-input {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.idea-commit {
    transform: translateY(20px);
}

@media screen and (max-width: 768px) {
    .demo-autocomplete {
        gap: 1rem;
    }

    .demo-block {
        width: 100%;
    }
}
</style>