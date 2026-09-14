<template>
    <el-autocomplete v-model="state1" :fetch-suggestions="querySearch" clearable placeholder="请输入内容"
        @select="handleSelect" />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'

interface RestaurantItem {
    value: string
    link: string
}

const state1 = ref()

const restaurants = ref<RestaurantItem[]>([])
const querySearch = (queryString: string, cb: any) => {
    const results = queryString
        ? restaurants.value.filter(createFilter(queryString))
        : restaurants.value
    // call callback function to return suggestions
    cb(results)
}
const createFilter = (queryString: string) => {
    return (restaurant: RestaurantItem) => {
        return (
            restaurant.value.toLowerCase().indexOf(queryString.toLowerCase()) === 0
        )
    }
}
const loadAll = () => {
    return [
        { value: 'vue', link: 'https://github.com/vuejs/vue' },
        { value: 'element', link: 'https://github.com/ElemeFE/element' },
        { value: 'cooking', link: 'https://github.com/ElemeFE/cooking' },
        { value: 'mint-ui', link: 'https://github.com/ElemeFE/mint-ui' },
        { value: 'vuex', link: 'https://github.com/vuejs/vuex' },
        { value: 'vue-router', link: 'https://github.com/vuejs/vue-router' },
        { value: 'babel', link: 'https://github.com/babel/babel' },
        { value: 'bab222el', link: 'https://github.com/babel/babel' },
    ]
}

const handleSelect = (item: Record<string, any>) => {

}

onMounted(() => {
    restaurants.value = loadAll()
})
</script>

<style scoped>
.demo-autocomplete {
    display: flex;
    flex-wrap: wrap;
    gap: 2rem;
}
</style>
