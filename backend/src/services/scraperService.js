const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { JSDOM } = require('jsdom');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database'); 
const axios = require('axios');


class ScraperService {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.driver = null;
        this.pool = null;
        this.initDatabase();
        this.scrapeMatchesForPool = this.scrapeMatchesForPool.bind(this);
    }


    async initDatabase() {
        try {
            this.pool = mysql.createPool({
                host: this.dbConfig.host,
                user: this.dbConfig.user,
                password: this.dbConfig.password,
                database: this.dbConfig.database,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
        } catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }

    async initDriver() {
        if (!this.driver) {
            try {
                const options = new chrome.Options();
                options.addArguments(
                    '--headless',
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    `--user-data-dir=/tmp/chrome-profile-${uuidv4()}`,
                    '--disable-extensions',
                    '--blink-settings=imagesEnabled=false'
                );

                this.driver = await new Builder()
                    .forBrowser('chrome')
                    .setChromeOptions(options)
                    .build();

                console.log('WebDriver initialized successfully');
            } catch (error) {
                console.error('WebDriver initialization failed:', error);
                throw error;
            }
        }
        return this.driver;
    }

    async quitDriver() {
        if (this.driver) {
            try {
                await this.driver.quit();
                this.driver = null;
                console.log('WebDriver quit successfully');
            } catch (error) {
                console.error('Error quitting WebDriver:', error);
            }
        }
    }

    async loadPools(season) {
        let connection;
        try {
            connection = await pool.getConnection();
            
            const [pools] = await connection.execute(
                `SELECT 
                    region_id,
                    age_group_id,
                    pool_value,
                    tournament_level,
                    pool_name,
                    season,
                    region_name,
                    age_group_name,
                    google_color_id,
                    hex_color
                FROM tournament_pools 
                WHERE season = ?`,
                [season]
            );
            
            console.log(`Loaded ${pools.length} pools for season ${season}`);
            return pools;
        } catch (error) {
            console.error('Error loading pools:', error);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }

async scrapeResults(driver, url, venue) {
        try {
            console.log(`🌐 Loading URL: ${url}`);
            await driver.get(url);
            await this.waitForPageReady(driver);
            
            // Save page source for debugging
            const pageSource = await driver.getPageSource();
            require('fs').writeFileSync(`page-source-${Date.now()}.html`, pageSource);
            
            const table = await this.findResultsTable(driver);
            if (!table) {
                console.log('No results table found, returning empty matches');
                // Check for "no matches" message
                try {
                    const noMatches = await driver.findElements(By.css('p, div, span'));
                    for (const element of noMatches) {
                        const text = await element.getText();
                        if (text.toLowerCase().includes('ingen kampe') || text.toLowerCase().includes('no matches')) {
                            console.log(`Found message: ${text}`);
                            return [];
                        }
                    }
                } catch (e) {
                    console.log('No "no matches" message found:', e.message);
                }
                return [];
            }
            
            return await this.extractMatchesFromTable(driver, table, venue);
        } catch (error) {
            console.error('❌ Scrape error:', error);
            await driver.takeScreenshot().then(image => {
                require('fs').writeFileSync(`error-screenshot-${Date.now()}.png`, image, 'base64');
            });
            return [];
        }
    }

async waitForPageReady(driver) {
        // Wait for page body
        await driver.wait(until.elementLocated(By.css('body')), 30000);
        
        // Handle fragment-based navigation (tabs, dropdowns)
        const tabSelectors = [
            'a[href*="#4.2024/2025"]', // Match fragment pattern
            'select#season',            // Season dropdown
            'select#pool',              // Pool dropdown
            'select#group',             // Group dropdown
            'select#region',            // Region dropdown
            'li.active',                // Active tab
            'div.tab-pane',             // Tab content
            'button[data-season]',      // Buttons with season data
            'a.nav-link',               // Navigation links
        ];
        
        for (const selector of tabSelectors) {
            try {
                const element = await driver.findElement(By.css(selector));
                await driver.executeScript("arguments[0].click();", element);
                console.log(`Clicked element with selector: ${selector}`);
                await driver.sleep(3000); // Wait for content to load
                break;
            } catch (e) {
                console.log(`No element found for ${selector}: ${e.message}`);
            }
        }
        
        // Scroll to trigger lazy loading
        await driver.executeScript('window.scrollTo(0, document.body.scrollHeight);');
        await driver.sleep(2000);
        
        // Wait for absence of loading indicators
        await driver.wait(async () => {
            const loading = await driver.findElements(By.css('.loading-spinner, .loader, .spinner, .loading, .preloader'));
            return loading.length === 0;
        }, 30000);
        
        // Explicitly wait for table or container
        try {
            await driver.wait(
                until.elementLocated(By.css('table, div#results, section.results, div.table-container, div.content')),
                10000
            );
            console.log('Table or results container found');
        } catch (e) {
            console.log('No table or results container found:', e.message);
        }
    }

async findResultsTable(driver) {
        const selectors = [
            'table#standings',         // Common for sports standings
            'table.results',           // Alternative class
            'table.match-table',       // Possible match table
            'table.table-striped',     // Bootstrap-style table
            'table.table-bordered',    // Bootstrap bordered table
            'div#results table',       // Table inside results div
            'div.table-container table', // Generic container
            'table.data-table',        // Common for data tables
            'table',                   // Fallback to any table
        ];
        
        for (const selector of selectors) {
            console.log(`Trying selector: ${selector}`);
            try {
                const table = await driver.wait(
                    until.elementLocated(By.css(selector)),
                    10000 // Increased timeout
                );
                if (await table.isDisplayed()) {
                    console.log(`✅ Found table with selector: ${selector}`);
                    return table;
                }
            } catch (e) {
                console.log(`❌ Selector ${selector} failed: ${e.message}`);
                continue;
            }
        }
        console.log('No table found with any selector');
        return null;
    }


async scrapeMatchesForPool({ pool, linkStructure, venue, season }) {
        try {
            console.log(`Scraping matches for pool: ${pool.pool_name}`);
            await this.initDriver();
            
            const url = linkStructure
                .replace('{pool}', pool.pool_value)
                .replace('{group}', pool.age_group_id)
                .replace('{region}', pool.region_id)
                .replace('{season}', season);
            
            console.log(`Scraping URL: ${url}`);
            const result = await this.scrapeResults(this.driver, url, venue);
            
            const matches = result.map(match => ({
                match_id: match.match_id || uuidv4(),
                team1: match.hjemmehold || match.team1 || 'Unknown',
                team2: match.udehold || match.team2 || 'Unknown',
                date: match.dato || match.date || new Date().toISOString(),
                venue: match.spillested || match.venue || venue,
                pool_id: pool.pool_id,
                season: season,
                home_score: match.hjemmescore || match.home_score,
                away_score: match.udescore || match.away_score,
                round: match.runde || match.round
            }));
            
            console.log(`Found ${matches.length} matches for pool ${pool.pool_name}`);
            return matches;
        } catch (error) {
            console.error(`Error scraping pool ${pool.pool_name}:`, error);
            return [];
        }
    }
    
   async runAllCalendarScraper(params) {
        let connection;
        try {
            const { season, linkStructure, venue } = params;
            connection = await pool.getConnection();
            
            // 1. Load pools
            const pools = await this.loadPools(season);
            if (!pools || pools.length === 0) {
                throw new Error(`No tournament pools found for season ${season}`);
            }
            
            // 2. Process each pool
            let totalMatches = 0;
            const allMatches = [];
            
            for (const pool of pools) {
                const matches = await this.scrapeMatchesForPool({  // Fixed this line
                    pool,
                    linkStructure,
                    venue,
                    season
                });
                
                if (matches?.length > 0) {
                    allMatches.push(...matches);
                    totalMatches += matches.length;
                }
            }
            
            // 3. Save matches if needed
            if (allMatches.length > 0) {
                await this.saveMatches(connection, allMatches);
            }
            
            return {
                success: true,
                totalMatches,
                message: `Successfully scraped ${totalMatches} matches`
            };
            
        } catch (error) {
            console.error('Scraping failed:', error);
            return {
                success: false,
                totalMatches: 0,
                message: error.message
            };
        } finally {
            if (connection) connection.release();
        }
    }

    async saveMatches(connection, matches) {
        // Implement your save logic here
        console.log(`Would save ${matches.length} matches to database`);
    }

    async startLog(season, totalPools, totalMatches, progress, sessionId, message) {
        try {
            const connection = await this.pool.getConnection();
            const [result] = await connection.execute(`
                INSERT INTO cal_sync_logs 
                (season, total_pools, total_matches, progress, session_id, error_message, status, start_datetime)
                VALUES (?, ?, ?, ?, ?, ?, 'running', NOW())
            `, [season, totalPools, totalMatches, progress, sessionId, message]);
            
            connection.release();
            return result.insertId;
        } catch (error) {
            console.error('Error starting log:', error);
            return null;
        }
    }

    async updateLog(logId, totalMatches, message, status) {
        try {
            const connection = await this.pool.getConnection();
            await connection.execute(`
                UPDATE cal_sync_logs 
                SET total_matches = ?, error_message = ?, status = ?, end_datetime = NOW()
                WHERE id = ?
            `, [totalMatches, message, status, logId]);
            
            connection.release();
        } catch (error) {
            console.error('Error updating log:', error);
        }
    }

    async extractMatchesFromTable(driver, table, venue) {
    // Scroll table into view and wait
    await driver.executeScript("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", table);
    await driver.sleep(1500); // Increased wait for lazy loading
    
    // Get fresh HTML
    const tableHtml = await table.getAttribute('outerHTML');
    const dom = new JSDOM(`<!DOCTYPE html>${tableHtml}`);
    const doc = dom.window.document;
    
    // 1. Extract headers with multiple fallbacks
    const headers = [];
    const headerRow = doc.querySelector('tr.headerrow') || 
                     doc.querySelector('thead tr') || 
                     doc.querySelector('tr:first-child');
    
    if (headerRow) {
        const headerCells = headerRow.querySelectorAll('th, td');
        headerCells.forEach((cell, index) => {
            let headerText = cell.textContent
                .toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '')
                .trim();
                
            headers.push(headerText || `col_${index}`);
        });
    } else {
        // Estimate columns from first data row
        const firstRow = doc.querySelector('tr:not(.headerrow)');
        if (firstRow) {
            const cellCount = firstRow.querySelectorAll('td').length;
            headers.push(...Array.from({length: cellCount}, (_, i) => `col_${i}`));
        }
    }
    
    // 2. Extract matches
    const matches = [];
    const rows = doc.querySelectorAll('tr:not(.headerrow)');
    
    rows.forEach(row => {
        try {
            const cells = row.querySelectorAll('td');
            const matchData = {};
            
            // Basic cell data
            cells.forEach((cell, index) => {
                if (index >= headers.length) return;
                
                const value = cell.textContent.trim();
                matchData[headers[index]] = value;
                
                // Extract links/IDs for teams
                if (headers[index].includes('hold')) { // Matches 'hjemmehold', 'udehold' etc.
                    const link = cell.querySelector('a');
                    if (link) {
                        const href = link.getAttribute('href');
                        const onclick = link.getAttribute('onclick');
                        
                        // Extract team ID from various possible patterns
                        const idPatterns = [
                            /ShowStanding\(.*?'(\d+)'/,
                            /team_id=(\d+)/,
                            /\/team\/(\d+)/,
                            /id=(\d+)/
                        ];
                        
                        for (const pattern of idPatterns) {
                            const match = (onclick || href)?.match(pattern);
                            if (match) {
                                matchData[`${headers[index]}_id`] = match[1];
                                break;
                            }
                        }
                    }
                }
            });
            
            // 3. Venue filtering
            const venueKey = headers.find(h => h.includes('spillested')) || 'venue';
            if (!venue || 
                !matchData[venueKey] || 
                matchData[venueKey].toLowerCase().includes(venue.toLowerCase())) {
                
                // Standardize match structure
                matches.push({
                    match_id: matchData.id || matchData.no || uuidv4(),
                    date: matchData.dato || matchData.date,
                    time: matchData.tid || matchData.time,
                    home_team: matchData.hjemmehold || matchData.home,
                    away_team: matchData.udehold || matchData.away,
                    venue: matchData[venueKey],
                    home_score: matchData.hjemmescore,
                    away_score: matchData.udescore,
                    round: matchData.runde,
                    raw_data: matchData // Keep original structure
                });
            }
            
        } catch (rowError) {
            console.error('Error processing row:', rowError);
        }
    });
    
    console.log(`✔ Extracted ${matches.length} matches`);
    return matches;
}

    async insertMatches(matches, metadata) {
        if (!Array.isArray(matches) || matches.length === 0) return;

        try {
            const connection = await this.pool.getConnection();
            
            for (const match of matches) {
                await connection.execute(`
                    INSERT INTO cal_sync_matches 
                    (season_name, region_name, age_group_name, pool_name, tournament_level,
                     google_color_id, season, region, age_group, pool_value, venue, hex_color,
                     match_data, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                `, [
                    metadata.season_name,
                    metadata.region_name, 
                    metadata.age_group_name,
                    metadata.pool_name,
                    metadata.tournament_level,
                    metadata.google_color_id,
                    metadata.season,
                    metadata.region,
                    metadata.ageGroup,
                    metadata.poolValue,
                    metadata.venue,
                    metadata.hex_color,
                    JSON.stringify(match)
                ]);
            }
            
            connection.release();
            console.log(`Inserted ${matches.length} matches`);
        } catch (error) {
            console.error('Error inserting matches:', error);
        }
    }

    async getScraperProgress(sessionId) {
        try {
            const connection = await this.pool.getConnection();
            const [rows] = await connection.execute(`
                SELECT status, total_matches, error_message
                FROM cal_sync_logs
                WHERE session_id = ?
                ORDER BY start_datetime DESC
                LIMIT 1
            `, [sessionId]);
            
            connection.release();
            
            if (rows.length > 0) {
                const log = rows[0];
                return {
                    success: true,
                    data: {
                        progress: 0, // Calculate based on your needs
                        message: log.error_message || '',
                        status: log.status,
                        matches: log.total_matches
                    }
                };
            }
            
            return {
                success: false,
                data: { message: 'No log found for session' }
            };
        } catch (error) {
            console.error('Error getting scraper progress:', error);
            return {
                success: false,
                data: { message: 'Error fetching progress' }
            };
        }
    }

    async closePool() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}
module.exports = ScraperService;