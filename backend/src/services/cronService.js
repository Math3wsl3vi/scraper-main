const cron = require('node-cron');
const TournamentScraper = require('../scrapers/TournamentLinkScraper');
const logger = require('./logger');
const WPIntegrationService = require('./wpIntegrationService.js');

module.exports = {
  initializeCronJobs: function() {
    // Daily auto-scrape at midnight
    cron.schedule('0 0 * * *', async () => {
      const startTime = Date.now();
      
      try {
        await logger.logScrapingEvent('Auto-scraping started', 'auto');
        
        const scraper = new TournamentScraper();
        const matches = await scraper.scrapeTournaments();
        
        await this.saveToCalendar(matches);
        
        const execTime = ((Date.now() - startTime) / 1000).toFixed(2);
        await logger.logScrapingEvent(
          `Auto-scraping completed: ${matches.length} matches in ${execTime}s`,
          'auto',
          'info',
          {
            recordsCount: matches.length,
            executionTime: execTime
          }
        );
        
      } catch (error) {
        await logger.logScrapingEvent(
          `Auto-scraping failed: ${error.message}`,
          'auto',
          'error',
          { errorDetails: error.stack }
        );
      }
    });
  },

  saveToCalendar: async function(matches) {
    const wp = new WPIntegrationService();
    try {
      await logger.logScrapingEvent('Starting calendar sync...', 'auto');
      
      // Clear existing events if needed
      if (process.env.CLEAR_BEFORE_SYNC === 'true') {
        await wp.clearCalendar();
      }
      
      // Insert new events
      const results = await Promise.allSettled(
        matches.map(match => wp.syncEvent(match))
      );
      
      // Log sync results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      await logger.logScrapingEvent(
        `Calendar sync completed: ${successful} succeeded, ${failed} failed`,
        'auto',
        failed > 0 ? 'warning' : 'info'
      );
      
    } catch (error) {
      await logger.logScrapingEvent(
        `Calendar sync failed: ${error.message}`,
        'auto',
        'error'
      );
      throw error;
    }
  },

  manualScrape: async function() {
    const startTime = Date.now();
    
    try {
      await logger.logScrapingEvent('Manual scraping started', 'manual');
      
      const scraper = new TournamentScraper();
      const matches = await scraper.scrapeTournaments();
      
      await this.saveToCalendar(matches);
      
      const execTime = ((Date.now() - startTime) / 1000).toFixed(2);
      await logger.logScrapingEvent(
        `Manual scraping completed: ${matches.length} matches in ${execTime}s`,
        'manual',
        'info',
        {
          recordsCount: matches.length,
          executionTime: execTime
        }
      );
      
      return { success: true, matchesProcessed: matches.length };
    } catch (error) {
      await logger.logScrapingEvent(
        `Manual scraping failed: ${error.message}`,
        'manual',
        'error',
        { errorDetails: error.stack }
      );
      throw error;
    }
  }
};