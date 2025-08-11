// composables/useLinkScraper.js
import { ref, computed } from 'vue'

const scraperInstance = ref(null)
const isInitialized = ref(false)
const currentProgress = ref(null)
const scrapingResults = ref({
  unions: [],
  ageGroups: [],
  pools: [],
  matches: []
})

export const useLinkScraper = () => {
  
  /**
   * Link Levels Scraper Class (Browser-compatible version)
   */
  class TournamentLinkScraper {
    constructor(venues = []) {
      this.venues = venues
      this.lastUsedVenues = [...venues]
      this.currentLevel = 0
      this.scrapingData = {
        unions: new Map(),
        ageGroups: new Map(),
        pools: new Map(),
        matches: []
      }
      this.progressCallback = null
      this.config = {
        maxRetries: 3,
        delayBetweenRequests: 2000,
        maxUnionsToProcess: 2, // Limit for testing
        maxAgeGroupsToProcess: 3,
        maxPoolsToProcess: 10
      }
    }

    setProgressCallback(callback) {
      this.progressCallback = callback
    }

    updateProgress(level, processed, total, currentItem, activity) {
      this.currentLevel = level
      if (this.progressCallback) {
        this.progressCallback({
          level,
          currentLevel: this.getLevelName(level),
          processed,
          total,
          currentItem,
          activity
        })
      }
    }

    getLevelName(level) {
      const names = {
        1: 'Unions',
        2: 'Age Groups',
        3: 'Pools',
        4: 'Matches',
        5: 'Venue Filtering'
      }
      return names[level] || 'Processing'
    }

    setVenues(venues) {
      this.venues = venues
      this.lastUsedVenues = [...venues]
    }

    /**
     * Level 1: Discover Unions
     */
    async scrapeLevel1Unions(baseUrl) {
      this.updateProgress(1, 0, 1, 'Loading tournament page...', 'Discovering unions')
      
      try {
        // Simulate fetching the main page
        await this.delay(1000)
        
        // Mock union discovery - replace with actual scraping logic
        const mockUnions = [
          { name: 'DBTU Øst', url: baseUrl + '/union/east', level: 'union' },
          { name: 'DBTU Vest', url: baseUrl + '/union/west', level: 'union' },
          { name: 'DBTU Nord', url: baseUrl + '/union/north', level: 'union' }
        ]
        
        for (const union of mockUnions) {
          this.scrapingData.unions.set(union.name, union)
        }
        
        this.updateProgress(1, 1, 1, `Found ${mockUnions.length} unions`, 'Unions discovered')
        
        return Array.from(this.scrapingData.unions.values())
      } catch (error) {
        console.error('Level 1 error:', error)
        throw error
      }
    }

    /**
     * Level 2: Discover Age Groups within Unions
     */
    async scrapeLevel2AgeGroups(unions) {
      this.updateProgress(2, 0, unions.length, 'Processing unions...', 'Discovering age groups')
      
      const processedUnions = unions.slice(0, this.config.maxUnionsToProcess)
      
      for (let i = 0; i < processedUnions.length; i++) {
        const union = processedUnions[i]
        this.updateProgress(2, i, processedUnions.length, `Processing ${union.name}...`, 'Discovering age groups')
        
        await this.delay(this.config.delayBetweenRequests)
        
        // Mock age group discovery
        const mockAgeGroups = [
          { name: 'Senior', url: union.url + '/senior', parentUnion: union.name, level: 'ageGroup' },
          { name: 'Junior', url: union.url + '/junior', parentUnion: union.name, level: 'ageGroup' },
          { name: 'Veteran', url: union.url + '/veteran', parentUnion: union.name, level: 'ageGroup' },
          { name: 'Youth', url: union.url + '/youth', parentUnion: union.name, level: 'ageGroup' }
        ]
        
        for (const ageGroup of mockAgeGroups) {
          this.scrapingData.ageGroups.set(`${union.name}_${ageGroup.name}`, ageGroup)
        }
      }
      
      const totalAgeGroups = Array.from(this.scrapingData.ageGroups.values())
      this.updateProgress(2, processedUnions.length, processedUnions.length, 
        `Found ${totalAgeGroups.length} age groups`, 'Age groups discovered')
      
      return totalAgeGroups
    }

    /**
     * Level 3: Discover Pools within Age Groups
     */
    async scrapeLevel3Pools(ageGroups) {
      this.updateProgress(3, 0, ageGroups.length, 'Processing age groups...', 'Discovering pools')
      
      const processedAgeGroups = ageGroups.slice(0, this.config.maxAgeGroupsToProcess)
      
      for (let i = 0; i < processedAgeGroups.length; i++) {
        const ageGroup = processedAgeGroups[i]
        this.updateProgress(3, i, processedAgeGroups.length, 
          `Processing ${ageGroup.name}...`, 'Discovering pools')
        
        await this.delay(this.config.delayBetweenRequests)
        
        // Mock pool discovery
        const mockPools = [
          { name: 'Pool A', url: ageGroup.url + '/pool-a', parentAgeGroup: ageGroup.name, level: 'pool' },
          { name: 'Pool B', url: ageGroup.url + '/pool-b', parentAgeGroup: ageGroup.name, level: 'pool' },
          { name: 'Pool C', url: ageGroup.url + '/pool-c', parentAgeGroup: ageGroup.name, level: 'pool' }
        ]
        
        for (const pool of mockPools) {
          this.scrapingData.pools.set(`${ageGroup.name}_${pool.name}`, pool)
        }
      }
      
      const totalPools = Array.from(this.scrapingData.pools.values())
      this.updateProgress(3, processedAgeGroups.length, processedAgeGroups.length, 
        `Found ${totalPools.length} pools`, 'Pools discovered')
      
      return totalPools
    }

    /**
     * Level 4-5: Discover and Filter Matches
     */
    async scrapeLevel4And5Matches(pools) {
      this.updateProgress(4, 0, pools.length, 'Processing pools...', 'Discovering matches')
      
      const processedPools = pools.slice(0, this.config.maxPoolsToProcess)
      let allMatches = []
      
      for (let i = 0; i < processedPools.length; i++) {
        const pool = processedPools[i]
        this.updateProgress(4, i, processedPools.length, 
          `Processing ${pool.name}...`, 'Discovering matches')
        
        await this.delay(this.config.delayBetweenRequests)
        
        // Mock match discovery with venue filtering
        const mockMatches = [
          {
            date: '2024-12-15',
            time: '19:00',
            homeTeam: 'Team Alpha',
            awayTeam: 'Team Beta',
            venue: 'Grøndal MultiCenter',
            status: 'scheduled',
            pool: pool.name,
            ageGroup: pool.parentAgeGroup
          },
          {
            date: '2024-12-16',
            time: '20:00',
            homeTeam: 'Team Gamma',
            awayTeam: 'Team Delta',
            venue: 'Grøndal MultiCenter, lokale 28',
            status: 'scheduled',
            pool: pool.name,
            ageGroup: pool.parentAgeGroup
          },
          {
            date: '2024-12-17',
            time: '18:30',
            homeTeam: 'Team Epsilon',
            awayTeam: 'Team Zeta',
            venue: 'Arena Nord', // This might not match filter
            status: 'scheduled',
            pool: pool.name,
            ageGroup: pool.parentAgeGroup
          }
        ]
        
        allMatches.push(...mockMatches)
      }
      
      // Level 5: Venue Filtering
      this.updateProgress(5, 0, allMatches.length, 'Applying venue filters...', 'Filtering by venue')
      
      const filteredMatches = allMatches.filter(match => {
        return this.venues.some(venue => 
          match.venue.toLowerCase().includes(venue.toLowerCase())
        )
      })
      
      this.scrapingData.matches = filteredMatches
      
      this.updateProgress(5, filteredMatches.length, allMatches.length, 
        `Filtered to ${filteredMatches.length} matches`, 'Venue filtering complete')
      
      return filteredMatches
    }

    /**
     * Main orchestration method
     */
    async scrapeFullTournament(baseUrl) {
      try {
        // Reset data
        this.scrapingData = {
          unions: new Map(),
          ageGroups: new Map(), 
          pools: new Map(),
          matches: []
        }
        
        // Level 1: Unions
        const unions = await this.scrapeLevel1Unions(baseUrl)
        
        // Level 2: Age Groups
        const ageGroups = await this.scrapeLevel2AgeGroups(unions)
        
        // Level 3: Pools
        const pools = await this.scrapeLevel3Pools(ageGroups)
        
        // Levels 4-5: Matches with filtering
        const matches = await this.scrapeLevel4And5Matches(pools)
        
        // Return comprehensive results
        return {
          stats: {
            unions: this.scrapingData.unions.size,
            ageGroups: this.scrapingData.ageGroups.size,
            pools: this.scrapingData.pools.size,
            matches: matches.length,
            venues: this.venues
          },
          data: {
            unions: Array.from(this.scrapingData.unions.values()),
            ageGroups: Array.from(this.scrapingData.ageGroups.values()),
            pools: Array.from(this.scrapingData.pools.values()),
            matches: matches
          }
        }
        
      } catch (error) {
        console.error('Full tournament scrape failed:', error)
        throw error
      }
    }

    /**
     * Utility: Delay function
     */
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Get current scraping statistics
     */
    getStats() {
      return {
        unions: this.scrapingData.unions.size,
        ageGroups: this.scrapingData.ageGroups.size,
        pools: this.scrapingData.pools.size,
        matches: this.scrapingData.matches.length
      }
    }
  }

  /**
   * Initialize the scraper
   */
  const initializeScraper = (venues = []) => {
    scraperInstance.value = new TournamentLinkScraper(venues)
    isInitialized.value = true
    
    // Set up progress callback
    scraperInstance.value.setProgressCallback((progress) => {
      currentProgress.value = progress
    })
    
    return scraperInstance.value
  }

  /**
   * Update scraper venues
   */
  const updateScraperVenues = (venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues)
    } else {
      scraperInstance.value.setVenues(venues)
    }
  }

  /**
   * Run the full link levels scraping process
   */
  const runLinkLevelsScraping = async (baseUrl, venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues)
    } else {
      scraperInstance.value.setVenues(venues)
    }
    
    try {
      const results = await scraperInstance.value.scrapeFullTournament(baseUrl)
      scrapingResults.value = results.data
      
      return results
      
    } catch (error) {
      console.error('Link levels scraping failed:', error)
      throw error
    } finally {
      currentProgress.value = null
    }
  }

  /**
   * Test link navigation without full scraping
   */
  const testLinkNavigation = async (baseUrl, venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues)
    } else {
      scraperInstance.value.setVenues(venues)
    }
    
    try {
      // Test just the first few levels
      scraperInstance.value.config.maxUnionsToProcess = 1
      scraperInstance.value.config.maxAgeGroupsToProcess = 2
      scraperInstance.value.config.maxPoolsToProcess = 3
      
      const results = await scraperInstance.value.scrapeFullTournament(baseUrl)
      
      return results
      
    } catch (error) {
      console.error('Link navigation test failed:', error)
      throw error
    } finally {
      currentProgress.value = null
    }
  }

  /**
   * Get current scraping statistics
   */
  const getCurrentStats = () => {
    if (!scraperInstance.value) return null
    return scraperInstance.value.getStats()
  }

  /**
   * Clear all scraping data
   */
  const clearScrapingData = () => {
    scrapingResults.value = {
      unions: [],
      ageGroups: [],
      pools: [],
      matches: []
    }
    currentProgress.value = null
  }

  return {
    // State
    scraperInstance: readonly(scraperInstance),
    isInitialized: readonly(isInitialized),
    currentProgress: readonly(currentProgress),
    scrapingResults: readonly(scrapingResults),
    
    // Methods
    initializeScraper,
    updateScraperVenues,
    runLinkLevelsScraping,
    testLinkNavigation,
    getCurrentStats,
    clearScrapingData
  }
}