const puppeteer = require('puppeteer');
const { SCRAPER_CONFIG } = require('../config/constants');

class TournamentScraper {
  constructor() {
    this.baseUrl = SCRAPER_CONFIG.BASE_URL;
    this.venue = SCRAPER_CONFIG.DEFAULT_VENUE;
  }

  async scrapeTournaments() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    try {
      await page.goto(this.baseUrl);
      
      // Dynamic link structure handling
      const tournaments = await this.buildLinkStructure(page);
      
      // Filter home matches only
      const homeMatches = tournaments.filter(match => 
        match.location.includes(this.venue)
        || match.location.includes('Grøndal MultiCenter, lokale 28'));
      
      return homeMatches;
    } finally {
      await browser.close();
    }
  }

  async buildLinkStructure(page) {
    // Implementation for dynamic link building
    // Handles changes in tournament structure
  }
}