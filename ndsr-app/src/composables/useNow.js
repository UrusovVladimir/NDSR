// Общие «часы» страницы: одна реактивная метка времени на всех подписчиков,
// а не setInterval в каждой строке таблицы. Тикает, пока есть подписчики.
import { ref, onMounted, onBeforeUnmount } from 'vue'

const now = ref(Date.now())
let timer = null
let subscribers = 0

export function useNow(intervalMs = 30000) {
  onMounted(() => {
    if (subscribers++ === 0) {
      now.value = Date.now()
      timer = setInterval(() => { now.value = Date.now() }, intervalMs)
    }
  })
  onBeforeUnmount(() => {
    if (--subscribers === 0) {
      clearInterval(timer)
      timer = null
    }
  })
  return now
}
