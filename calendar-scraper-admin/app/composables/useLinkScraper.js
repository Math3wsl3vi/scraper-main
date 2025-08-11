// composables/useLinkScraper.js
import { ref, computed } from 'vue'
import puppeteer from 'puppeteer';

class TournamentLinkScraper {
  constructor(venues = []) {
    this.venues = venues;
    this.lastUsedVenues = [...venues];
    this.currentLevel = 0;
    this.scrapingData = {
      unions: new Map(),
      ageGroups: new Map(),
      pools: new Map(),
      matches: []
    };
    this.progressCallback = null;
    this.browser = null;
    this.page = null;
    this.config = {
      maxRetries: 3,
      delayBetweenRequests: 2000,
      maxUnionsToProcess: 50,
      maxAgeGroupsToProcess: 50,
      maxPoolsToProcess: 200,
      headless: true, // Set to false for debugging
      timeout: 30000
    };
  }

  /**
   * Initialize Puppeteer browser and page
   */
  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.page = await this.browser.newPage();
      
      // Set user agent and viewport
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await this.page.setViewport({ width: 1280, height: 800 });
      
      // Configure request interception if needed
      await this.page.setRequestInterception(true);
      this.page.on('request', (request) => {
        // Block unnecessary resources to speed up scraping
        if (['image', 'stylesheet', 'font', 'script'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });
    }
    return this.page;
  }

  /**
   * Close Puppeteer browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Navigate to URL and wait for content
   */
  async navigateTo(url) {
    if (!this.page) await this.initBrowser();
    
    try {
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout
      });
      
      // Wait for the main content to load (adjust selector as needed)
      await this.page.waitForSelector('body', { timeout: this.config.timeout });
      return true;
    } catch (error) {
      console.error(`Navigation error for ${url}:`, error);
      return false;
    }
  }

  /**
   * Level 1: Discover Unions
   */
  async scrapeLevel1Unions(baseUrl) {
    this.updateProgress(1, 0, 1, 'Loading tournament page...', 'Discovering unions');
    
    try {
      const success = await this.navigateTo(baseUrl);
      if (!success) throw new Error('Failed to load base URL');
      
      // Get unions - adjust selectors based on actual page structure
      const unions = await this.page.evaluate(() => {
        const unionElements = Array.from(document.querySelectorAll('.union-list a'));
        return unionElements.map(el => ({
          name: el.textContent.trim(),
          url: el.href,
          level: 'union'
        }));
      });
      
      for (const union of unions) {
        this.scrapingData.unions.set(union.name, union);
      }
      
      this.updateProgress(1, 1, 1, `Found ${unions.length} unions`, 'Unions discovered');
      return Array.from(this.scrapingData.unions.values());
    } catch (error) {
      console.error('Level 1 error:', error);
      throw error;
    }
  }

  /**
   * Level 2: Discover Age Groups within Unions
   */
  async scrapeLevel2AgeGroups(unions) {
    this.updateProgress(2, 0, unions.length, 'Processing unions...', 'Discovering age groups');
    
    const processedUnions = unions.slice(0, this.config.maxUnionsToProcess);
    
    for (let i = 0; i < processedUnions.length; i++) {
      const union = processedUnions[i];
      this.updateProgress(2, i, processedUnions.length, `Processing ${union.name}...`, 'Discovering age groups');
      
      await this.delay(this.config.delayBetweenRequests);
      
      try {
        const success = await this.navigateTo(union.url);
        if (!success) continue;
        
        const ageGroups = await this.page.evaluate(() => {
          const ageGroupElements = Array.from(document.querySelectorAll('.age-group-list a'));
          return ageGroupElements.map(el => ({
            name: el.textContent.trim(),
            url: el.href,
            level: 'ageGroup'
          }));
        });
        
        for (const ageGroup of ageGroups) {
          this.scrapingData.ageGroups.set(`${union.name}_${ageGroup.name}`, {
            ...ageGroup,
            parentUnion: union.name
          });
        }
      } catch (error) {
        console.error(`Error processing union ${union.name}:`, error);
        continue;
      }
    }
    
    const totalAgeGroups = Array.from(this.scrapingData.ageGroups.values());
    this.updateProgress(2, processedUnions.length, processedUnions.length, 
      `Found ${totalAgeGroups.length} age groups`, 'Age groups discovered');
    
    return totalAgeGroups;
  }

  /**
   * Level 3: Discover Pools within Age Groups
   */
  async scrapeLevel3Pools(ageGroups) {
    this.updateProgress(3, 0, ageGroups.length, 'Processing age groups...', 'Discovering pools');
    
    const processedAgeGroups = ageGroups.slice(0, this.config.maxAgeGroupsToProcess);
    
    for (let i = 0; i < processedAgeGroups.length; i++) {
      const ageGroup = processedAgeGroups[i];
      this.updateProgress(3, i, processedAgeGroups.length, 
        `Processing ${ageGroup.name}...`, 'Discovering pools');
      
      await this.delay(this.config.delayBetweenRequests);
      
      try {
        const success = await this.navigateTo(ageGroup.url);
        if (!success) continue;
        
        const pools = await this.page.evaluate(() => {
          const poolElements = Array.from(document.querySelectorAll('.pool-list a'));
          return poolElements.map(el => ({
            name: el.textContent.trim(),
            url: el.href,
            level: 'pool'
          }));
        });
        
        for (const pool of pools) {
          this.scrapingData.pools.set(`${ageGroup.name}_${pool.name}`, {
            ...pool,
            parentAgeGroup: ageGroup.name
          });
        }
      } catch (error) {
        console.error(`Error processing age group ${ageGroup.name}:`, error);
        continue;
      }
    }
    
    const totalPools = Array.from(this.scrapingData.pools.values());
    this.updateProgress(3, processedAgeGroups.length, processedAgeGroups.length, 
      `Found ${totalPools.length} pools`, 'Pools discovered');
    
    return totalPools;
  }

  /**
   * Level 4-5: Discover and Filter Matches
   */
  async scrapeLevel4And5Matches(pools) {
    this.updateProgress(4, 0, pools.length, 'Processing pools...', 'Discovering matches');
    
    const processedPools = pools.slice(0, this.config.maxPoolsToProcess);
    let allMatches = [];
    
    for (let i = 0; i < processedPools.length; i++) {
      const pool = processedPools[i];
      this.updateProgress(4, i, processedPools.length, 
        `Processing ${pool.name}...`, 'Discovering matches');
      
      await this.delay(this.config.delayBetweenRequests);
      
      try {
        const success = await this.navigateTo(pool.url);
        if (!success) continue;
        
        // Wait for match table to load
        await this.page.waitForSelector('.match-table', { timeout: this.config.timeout });
        
        const matches = await this.page.evaluate(() => {
          const matchRows = Array.from(document.querySelectorAll('.match-table tr'));
          return matchRows.map(row => {
            const columns = Array.from(row.querySelectorAll('td'));
            if (columns.length >= 5) {
              return {
                date: columns[0].textContent.trim(),
                time: columns[1].textContent.trim(),
                homeTeam: columns[2].textContent.trim(),
                awayTeam: columns[3].textContent.trim(),
                venue: columns[4].textContent.trim(),
                status: 'scheduled',
                pool: pool.name,
                ageGroup: pool.parentAgeGroup
              };
            }
            return null;
          }).filter(match => match !== null);
        });
        
        allMatches.push(...matches);
      } catch (error) {
        console.error(`Error processing pool ${pool.name}:`, error);
        continue;
      }
    }
    
    // Level 5: Venue Filtering
    this.updateProgress(5, 0, allMatches.length, 'Applying venue filters...', 'Filtering by venue');
    
    const filteredMatches = allMatches.filter(match => {
      return this.venues.some(venue => 
        match.venue.toLowerCase().includes(venue.toLowerCase())
      );
    });
    
    this.scrapingData.matches = filteredMatches;
    
    this.updateProgress(5, filteredMatches.length, allMatches.length, 
      `Filtered to ${filteredMatches.length} matches`, 'Venue filtering complete');
    
    return filteredMatches;
  }

  /**
   * Main orchestration method
   */
  async scrapeFullTournament(baseUrl) {
    try {
      // Initialize browser
      await this.initBrowser();
      
      // Reset data
      this.scrapingData = {
        unions: new Map(),
        ageGroups: new Map(), 
        pools: new Map(),
        matches: []
      };
      
      // Run all levels
      const unions = await this.scrapeLevel1Unions(baseUrl);
      const ageGroups = await this.scrapeLevel2AgeGroups(unions);
      const pools = await this.scrapeLevel3Pools(ageGroups);
      const matches = await this.scrapeLevel4And5Matches(pools);
      
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
      };
    } catch (error) {
      console.error('Full tournament scrape failed:', error);
      throw error;
    } finally {
      // Close browser when done
      await this.closeBrowser();
      this.updateProgress(0, 0, 0, 'Scraping completed', 'Ready');
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

  const scraperInstance = ref(null);
const isInitialized = ref(false);
const currentProgress = ref(null);
const scrapingResults = ref({
  unions: [],
  ageGroups: [],
  pools: [],
  matches: []
});

export function useLinkScraper() {
  const initializeScraper = (venues = []) => {
    scraperInstance.value = new TournamentLinkScraper(venues);
    isInitialized.value = true;

    scraperInstance.value.setProgressCallback((progress) => {
      currentProgress.value = progress;
    });

    return scraperInstance.value;
  };

  const updateScraperVenues = (venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues);
    } else {
      scraperInstance.value.setVenues(venues);
    }
  };

  const runLinkLevelsScraping = async (baseUrl, venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues);
    } else {
      scraperInstance.value.setVenues(venues);
    }

    try {
      const results = await scraperInstance.value.scrapeFullTournament(baseUrl);
      scrapingResults.value = results.data;
      return results;
    } catch (error) {
      console.error('Link levels scraping failed:', error);
      throw error;
    } finally {
      currentProgress.value = null;
    }
  };

  const testLinkNavigation = async (baseUrl, venues) => {
    if (!scraperInstance.value) {
      initializeScraper(venues);
    } else {
      scraperInstance.value.setVenues(venues);
    }

    try {
      scraperInstance.value.config.maxUnionsToProcess = 1;
      scraperInstance.value.config.maxAgeGroupsToProcess = 2;
      scraperInstance.value.config.maxPoolsToProcess = 3;

      return await scraperInstance.value.scrapeFullTournament(baseUrl);
    } catch (error) {
      console.error('Link navigation test failed:', error);
      throw error;
    } finally {
      currentProgress.value = null;
    }
  };

  const getCurrentStats = () => {
    if (!scraperInstance.value) return null;
    return scraperInstance.value.getStats();
  };

  const clearScrapingData = () => {
    scrapingResults.value = {
      unions: [],
      ageGroups: [],
      pools: [],
      matches: []
    };
    currentProgress.value = null;
  };

  return {
    scraperInstance: readonly(scraperInstance),
    isInitialized: readonly(isInitialized),
    currentProgress: readonly(currentProgress),
    scrapingResults: readonly(scrapingResults),
    initializeScraper,
    updateScraperVenues,
    runLinkLevelsScraping,
    testLinkNavigation,
    getCurrentStats,
    clearScrapingData
  };
}