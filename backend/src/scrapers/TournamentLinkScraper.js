const puppeteer = require('puppeteer');
const { SCRAPER_CONFIG } = require('../config/constants');

class TournamentLinkScraper {
  constructor() {
    this.baseUrl = SCRAPER_CONFIG.BASE_URL;
    this.levels = [
      { name: 'Unions', selector: '.union-list' },
      { name: 'Age Groups', selector: '.age-group-list' },
      { name: 'Seasons', selector: '.season-selector' },
      { name: 'Pools', selector: '.pool-list' },
      { name: 'Matches', selector: '.match-table' }
    ];
  }

  async scrape({ onProgress }) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    const matches = [];

    try {
      await page.goto(this.baseUrl);

      for (let i = 0; i < this.levels.length; i++) {
        const level = this.levels[i];
        
        // Report progress
        if (onProgress) {
          onProgress({
            level: level.name,
            progress: (i / this.levels.length) * 100
          });
        }

        // Level-specific scraping logic
        switch(level.name) {
          case 'Matches':
            matches.push(...await this.scrapeMatches(page));
            break;
          default:
            await this.navigateLevel(page, level.selector);
        }
      }

      return matches;
    } finally {
      await browser.close();
    }
  }

  async scrapeMatches(page) {
    // Implementation for scraping match data
    return await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.match-table tr'));
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return {
          date: cells[0].textContent.trim(),
          time: cells[1].textContent.trim(),
          homeTeam: cells[2].textContent.trim(),
          awayTeam: cells[3].textContent.trim(),
          venue: cells[4].textContent.trim()
        };
      }).filter(Boolean);
    });
  }

  async navigateLevel(page, selector) {
    // Implementation for navigating through levels
  }
}

module.exports = TournamentLinkScraper;