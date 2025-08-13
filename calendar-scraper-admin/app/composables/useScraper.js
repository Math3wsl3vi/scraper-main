import { ref, reactive, computed, watch, readonly } from 'vue'
import axios from 'axios'
import { useRuntimeConfig } from '#app'
import { useMatches } from './useMatches'
import { useNotifications } from './useNotifications'

const settings = ref({
  season: '2024/2025',
  linkStructure: 'https://www.bordtennisportalen.dk/DBTU/HoldTurnering/Stilling/#3,42024,14802,4006,4004,98710,,4203,',
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
  error: null,
  pollInterval: null
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
  const apiPrefix = '/api/v1'
  
  // Create axios instance with correct base URL
  const axiosInstance = axios.create({
    baseURL: `${apiBase}${apiPrefix}/scraper`,
    timeout: 300000, // 5 minutes for long scraping operations
    headers: { 
      'Content-Type': 'application/json'
    }
  })

  // Add request/response interceptors for debugging
  axiosInstance.interceptors.request.use(
    (config) => {
      console.log(`🔄 Making request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`)
      if (config.data) {
        console.log('📦 Request data:', config.data)
      }
      if (config.params) {
        console.log('🔍 Request params:', config.params)
      }
      return config
    },
    (error) => {
      console.error('❌ Request error:', error)
      return Promise.reject(error)
    }
  )

  axiosInstance.interceptors.response.use(
    (response) => {
      console.log(`✅ Response ${response.status}:`, response.data)
      return response
    },
    (error) => {
      console.error('❌ Response error:', error.response?.status, error.response?.data)
      console.error('📍 Failed URL:', error.config?.url)
      return Promise.reject(error)
    }
  )

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
    try { 
      localStorage.setItem('scraperSettings', JSON.stringify(settings.value)) 
    } catch (e) { 
      console.warn('Failed to save settings to localStorage:', e) 
    }
  }

  const startScraping = async (config = {}) => {
    if (scraperStatus.isRunning) {
      throw new Error('Scraper is already running')
    }

    // Clear any existing polling interval
    if (scraperStatus.pollInterval) {
      clearInterval(scraperStatus.pollInterval)
      scraperStatus.pollInterval = null
    }

    try {
      scraperStatus.isRunning = true
      scraperStatus.error = null
      scraperStatus.currentActivity = 'Starting scraper...'
      scraperStatus.lastRun = new Date().toISOString()
      isScraping.value = true
      scrapeProgress.value = 0
      scrapeError.value = null

      const venues = config.venues || parseVenues()
      const currentSeason = config.season || settings.value.season
      const baseUrl = config.linkStructure?.replace('{season}', currentSeason) || generateBaseUrl()

      if (venues.length === 0) {
        throw new Error('No venues specified')
      }

      addNotification('Starting full scraper...', 'info')

      const sessionId = `session_${Date.now()}`
      
      console.log('🚀 Starting scraper with params:', {
        season: currentSeason,
        linkStructure: baseUrl,
        venue: venues[0],
        sessionId
      })

      // Make the main scraper request (fixed endpoint name)
      const response = await axiosInstance.post('/run-all-calendar-scraper', {
        season: currentSeason,
        linkStructure: baseUrl,
        venue: venues[0],
        sessionId
      })

      console.log('📥 Scraper response:', response.data)

      // Check if the response indicates success/failure immediately
      if (response.data.success === false) {
        throw new Error(response.data.message || 'Scraping failed')
      }

      // Start polling for progress (fixed endpoint name)
      scraperStatus.pollInterval = setInterval(async () => {
        try {
          const progressResponse = await axiosInstance.get('/scraper-progress', {
            params: { session_id: sessionId } // Fixed parameter name
          })
          
          console.log('📊 Progress response:', progressResponse.data)
          
          if (progressResponse.data.success) {
            const { data } = progressResponse.data
            const { progress = 0, message = '', status = 'running' } = data
            
            scraperStatus.linkLevelProgress = { 
              currentLevel: 4, 
              processed: progress, 
              total: 100, 
              percentage: progress,
              currentItem: message || 'Scraping matches...'
            }
            scrapeProgress.value = progress

            // Check if scraping is complete
            if (status === 'completed') {
              clearInterval(scraperStatus.pollInterval)
              scraperStatus.pollInterval = null
              
              // Handle successful completion
              const totalMatches = data.matches || 0
              scraperStatus.linkLevelStats = { matches: totalMatches }
              scraperStatus.currentActivity = ''
              scraperStatus.isRunning = false
              isScraping.value = false
              lastScrape.value = new Date()
              
              addNotification(`Scraping completed! Found ${totalMatches} matches`, 'success')
              
            } else if (status === 'failed') {
              clearInterval(scraperStatus.pollInterval)
              scraperStatus.pollInterval = null
              
              const errorMessage = message || 'Scraping failed'
              scraperStatus.error = errorMessage
              scraperStatus.isRunning = false
              isScraping.value = false
              scrapeError.value = errorMessage
              
              addNotification(`Scraping failed: ${errorMessage}`, 'error')
            }
          }
        } catch (progressError) {
          console.error('Progress polling error:', progressError)
          
          // Don't clear interval immediately on progress errors - might be temporary
          // But limit retries to avoid infinite polling
          if (!scraperStatus.progressErrorCount) {
            scraperStatus.progressErrorCount = 1
          } else {
            scraperStatus.progressErrorCount++
          }
          
          if (scraperStatus.progressErrorCount > 10) {
            clearInterval(scraperStatus.pollInterval)
            scraperStatus.pollInterval = null
            scraperStatus.isRunning = false
            isScraping.value = false
            
            addNotification(`Progress check failed repeatedly: ${progressError.message}`, 'error')
          }
        }
      }, 2000) // Poll every 2 seconds (less aggressive)

    } catch (error) {
      console.error('Scraping error:', error)
      
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error'
      scraperStatus.error = errorMessage
      scraperStatus.currentActivity = `Scraping error: ${errorMessage}`
      scraperStatus.isRunning = false
      isScraping.value = false
      scrapeError.value = errorMessage
      
      // Clear polling interval on error
      if (scraperStatus.pollInterval) {
        clearInterval(scraperStatus.pollInterval)
        scraperStatus.pollInterval = null
      }
      
      addNotification(`Scraping failed: ${errorMessage}`, 'error')
      throw error
    }
  }

  const testLinkNavigation = async () => {
    // Test endpoint - you can implement this if your backend supports it
    try {
      const response = await axiosInstance.get('/health-check')
      return response.data
    } catch (error) {
      console.error('Link navigation test failed:', error)
      throw new Error('Backend connection test failed')
    }
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
      try { 
        await startScraping() 
      } catch (e) { 
        console.error('Scheduled scraping failed:', e)
        addNotification(`Scheduled scraping failed: ${e.message}`, 'error')
      }
      scheduleAutorun() // Reschedule for next day
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
      await axiosInstance.post('/venue-search', { 
        venue, 
        searchTime: new Date().toISOString() // Fixed parameter name
      })
      console.log('✅ Venue saved successfully')
    } catch (error) {
      console.error('Failed to save venue:', error)
    }
  }

  const getLastVenue = async () => {
    try {
      const response = await axiosInstance.get('/last-venue')
      return response.data.venue
    } catch (error) {
      console.error('Failed to get last venue:', error)
      return null
    }
  }

  const stopScraping = () => {
    if (scraperStatus.pollInterval) {
      clearInterval(scraperStatus.pollInterval)
      scraperStatus.pollInterval = null
    }
    scraperStatus.isRunning = false
    scraperStatus.currentActivity = 'Scraping stopped'
    isScraping.value = false
    addNotification('Scraping stopped', 'info')
  }

  const initializeScraper = async () => {
    try {
      const saved = localStorage.getItem('scraperSettings')
      if (saved) {
        Object.assign(settings.value, JSON.parse(saved))
      }
    } catch (e) { 
      console.warn('Failed to load settings from localStorage:', e) 
    }
    
    if (settings.value.autorun) {
      scheduleAutorun()
    }

    // Test backend connection
    try {
      const healthResponse = await axios.get(`${apiBase}/health`, { timeout: 5000 })
      console.log('✅ Backend connection successful:', healthResponse.data)
      addNotification('Connected to scraper backend', 'success')
    } catch (error) {
      console.error('❌ Backend connection failed:', error)
      addNotification('Failed to connect to scraper backend. Make sure the server is running.', 'error')
    }
  }

  const shutdownScraper = () => {
    cancelAutorun()
    stopScraping()
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

  // Cleanup on unmount
  const cleanup = () => {
    shutdownScraper()
  }

  return { 
    settings, 
    scraperStatus: readonly(scraperStatus), 
    isScraping, 
    scrapeProgress, 
    scrapeError, 
    lastScrape, 
    getScrapingStats, 
    updateSettings, 
    startScraping, 
    stopScraping,
    testLinkNavigation, 
    initializeScraper, 
    shutdownScraper, 
    saveVenueSearch, 
    getLastVenue,
    cleanup
  }
}