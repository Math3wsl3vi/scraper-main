const TournamentLinkScraper = require('../scrapers/TournamentLinkScraper');
const MatchesModel = require('../models/matchesModel');
const logger = require('./logger');
const venues = require('../config/venues');
const WPIntegrationService = require('./wpIntegrationService.js');

class ScraperService {
  constructor() {
    this.scraper = new TournamentLinkScraper();
    this.wpService = new WPIntegrationService();
  }

  async scrapeTournaments(scrapeId) {
    const startTime = Date.now();
    let matches = [];

    try {
      // 1. Navigate through link levels
      const results = await this.scraper.scrape({
        onProgress: (progress) => {
          this.updateScrapeProgress(scrapeId, progress);
        }
      });

      // 2. Filter by venues
      matches = results.filter(match => 
        venues.some(venue => match.location.includes(venue))
      );

      // 3. Save to database
      await MatchesModel.bulkInsert(matches);

      // 4. Optional WordPress integration
      if (process.env.WP_INTEGRATION === 'true') {
        await this.wpService.syncMatches(matches);
      }

      // 5. Log completion
      const duration = (Date.now() - startTime) / 1000;
      logger.logScrapingEvent('Scraping completed', 'manual', 'info', {
        duration,
        matchesFound: matches.length
      });

      return { matches };
    } catch (error) {
      logger.logScrapingEvent('Scraping failed', 'manual', 'error', {
        error: error.message
      });
      throw error;
    }
  }

  updateScrapeProgress(scrapeId, progress) {
    // Update progress in controller's activeScrapes map
    // This would need access to the controller's instance
    // Alternatively, use a shared state management solution
  }
}

module.exports = ScraperService;