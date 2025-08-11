// backend/src/services/scraperService.js
const TournamentLinkScraper = require('../scrapers/TournamentLinkScraper.js');

let scraperInstance = null;
let lastStatus = { running: false, lastRun: null, lastError: null };

const scraperService = {
  async runScraper(url, venues = []) {
    try {
      lastStatus.running = true;
      lastStatus.lastRun = new Date();
      lastStatus.lastError = null;

      scraperInstance = new TournamentLinkScraper(venues);
      const results = await scraperInstance.scrapeFullTournament(url);

      lastStatus.running = false;
      return results;
    } catch (error) {
      lastStatus.running = false;
      lastStatus.lastError = error.message;
      throw error;
    }
  },

  getStatus() {
    return lastStatus;
  }
};
module.exports = scraperService;
