import { ref } from 'vue'

export const useMatches = () => {
  const matches = ref([])

  const addMatch = (match) => {
    matches.value.push(match)
  }

  const addMatches = (newMatches) => {
    matches.value = [...matches.value, ...newMatches]
  }

  const clearMatches = async () => {
    matches.value = []
  }

  return { matches, addMatch, addMatches, clearMatches }
}