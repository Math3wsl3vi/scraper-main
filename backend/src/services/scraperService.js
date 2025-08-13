const puppeteer = require('puppeteer');

class ScraperService {
  constructor() {
    this.browser = null;
    this.logger = require('./logger'); // Assume a simple logger implementation
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-extensions'],
      });
    }
    return this.browser;
  }

  async quitBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrapeTeamResults(url) {
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('table.groupstandings tr:not(.headerrow)', { timeout: 15000 });

      let lastHeight = await page.evaluate(() => document.body.scrollHeight);
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === lastHeight) break;
        lastHeight = newHeight;
      }

      const html = await page.content();
      const teams = await page.$$eval('table.groupstandings tr:not(.headerrow)', (rows) =>
        rows.map((row) => {
          const teamLink = row.querySelector('td.team a');
          if (!teamLink) return null;
          const teamName = teamLink.textContent.trim();
          const onclick = teamLink.getAttribute('onclick');
          const teamId = onclick ? onclick.match(/ShowStanding\((?:'[^']*',\s*){5}'(\d+)'/)?.[1] : null;
          return teamId ? { team_id: teamId, team_name: teamName } : null;
        }).filter((team) => team)
      );

      return teams.length > 0 ? teams : ['->no groupstandings table'];
    } catch (error) {
      return [`->error: ${error.message}`];
    } finally {
      await page.close();
    }
  }

  async scrapeResults(url, venue) {
    const browser = await this.initBrowser();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) request.abort();
      else request.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('table.matchlist tr:not(.headerrow)', { timeout: 15000 });

      let lastHeight = await page.evaluate(() => document.body.scrollHeight);
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === lastHeight) break;
        lastHeight = newHeight;
      }

      const html = await page.content();
      const headers = await page.$$eval('table.matchlist tr.headerrow td', (tds) =>
        tds.map((td) => {
          const text = td.textContent.toLowerCase().replace(/ /g, '');
          return text === '#' ? 'no' : text;
        })
      );

      const matches = await page.$$eval('table.matchlist tr:not(.headerrow)', (rows, venue) =>
        rows.map((row) => {
          const tds = Array.from(row.querySelectorAll('td'));
          const rowData = {};
          tds.forEach((td, index) => {
            const value = td.textContent.trim();
            if (td.querySelector('a') && ['hjemmehold', 'udehold'].includes(headers[index])) {
              const onclick = td.querySelector('a').getAttribute('onclick');
              const teamId = onclick?.match(/ShowStanding\((?:'[^']*',\s*){5}'(\d+)'/)?.[1];
              if (teamId) rowData[`${headers[index]}_id`] = teamId;
            }
            if (index < headers.length) rowData[headers[index]] = value;
          });
          return rowData.spillested && rowData.spillested.toLowerCase() === venue.toLowerCase() ? rowData : null;
        }).filter((match) => match)
      , venue);

      return matches.length > 0 ? matches : ['->no matchlist table'];
    } catch (error) {
      return [`->error: ${error.message}`];
    } finally {
      await page.close();
    }
  }
async runAllCalendarScraper({ season, linkStructure, venue, sessionId }) {
  const browser = await this.initBrowser();
  console.log('Browser initialized successfully for session:', sessionId);
  let totalMatches = 0;
  let scrapedMatches = [];

  try {
    const pools = await this.loadPools(season);
    console.log('Loaded pools:', pools.length);
    if (pools.length === 0) {
      await this.logger.log('warn', `No pools found for season ${season}`);
      return { success: false, totalMatches: 0, message: 'No tournament pools available for the specified season' };
    }
    const logId = await this.logger.startLog(sessionId, season, venue);
    console.log('Started log with ID:', logId);

    for (const pool of pools) {
      const url = linkStructure
        .replace('{season}', season)
        .replace('{region}', pool.region_id)
        .replace('{group}', pool.age_group_id)
        .replace('{pool}', pool.pool_value);
      console.log('Scraping URL:', url);
      const matches = await this.scrapeResults(url, venue);
      console.log('Scraped matches count:', matches.length);
      if (Array.isArray(matches) && !matches[0]?.startsWith('->error')) {
        totalMatches += matches.length;
        scrapedMatches = [...scrapedMatches, ...matches]; // Collect all matches
        await this.insertMatches(matches, pool, season, venue);
        await this.logger.updateLog(logId, totalMatches, `Found ${matches.length} matches for ${pool.pool_name}`);
      } else {
        await this.logger.updateLog(logId, totalMatches, matches[0] || 'No matches found');
      }
    }

    await this.logger.updateLog(logId, totalMatches, `Scraping completed with ${totalMatches} matches`, 'completed');
    return { 
      success: true, 
      totalMatches, 
      message: `Scraping completed! Found ${totalMatches} matches`, 
      matches: scrapedMatches // Return scraped matches
    };
  } catch (error) {
    console.error('Scraper service error:', error.stack);
    await this.logger.log('error', `Scraping failed: ${error.message}`);
    throw error;
  } finally {
    await this.quitBrowser();
    console.log('Browser quit for session:', sessionId);
  }
}

  // Placeholder for pool loading
async loadPools(season) {
  const db = require('../config/database');
  try {
    const [rows] = await db.execute(
      'SELECT region_id, age_group_id, pool_value, pool_name, tournament_level FROM tournament_pools WHERE season = ?',
      [season]
    );
    return rows || [];
  } catch (error) {
    console.error('Failed to load pools:', error.stack);
    return [];
  }
}

  // Placeholder for match insertion
  async insertMatches(matches, pool, season, venue) {
    // Implement database insertion logic
  }
}

module.exports = new ScraperService();