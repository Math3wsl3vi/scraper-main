// composables/useScraper.js
import { ref, reactive, computed } from 'vue'
import { useLinkScraper } from './useLinkScraper'
import { useMatches } from './useMatches'
import { useNotifications } from './useNotifications'

// Global state
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

// Auto-run scheduler
let autorunTimer = null
let midnightScheduler = null

export const useScraper = () => {
  const linkScraper = useLinkScraper()
  const { addMatch, addMatches } = useMatches()
  const { addNotification } = useNotifications()

  /**
   * Generate base URL from link structure and season
   */
  const generateBaseUrl = () => {
    return settings.value.linkStructure.replace('{season}', settings.value.season)
  }

  /**
   * Parse venues from settings
   */
  const parseVenues = () => {
    if (!settings.value.venues) return []
    
    return settings.value.venues
      .split(/[;\n]/)
      .map(venue => venue.trim())
      .filter(venue => venue.length > 0)
  }

  /**
   * Update scraper settings
   */
  const updateSettings = async (newSettings) => {
    // Update settings
    Object.assign(settings.value, newSettings)
    
    // Update link scraper venues if venues changed
    if (newSettings.venues) {
      const venues = parseVenues()
      linkScraper.updateScraperVenues(venues)
    }
    
    // Reschedule autorun if autorun setting changed
    if ('autorun' in newSettings) {
      if (newSettings.autorun) {
        scheduleAutorun()
      } else {
        cancelAutorun()
      }
    }
    
    // Persist settings (you might want to save to localStorage/database)
    try {
      localStorage.setItem('scraperSettings', JSON.stringify(settings.value))
    } catch (error) {
      console.warn('Could not save settings:', error)
    }
  }

  /**
   * Start the link-level scraping process
   */
  const startScraping = async (options = {}) => {
    if (scraperStatus.isRunning) {
      throw new Error('Scraper is already running')
    }

    try {
      scraperStatus.isRunning = true
      scraperStatus.error = null
      scraperStatus.currentActivity = 'Initializing scraper...'
      
      // Use options or fall back to current settings
      const venues = options.venues || parseVenues()
      const baseUrl = options.baseUrl || generateBaseUrl()
      
      if (venues.length === 0) {
        throw new Error('No venues specified for scraping')
      }
      
      addNotification(`Starting scraper for ${venues.length} venue(s)`, 'info')
      
      // Set up progress monitoring
      const progressUnwatch = linkScraper.currentProgress.value && 
        watch(linkScraper.currentProgress, (progress) => {
          if (progress) {
            scraperStatus.linkLevelProgress = progress
            scraperStatus.currentActivity = `${progress.activity}: ${progress.currentItem}`
          }
        }, { immediate: true })

      // Run the link levels scraping
      const results = await linkScraper.runLinkLevelsScraping(baseUrl, venues)
      
      // Process results
      if (results.data.matches && results.data.matches.length > 0) {
        // Add matches to the matches store
        await addMatches(results.data.matches.map(match => ({
          ...match,
          id: generateMatchId(match),
          scrapedAt: new Date().toISOString()
        })))
      }
      
      // Update status
      scraperStatus.lastRun = new Date().toISOString()
      scraperStatus.linkLevelStats = results.stats
      scraperStatus.currentActivity = ''
      
      addNotification(
        `Scraping completed! Found ${results.stats.matches} matches across ${results.stats.pools} pools`,
        'success'
      )
      
      return results
      
    } catch (error) {
      scraperStatus.error = error.message
      scraperStatus.currentActivity = `Error: ${error.message}`
      
      addNotification(`Scraping failed: ${error.message}`, 'error')
      throw error
      
    } finally {
      scraperStatus.isRunning = false
      scraperStatus.linkLevelProgress = null
      
      // Clean up progress watcher
      if (progressUnwatch) {
        progressUnwatch()
      }
    }
  }

  /**
   * Test link navigation
   */
  const testLinkNavigation = async () => {
    if (scraperStatus.isRunning) {
      throw new Error('Scraper is already running')
    }

    try {
      scraperStatus.isRunning = true
      scraperStatus.error = null
      scraperStatus.currentActivity = 'Testing link navigation...'
      
      const venues = parseVenues()
      const baseUrl = generateBaseUrl()
      
      if (venues.length === 0) {
        throw new Error('No venues specified for testing')
      }
      
      addNotification('Starting link navigation test...', 'info')
      
      // Set up progress monitoring
      const progressUnwatch = watch(linkScraper.currentProgress, (progress) => {
        if (progress) {
          scraperStatus.linkLevelProgress = progress
          scraperStatus.currentActivity = `Testing ${progress.activity}: ${progress.currentItem}`
        }
      }, { immediate: true })
      
      // Run the test
      const results = await linkScraper.testLinkNavigation(baseUrl, venues)
      
      // Update status
      scraperStatus.linkLevelStats = results.stats
      scraperStatus.currentActivity = ''
      
      addNotification(
        `Link test completed! Structure: ${results.stats.unions} unions → ${results.stats.ageGroups} age groups → ${results.stats.pools} pools → ${results.stats.matches} matches`,
        'success'
      )
      
      return results
      
    } catch (error) {
      scraperStatus.error = error.message
      scraperStatus.currentActivity = `Test error: ${error.message}`
      
      addNotification(`Link navigation test failed: ${error.message}`, 'error')
      throw error
      
    } finally {
      scraperStatus.isRunning = false
      scraperStatus.linkLevelProgress = null
    }
  }

  /**
   * Schedule autorun at midnight
   */
  const scheduleAutorun = () => {
    cancelAutorun() // Clear any existing schedule
    
    if (!settings.value.autorun) return
    
    const now = new Date()
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0) // Next midnight
    
    const timeUntilMidnight = midnight - now
    
    scraperStatus.isScheduled = true
    
    midnightScheduler = setTimeout(async () => {
      try {
        await startScraping()
        // Reschedule for next midnight
        scheduleAutorun()
      } catch (error) {
        console.error('Autorun failed:', error)
        // Still reschedule for next attempt
        scheduleAutorun()
      }
    }, timeUntilMidnight)
    
    addNotification(
      `Autorun scheduled for midnight (in ${Math.floor(timeUntilMidnight / (1000 * 60))} minutes)`,
      'info'
    )
  }

  /**
   * Cancel autorun scheduling
   */
  const cancelAutorun = () => {
    if (midnightScheduler) {
      clearTimeout(midnightScheduler)
      midnightScheduler = null
    }
    scraperStatus.isScheduled = false
  }

  /**
   * Generate unique match ID
   */
  const generateMatchId = (match) => {
    const baseString = `${match.date}_${match.time}_${match.homeTeam}_${match.awayTeam}_${match.venue}`
    // Simple hash function
    let hash = 0
    for (let i = 0; i < baseString.length; i++) {
      const char = baseString.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16)
  }

  /**
   * Get scraping statistics
   */
  const getScrapingStats = computed(() => {
    return {
      isConfigured: parseVenues().length > 0,
      venueCount: parseVenues().length,
      lastRunStats: scraperStatus.linkLevelStats,
      isRunning: scraperStatus.isRunning,
      isScheduled: scraperStatus.isScheduled
    }
  })

  /**
   * Initialize scraper on first load
   */
  const initializeScraper = () => {
    // Load settings from localStorage
    try {
      const savedSettings = localStorage.getItem('scraperSettings')
      if (savedSettings) {
        Object.assign(settings.value, JSON.parse(savedSettings))
      }
    } catch (error) {
      console.warn('Could not load saved settings:', error)
    }
    
    // Initialize link scraper with current venues
    const venues = parseVenues()
    linkScraper.initializeScraper(venues)
    
    // Schedule autorun if enabled
    if (settings.value.autorun) {
      scheduleAutorun()
    }
  }

  /**
   * Shutdown scraper
   */
  const shutdownScraper = () => {
    cancelAutorun()
    scraperStatus.isRunning = false
    scraperStatus.isScheduled = false
    linkScraper.clearScrapingData()
  }

  return {
    // State
    settings,
    scraperStatus: readonly(scraperStatus),
    
    // Computed
    getScrapingStats,
    
    // Methods
    updateSettings,
    startScraping,
    testLinkNavigation,
    initializeScraper,
    shutdownScraper,
    
    // Utilities
    parseVenues,
    generateBaseUrl
  }
}