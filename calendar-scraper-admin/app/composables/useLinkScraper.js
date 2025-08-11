// composables/useLinkScraper.js
import { reactive, readonly } from 'vue'

export const useLinkScraper = () => {
  const currentProgress = reactive({
    level: 0,
    processed: 0,
    total: 0,
    activity: '',
    currentItem: ''
  })

  const scrapingResults = reactive({
    unions: [],
    ageGroups: [],
    pools: [],
    matches: []
  })

  const initializeScraper = (venues = []) => {
    // Store venues for client-side reference
    console.log('Initialized scraper with venues:', venues)
  }

  const updateScraperVenues = (venues) => {
    console.log('Updated venues:', venues)
  }

  const clearScrapingData = () => {
    scrapingResults.unions = []
    scrapingResults.ageGroups = []
    scrapingResults.pools = []
    scrapingResults.matches = []
    Object.assign(currentProgress, {
      level: 0,
      processed: 0,
      total: 0,
      activity: '',
      currentItem: ''
    })
  }

  const runLinkLevelsScraping = async (baseUrl, venues) => {
    try {
      // Simulate progress for UI
      const levels = [
        { level: 1, total: 1, activity: 'Discovering unions' },
        { level: 2, total: 10, activity: 'Discovering age groups' },
        { level: 3, total: 20, activity: 'Discovering pools' },
        { level: 4, total: 50, activity: 'Discovering matches' },
        { level: 5, total: 50, activity: 'Filtering by venue' }
      ]

      for (const { level, total, activity } of levels) {
        currentProgress.level = level
        currentProgress.total = total
        currentProgress.activity = activity
        for (let i = 0; i <= total; i++) {
          currentProgress.processed = i
          currentProgress.currentItem = `Processing ${activity.toLowerCase()} (${i}/${total})`
          await new Promise(resolve => setTimeout(resolve, 100)) // Simulate async work
        }
      }

      // Call server API
      const response = await $fetch('/api/scrape', {
        method: 'POST',
        body: { baseUrl, venues }
      })

      if (!response.success) {
        throw new Error(response.error)
      }

      Object.assign(scrapingResults, response.data)
      return response
    } finally {
      clearScrapingData()
    }
  }

  const testLinkNavigation = async (baseUrl, venues) => {
    try {
      // Simulate progress for UI
      const levels = [
        { level: 1, total: 1, activity: 'Testing unions' },
        { level: 2, total: 2, activity: 'Testing age groups' },
        { level: 3, total: 3, activity: 'Testing pools' },
        { level: 4, total: 3, activity: 'Testing matches' }
      ]

      for (const { level, total, activity } of levels) {
        currentProgress.level = level
        currentProgress.total = total
        currentProgress.activity = activity
        for (let i = 0; i <= total; i++) {
          currentProgress.processed = i
          currentProgress.currentItem = `Testing ${activity.toLowerCase()} (${i}/${total})`
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      // Call server API
      const response = await $fetch('/api/test-navigation', {
        method: 'POST',
        body: { baseUrl, venues }
      })

      if (!response.success) {
        throw new Error(response.error)
      }

      return response
    } finally {
      clearScrapingData()
    }
  }

  const getCurrentStats = () => ({
    unions: scrapingResults.unions.length,
    ageGroups: scrapingResults.ageGroups.length,
    pools: scrapingResults.pools.length,
    matches: scrapingResults.matches.length
  })

  return {
    currentProgress: readonly(currentProgress),
    scrapingResults: readonly(scrapingResults),
    initializeScraper,
    updateScraperVenues,
    runLinkLevelsScraping,
    testLinkNavigation,
    getCurrentStats,
    clearScrapingData
  }
}