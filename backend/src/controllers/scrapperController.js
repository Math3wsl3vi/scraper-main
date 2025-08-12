  const ScraperService = require('../services/scraperService');
  const logger = require('../services/logger');

  class ScraperController {
    constructor() {
      this.scraperService = new ScraperService();
      this.activeScrapes = new Map();
    }

    async startScraping(req, res) {
      try {
        const scrapeId = Date.now().toString();
        
        // Start scraping in background
        this.scraperService.scrapeTournaments(scrapeId)
          .then(results => {
            logger.logScrapingEvent(`Scrape ${scrapeId} completed`, 'manual', 'info', {
              matchesFound: results.matches.length
            });
          })
          .catch(error => {
            logger.logScrapingEvent(`Scrape ${scrapeId} failed`, 'manual', 'error', {
              error: error.message
            });
          });

        // Store active scrape
        this.activeScrapes.set(scrapeId, {
          status: 'running',
          progress: 0,
          startTime: new Date()
        });

        res.json({ 
          message: 'Scraping started',
          scrapeId,
          statusUrl: `/api/scraper/status/${scrapeId}`
        });
      } catch (error) {
        logger.logScrapingEvent('Failed to start scraping', 'manual', 'error');
        res.status(500).json({ error: error.message });
      }
    }

    async getScrapingStatus(req, res) {
      const { scrapeId } = req.params;
      
      if (!this.activeScrapes.has(scrapeId)) {
        return res.status(404).json({ error: 'Scrape not found' });
      }

      const status = this.activeScrapes.get(scrapeId);
      res.json(status);
    }
  }

  module.exports = ScraperController;