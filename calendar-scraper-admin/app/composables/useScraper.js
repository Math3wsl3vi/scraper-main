import { ref, reactive, computed, watch, readonly } from 'vue'
import axios from 'axios'
import { useRuntimeConfig } from '#app'
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

  // Additional state for API compatibility
  const isScraping = ref(false)
  const scrapeProgress = ref(0)
  const scrapeError = ref(null)
  const lastScrape = ref(null)

  // Configure axios with base URL from runtime config
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBase || 'http://localhost:3001'
  const axiosInstance = axios.create({
    baseURL: `${apiBase}/api/scraper`,
    timeout: 30000
  })

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
    Object.assign(settings.value, newSettings)
    if (newSettings.venues) {
      const venues = parseVenues()
      linkScraper.updateScraperVenues(venues)
    }
    if ('autorun' in newSettings) {
      if (newSettings.autorun) {
        scheduleAutorun()
      } else {
        cancelAutorun()
      }
    }
    try {
      localStorage.setItem('scraperSettings', JSON.stringify(settings.value))
    } catch (error) {
      console.warn('Could not save settings:', error)
    }
  }

  /**
   * Start the link-level scraping process using API only
   */
const startScraping = async (config = {}) => {
  if (scraperStatus.isRunning) {
    console.warn('[Scraper] Scraper is already running');
    throw new Error('Scraper is already running');
  }

  try {
    console.log('[Scraper] Starting scraping process...');
    scraperStatus.isRunning = true;
    scraperStatus.error = null;
    scraperStatus.currentActivity = 'Starting scraper...';
    scraperStatus.lastRun = new Date().toISOString();
    isScraping.value = true;
    scrapeError.value = null;
    scrapeProgress.value = 0;

    const venues = config.venues || parseVenues();
    const baseUrl = config.linkStructure?.replace('{season}', config.season || settings.value.season) || generateBaseUrl();

    if (venues.length === 0) {
      console.error('[Scraper] No venues specified for scraping');
      throw new Error('No venues specified for scraping');
    }

    console.log(`[Scraper] Using base URL: ${baseUrl}`);
    console.log(`[Scraper] Venues: ${venues.join(', ')}`);

    addNotification('Starting full scraper...', 'info');

    // Log the request payload
    const payload = {
      url: baseUrl,
      venues,
      season: config.season || settings.value.season
    };
    console.log('[Scraper] Sending request to API:', payload);

    const response = await axiosInstance.post('/status', payload);
    console.log('[Scraper] API Response:', response.data); // Log the response

    // Poll for progress
    const pollInterval = setInterval(async () => {
      try {
        const status = await axiosInstance.get('/status');
        console.log(`[Scraper] Polling status (Progress: ${status.data.progress || 0}%)`, status.data);

        scrapeProgress.value = status.data.progress || 0;

        if (status.data.completed) {
          clearInterval(pollInterval);
          console.log('[Scraper] Scraping completed!', status.data);

          scraperStatus.linkLevelStats = status.data.stats;
          scraperStatus.currentActivity = '';
          scraperStatus.isRunning = false;
          isScraping.value = false;
          lastScrape.value = new Date();

          if (status.data.matches && status.data.matches.length > 0) {
            console.log(`[Scraper] Found ${status.data.matches.length} matches`);
            await addMatches(status.data.matches.map(match => ({
              ...match,
              id: generateMatchId(match)
            })));
          }

          addNotification(`Scraping completed! Found ${status.data.matchCount || 0} matches`, 'success');
        }
      } catch (pollError) {
        console.error('[Scraper] Error polling scraper status:', pollError);
        scrapeError.value = pollError.message;
      }
    }, 2000);

    return response.data;
  } catch (error) {
    console.error('[Scraper] Error in startScraping:', error);
    scraperStatus.error = error.response?.data?.message || error.message;
    scraperStatus.currentActivity = `Scraping error: ${scraperStatus.error}`;
    scrapeError.value = scraperStatus.error;
    addNotification(`Scraping failed: ${scraperStatus.error}`, 'error');
    throw error;
  } finally {
    scraperStatus.isRunning = false;
    scraperStatus.linkLevelProgress = null;
    isScraping.value = false;
  }
};

  /**
   * Test link navigation using API
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

      // Initiate test via API (assuming a /test endpoint)
      const response = await axiosInstance.post('/test', {
        url: baseUrl,
        venues
      })

      // Update status with API response
      scraperStatus.linkLevelStats = response.data.stats
      scraperStatus.currentActivity = ''

      addNotification(
        `Link test completed! Structure: ${response.data.stats.unions} unions → ${response.data.stats.ageGroups} age groups → ${response.data.stats.pools} pools → ${response.data.stats.matches} matches`,
        'success'
      )

      return response.data
    } catch (error) {
      scraperStatus.error = error.response?.data?.message || error.message
      scraperStatus.currentActivity = `Test error: ${scraperStatus.error}`
      addNotification(`Link navigation test failed: ${scraperStatus.error}`, 'error')
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
    cancelAutorun()
    if (!settings.value.autorun) return

    const now = new Date()
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const timeUntilMidnight = midnight - now

    scraperStatus.isScheduled = true

    midnightScheduler = setTimeout(async () => {
      try {
        await startScraping()
        scheduleAutorun()
      } catch (error) {
        console.error('Autorun failed:', error)
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
    let hash = 0
    for (let i = 0; i < baseString.length; i++) {
      const char = baseString.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
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
  try {
    console.log('[Scraper] Initializing scraper...');
    const savedSettings = localStorage.getItem('scraperSettings');
    if (savedSettings) {
      console.log('[Scraper] Loading saved settings');
      Object.assign(settings.value, JSON.parse(savedSettings));
    }
  } catch (error) {
    console.warn('[Scraper] Could not load saved settings:', error);
  }

  const venues = parseVenues();
  console.log(`[Scraper] Initializing with venues: ${venues.join(', ')}`);
  linkScraper.initializeScraper(venues);

  if (settings.value.autorun) {
    console.log('[Scraper] Autorun enabled, scheduling...');
    scheduleAutorun();
  }
};

/**
 * Shutdown scraper
 */
const shutdownScraper = () => {
  cancelAutorun();
    scraperStatus.isRunning = false
    scraperStatus.isScheduled = false
    linkScraper.clearScrapingData()
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
    testLinkNavigation,
    initializeScraper,
    shutdownScraper,
    parseVenues,
    generateBaseUrl
  }
}