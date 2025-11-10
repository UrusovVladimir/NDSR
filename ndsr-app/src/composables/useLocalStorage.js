import { ref, watch} from 'vue'
export function useLocalStorage(key, defaultValue) {
    const value = ref(localStorage.getItem(key) 
        ? JSON.parse(localStorage.getItem(key)) 
        : defaultValue
    )
    
    watch(value, (newVal) => {
      localStorage.setItem(key, JSON.stringify(newVal))
    })
    
    return { value }
  }