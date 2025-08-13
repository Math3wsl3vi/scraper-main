import { ref, reactive, computed, watch, readonly } from 'vue'
import axios from 'axios'
import { useRuntimeConfig } from '#app'
import { useMatches } from './useMatches'
import { useNotifications } from './useNotifications'

const settings = ref({
  season: '2024/2025',
  linkStructure: 'https://www.bordtennisportalen.dk/DBTU/HoldTurnering/Stilling/#4.{season}.{pool}.{group}.{region}...',
  venues: 'Grøndal MultiCenter',
  autorun: true
})

const scraperStatus = reactive({
  isRunning: false,
  isScheduled: false,
  lastRun: null,
  currentActivity: '',
  linkLevelProgress: null,
  linkLevelStats: null,
  error: null
})

let autorunTimer = null
let midnightScheduler = null

export const useScraper = () => {
  const { addMatch, addMatches } = useMatches()
  const { addNotification } = useNotifications()

  const isScraping = ref(false)
  const scrapeProgress = ref(0)
  const scrapeError = ref(null)
  const lastScrape = ref(null)

  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase || 'http://localhost:3001'
  const axiosInstance = axios.create({ baseURL: `${apiBase}/api/scraper`, timeout: 30000 })

  const parseVenues = () => {
    if (!settings.value.venues) return []
    return settings.value.venues.split(/[;\n]/).map(v => v.trim()).filter(v => v.length > 0)
  }

  const generateBaseUrl = () => settings.value.linkStructure.replace('{season}', settings.value.season)

  const updateSettings = async (newSettings) => {
    Object.assign(settings.value, newSettings)
    if (newSettings.venues) await saveVenueSearch(newSettings.venues)
    if ('autorun' in newSettings) {
      if (newSettings.autorun) scheduleAutorun()
      else cancelAutorun()
    }
    try { localStorage.setItem('scraperSettings', JSON.stringify(settings.value)) } catch (e) { console.warn(e) }
  }

  const startScraping = async (config = {}) => {
    if (scraperStatus.isRunning) throw new Error('Scraper is already running')

    try {
      scraperStatus.isRunning = true
      scraperStatus.error = null
      scraperStatus.currentActivity = 'Starting scraper...'
      scraperStatus.lastRun = new Date().toISOString()
      isScraping.value = true
      scrapeProgress.value = 0

      const venues = config.venues || parseVenues()
      const baseUrl = config.linkStructure?.replace('{season}', config.season || settings.value.season) || generateBaseUrl()

      if (venues.length === 0) throw new Error('No venues specified')

      addNotification('Starting full scraper...', 'info')

      const response = await axiosInstance.post('/run-all-calendar-scraper', { season: settings.value.season, linkStructure: baseUrl, venue: venues[0], sessionId: `session_${Date.now()}` })
      const pollInterval = setInterval(async () => {
        const status = await axiosInstance.get('/get-scraper-progress', { params: { sessionId: response.data.sessionId, totalMatches: 100 } }) // Adjust totalMatches
        scrapeProgress.value = status.data.data.progress
        if (status.data.data.status === 'completed') {
          clearInterval(pollInterval)
          scraperStatus.linkLevelStats = { matches: status.data.data.totalMatches }
          scraperStatus.currentActivity = ''
          scraperStatus.isRunning = false
          isScraping.value = false
          lastScrape.value = new Date()
          addNotification(`Scraping completed! Found ${status.data.data.totalMatches} matches`, 'success')
        }
      }, 2000)

      return response.data
    } catch (error) {
      scraperStatus.error = error.response?.data?.message || error.message
      scraperStatus.currentActivity = `Scraping error: ${scraperStatus.error}`
      scrapeError.value = scraperStatus.error
      addNotification(`Scraping failed: ${scraperStatus.error}`, 'error')
      throw error
    } finally {
      scraperStatus.isRunning = false
      isScraping.value = false
    }
  }

  const testLinkNavigation = async () => {
    // Implement if backend supports a test endpoint
    throw new Error('Not implemented')
  }

  const scheduleAutorun = () => {
    cancelAutorun()
    if (!settings.value.autorun) return

    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0)
    const delay = midnight - now

    scraperStatus.isScheduled = true
    midnightScheduler = setTimeout(async () => {
      try { await startScraping() } catch (e) { console.error(e) }
      scheduleAutorun()
    }, delay)
    addNotification(`Autorun scheduled for midnight (in ${Math.floor(delay / 60000)} minutes)`, 'info')
  }

  const cancelAutorun = () => {
    if (midnightScheduler) {
      clearTimeout(midnightScheduler)
      midnightScheduler = null
    }
    scraperStatus.isScheduled = false
  }

  const saveVenueSearch = async (venue) => {
    try {
      await axiosInstance.post('/save-venue-search', { venue, search_time: new Date().toISOString() })
    } catch (error) {
      console.error('Failed to save venue:', error)
    }
  }

  const getLastVenue = async () => {
    try {
      const response = await axiosInstance.get('/get-last-venue')
      return response.data.venue
    } catch (error) {
      console.error('Failed to get last venue:', error)
      return null
    }
  }

  const initializeScraper = () => {
    try {
      const saved = localStorage.getItem('scraperSettings')
      if (saved) Object.assign(settings.value, JSON.parse(saved))
    } catch (e) { console.warn(e) }
    if (settings.value.autorun) scheduleAutorun()
  }

  const shutdownScraper = () => {
    cancelAutorun()
    scraperStatus.isRunning = false
    scraperStatus.isScheduled = false
  }

  const getScrapingStats = computed(() => ({
    isConfigured: parseVenues().length > 0,
    venueCount: parseVenues().length,
    lastRunStats: scraperStatus.linkLevelStats,
    isRunning: scraperStatus.isRunning,
    isScheduled: scraperStatus.isScheduled
  }))

  return { settings, scraperStatus: readonly(scraperStatus), isScraping, scrapeProgress, scrapeError, lastScrape, getScrapingStats, updateSettings, startScraping, testLinkNavigation, initializeScraper, shutdownScraper, saveVenueSearch, getLastVenue }}