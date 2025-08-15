const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { JSDOM } = require('jsdom');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database'); 
const axios = require('axios');
const fs = require('fs');

class ScraperService {
   constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.driver = null;
        this.pool = null;
        this.progress = {
            sessionId: null,
            status: 'idle',
            totalPools: 0,
            poolsProcessed: 0,
            totalMatches: 0,
            error: null
        };
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
                    '--headless=new', // Use new headless mode
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--window-size=1920,1080', // Set window size
                    `--user-data-dir=/tmp/chrome-profile-${uuidv4()}`,
                    '--disable-extensions',
                    '--disable-blink-features=AutomationControlled',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                );

                // Remove automation flags
                options.excludeSwitches('enable-automation');
                options.addArguments('--disable-blink-features=AutomationControlled');

                this.driver = await new Builder()
                    .forBrowser('chrome')
                    .setChromeOptions(options)
                    .build();

                // Execute script to remove webdriver property
                await this.driver.executeScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");

                console.log('WebDriver initialized successfully');
            } catch (error) {
                console.error('WebDriver initialization failed:', error);
                throw error;
            }
        }
        return this.driver;
    }

    async getMatches(season) {
        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute(
                `SELECT 
                    pool_name,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.match_id')) AS match_id,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.team1')) AS team1,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.team2')) AS team2,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.date')) AS date,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.time')) AS time,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.venue')) AS venue,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.home_score')) AS home_score,
                    JSON_UNQUOTE(JSON_EXTRACT(match_data, '$.away_score')) AS away_score
                 FROM cal_sync_matches 
                 WHERE season = ?
                 ORDER BY created_at DESC 
                 LIMIT 100`,
                [season]
            );
            return rows.map(row => ({
                id: row.match_id,
                homeTeam: row.team1 || 'Unknown',
                awayTeam: row.team2 || 'Unknown',
                date: row.date || new Date().toISOString().split('T')[0],
                time: row.time || null,
                venue: row.venue || null,
                score: row.home_score && row.away_score ? `${row.home_score}-${row.away_score}` : null,
                pool: row.pool_name
            }));
        } catch (error) {
            console.error('Error fetching matches:', error);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }

    async clearMatches() {
        let connection;
        try {
            connection = await pool.getConnection();
            await connection.execute('DELETE FROM cal_sync_matches');
            console.log('All matches cleared from database');
        } catch (error) {
            console.error('Error clearing matches:', error);
            throw error;
        } finally {
            if (connection) connection.release();
        }
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

    // Enhanced debugging method
    async debugPageContent(driver, url) {
        console.log(`🔍 DEBUG: Analyzing page at ${url}`);
        
        try {
            // Take screenshot
            const screenshot = await driver.takeScreenshot();
            fs.writeFileSync(`debug_screenshot_${Date.now()}.png`, screenshot, 'base64');
            
            // Get page source and save it
            const pageSource = await driver.getPageSource();
            fs.writeFileSync(`debug_page_source_${Date.now()}.html`, pageSource);
            
            // Check for common elements
            const checks = [
                { name: 'Tables', selector: 'table' },
                { name: 'Divs with "result"', selector: 'div[class*="result"]' },
                { name: 'Divs with "match"', selector: 'div[class*="match"]' },
                { name: 'Divs with "game"', selector: 'div[class*="game"]' },
                { name: 'Lists', selector: 'ul, ol' },
                { name: 'Forms', selector: 'form' },
                { name: 'Buttons', selector: 'button' },
                { name: 'Links', selector: 'a' },
                { name: 'Scripts', selector: 'script' },
                { name: 'Loading indicators', selector: '.loading, .spinner, .loader' }
            ];

            for (const check of checks) {
                try {
                    const elements = await driver.findElements(By.css(check.selector));
                    console.log(`   ${check.name}: ${elements.length} found`);
                    
                    if (elements.length > 0 && elements.length < 10) {
                        for (let i = 0; i < Math.min(3, elements.length); i++) {
                            const text = await elements[i].getText();
                            const tagName = await elements[i].getTagName();
                            console.log(`     ${i+1}. ${tagName}: "${text.substring(0, 100)}..."`);
                        }
                    }
                } catch (e) {
                    console.log(`   ${check.name}: Error checking - ${e.message}`);
                }
            }

            // Check for JavaScript frameworks
            const jsFrameworks = [
                'React', 'Vue', 'Angular', 'jQuery', 'Backbone'
            ];

            for (const framework of jsFrameworks) {
                try {
                    const hasFramework = await driver.executeScript(`return typeof window.${framework} !== 'undefined'`);
                    if (hasFramework) {
                        console.log(`   🚨 ${framework} detected - page likely uses dynamic loading`);
                    }
                } catch (e) {
                    // Framework not present
                }
            }

            return true;
        } catch (error) {
            console.error('Debug failed:', error);
            return false;
        }
    }

    async waitForPageComplete(driver) {
        console.log('⏳ Waiting for page to complete loading...');
        
        // Wait for basic page load
        await driver.wait(until.elementLocated(By.css('body')), 30000);
        
        // Wait for document ready state
        await driver.wait(async () => {
            const readyState = await driver.executeScript('return document.readyState');
            return readyState === 'complete';
        }, 30000);

        // Wait for any loading indicators to disappear
        const loadingSelectors = [
            '.loading', '.loader', '.spinner', '.preloader', 
            '[class*="loading"]', '[class*="spinner"]',
            '.fa-spinner', '.loading-overlay'
        ];

        for (const selector of loadingSelectors) {
            try {
                await driver.wait(async () => {
                    const elements = await driver.findElements(By.css(selector));
                    return elements.length === 0;
                }, 10000);
            } catch (e) {
                // Loading selector might not exist, continue
            }
        }

        // Scroll to trigger any lazy loading
        await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
        await driver.sleep(2000);
        await driver.executeScript('window.scrollTo(0, 0)');
        await driver.sleep(1000);

        console.log('✅ Page loading complete');
    }

    async handleInteractiveElements(driver) {
        console.log('🔄 Checking for interactive elements...');
        
        // Common interactive elements that might reveal content
        const interactiveSelectors = [
            // Tabs and navigation
            'a[href*="#"]',
            '.tab', '.nav-tab', '.nav-link',
            '[data-toggle="tab"]',
            
            // Dropdowns and selects
            'select[name*="season"]', 'select[name*="pool"]', 'select[name*="group"]',
            'select#season', 'select#pool', 'select#group', 'select#region',
            
            // Buttons
            'button[data-season]', 'button[data-pool]',
            '.btn[data-target]', '.button[data-target]',
            
            // Show/hide toggles
            '[onclick*="show"]', '[onclick*="toggle"]',
            '.show-results', '.show-matches',
            
            // Calendar/date controls
            '.calendar-control', '[data-date]',
            'input[type="date"]'
        ];

        for (const selector of interactiveSelectors) {
            try {
                const elements = await driver.findElements(By.css(selector));
                console.log(`   Found ${elements.length} elements matching: ${selector}`);
                
                if (elements.length > 0 && elements.length < 5) {
                    for (let i = 0; i < elements.length; i++) {
                        try {
                            const element = elements[i];
                            const text = await element.getText();
                            const href = await element.getAttribute('href');
                            const onclick = await element.getAttribute('onclick');
                            
                            console.log(`   Trying to interact with: "${text}" (href: ${href}, onclick: ${onclick})`);
                            
                            // Try clicking the element
                            await driver.executeScript("arguments[0].scrollIntoView(true);", element);
                            await driver.sleep(500);
                            await driver.executeScript("arguments[0].click();", element);
                            await driver.sleep(3000); // Wait for content to load
                            
                            // Check if new content appeared
                            const tablesAfter = await driver.findElements(By.css('table'));
                            if (tablesAfter.length > 0) {
                                console.log(`   ✅ Found ${tablesAfter.length} tables after clicking!`);
                                return true;
                            }
                            
                        } catch (clickError) {
                            console.log(`   ❌ Click failed: ${clickError.message}`);
                        }
                    }
                }
            } catch (e) {
                // Selector not found, continue
            }
        }
        
        return false;
    }

    async scrapeResults(driver, url, venue) {
        try {
            console.log(`🌐 Loading URL: ${url}`);
            await driver.get(url);
            
            // Wait for initial page load
            await this.waitForPageComplete(driver);
            
            // Debug the page content
            await this.debugPageContent(driver, url);
            
            // Try to interact with elements that might show content
            const interactionSuccessful = await this.handleInteractiveElements(driver);
            
            if (interactionSuccessful) {
                console.log('🎉 Found content after interaction!');
            } else {
                console.log('⚠️  No additional content found through interactions');
            }
            
            // Try to find any table
            const table = await this.findResultsTable(driver);
            if (!table) {
                console.log('❌ No table found, trying alternative content extraction...');
                return await this.extractAlternativeContent(driver, venue);
            }
            
            // Process table data
            console.log('✅ Table found, processing data...');
            return await this.extractMatchesFromTable(driver, table, venue);
            
        } catch (error) {
            console.error('❌ Scrape error:', error);
            return [];
        }
    }

    // Alternative content extraction for non-table layouts
    async extractAlternativeContent(driver, venue) {
        console.log('🔍 Trying alternative content extraction methods...');
        
        const contentSelectors = [
            '.match', '.game', '.fixture',
            '.match-item', '.game-item', '.fixture-item',
            '[data-match]', '[data-game]', '[data-fixture]',
            '.result', '.score',
            'li', 'div[class*="match"]', 'div[class*="game"]'
        ];

        for (const selector of contentSelectors) {
            try {
                const elements = await driver.findElements(By.css(selector));
                if (elements.length > 0) {
                    console.log(`Found ${elements.length} elements with selector: ${selector}`);
                    
                    const matches = [];
                    for (let i = 0; i < Math.min(elements.length, 20); i++) {
                        try {
                            const element = elements[i];
                            const text = await element.getText();
                            const innerHTML = await element.getAttribute('innerHTML');
                            
                            if (text && text.length > 10) {
                                matches.push({
                                    match_id: uuidv4(),
                                    raw_text: text,
                                    raw_html: innerHTML,
                                    venue: venue,
                                    extraction_method: selector
                                });
                            }
                        } catch (elementError) {
                            console.log(`Error extracting element ${i}: ${elementError.message}`);
                        }
                    }
                    
                    if (matches.length > 0) {
                        console.log(`✅ Extracted ${matches.length} potential matches using ${selector}`);
                        return matches;
                    }
                }
            } catch (e) {
                // Continue to next selector
            }
        }
        
        console.log('❌ No alternative content found');
        return [];
    }

    async findResultsTable(driver) {
        const selectors = [
            'table#standings', 'table.results', 'table.match-table',
            'table.table-striped', 'table.table-bordered',
            'div#results table', 'div.table-container table',
            'table.data-table', '.matches-table table',
            'table', // Fallback to any table
        ];
        
        for (const selector of selectors) {
            console.log(`🔍 Trying table selector: ${selector}`);
            try {
                const tables = await driver.findElements(By.css(selector));
                console.log(`   Found ${tables.length} tables`);
                
                for (const table of tables) {
                    if (await table.isDisplayed()) {
                        const rowCount = await driver.executeScript(`
                            return arguments[0].querySelectorAll('tr').length;
                        `, table);
                        
                        console.log(`   Table has ${rowCount} rows`);
                        
                        if (rowCount > 1) { // At least header + 1 data row
                            console.log(`✅ Found valid table with selector: ${selector}`);
                            return table;
                        }
                    }
                }
            } catch (e) {
                console.log(`❌ Selector ${selector} failed: ${e.message}`);
                continue;
            }
        }
        
        console.log('❌ No valid table found');
        return null;
    }

    // Rest of your existing methods remain the same...
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

    async scrapeMatchesForPool({ pool, linkStructure, venue, season }) {
        try {
            console.log(`\n🏊 Scraping matches for pool: ${pool.pool_name}`);
            await this.initDriver();
            
            const url = linkStructure
                .replace('{pool}', pool.pool_value)
                .replace('{group}', pool.age_group_id)
                .replace('{region}', pool.region_id)
                .replace('{season}', season);
            
            console.log(`🔗 Scraping URL: ${url}`);
            const matches = await this.scrapeResults(this.driver, url, venue);
            
            console.log(`📊 Raw matches found: ${matches.length}`);
            
            // Process and standardize matches
            const processedMatches = matches.map(match => ({
                match_id: match.match_id || uuidv4(),
                team1: match.hjemmehold || match.home_team || match.team1 || 'Unknown',
                team2: match.udehold || match.away_team || match.team2 || 'Unknown',
                date: match.dato || match.date || new Date().toISOString(),
                venue: match.spillested || match.venue || venue,
                pool_id: pool.pool_id,
                season: season,
                home_score: match.hjemmescore || match.home_score,
                away_score: match.udescore || match.away_score,
                round: match.runde || match.round,
                raw_data: match // Keep all original data for debugging
            }));
            
            console.log(`✅ Processed ${processedMatches.length} matches for pool ${pool.pool_name}`);
            return processedMatches;
        } catch (error) {
            console.error(`❌ Error scraping pool ${pool.pool_name}:`, error);
            return [];
        }
    }

    // Keep all your existing methods for extractMatchesFromTable, insertMatches, etc.
    async extractMatchesFromTable(driver, table, venue) {
        // Scroll table into view and wait
        await driver.executeScript("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", table);
        await driver.sleep(1500);
        
        const tableHtml = await table.getAttribute('outerHTML');
        console.log(`📋 Table HTML length: ${tableHtml.length} characters`);
        
        const dom = new JSDOM(`<!DOCTYPE html>${tableHtml}`);
        const doc = dom.window.document;
        
        // Extract headers
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
        }
        
        console.log(`📊 Headers found: ${headers.join(', ')}`);
        
        // Extract matches
        const matches = [];
        const rows = doc.querySelectorAll('tr:not(.headerrow)');
        console.log(`📋 Data rows found: ${rows.length}`);
        
        rows.forEach((row, rowIndex) => {
            try {
                const cells = row.querySelectorAll('td');
                const matchData = {};
                
                cells.forEach((cell, index) => {
                    if (index >= headers.length) return;
                    
                    const value = cell.textContent.trim();
                    matchData[headers[index]] = value;
                    
                    // Extract team IDs from links
                    if (headers[index].includes('hold')) {
                        const link = cell.querySelector('a');
                        if (link) {
                            const href = link.getAttribute('href') || '';
                            const onclick = link.getAttribute('onclick') || '';
                            
                            const idPatterns = [
                                /ShowStanding\(.*?'(\d+)'/,
                                /team_id=(\d+)/,
                                /\/team\/(\d+)/,
                                /id=(\d+)/
                            ];
                            
                            for (const pattern of idPatterns) {
                                const match = (onclick + href).match(pattern);
                                if (match) {
                                    matchData[`${headers[index]}_id`] = match[1];
                                    break;
                                }
                            }
                        }
                    }
                });
                
                // Venue filtering
                const venueKey = headers.find(h => h.includes('spillested')) || 'venue';
                if (!venue || 
                    !matchData[venueKey] || 
                    matchData[venueKey].toLowerCase().includes(venue.toLowerCase())) {
                    
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
                        row_index: rowIndex,
                        raw_data: matchData
                    });
                }
                
            } catch (rowError) {
                console.error(`Error processing row ${rowIndex}:`, rowError);
            }
        });
        
        console.log(`✔ Extracted ${matches.length} matches from table`);
        return matches;
    }

    async getScraperProgress(sessionId) {
        try {
            if (this.progress.sessionId === sessionId || !sessionId) {
                return {
                    success: true,
                    progress: {
                        status: this.progress.status,
                        totalPools: this.progress.totalPools,
                        poolsProcessed: this.progress.poolsProcessed,
                        totalMatches: this.progress.totalMatches,
                        error: this.progress.error
                    }
                };
            }
            return {
                success: false,
                message: `No progress found for session ${sessionId}`
            };
        } catch (error) {
            console.error('Error getting scraper progress:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }
async insertMatches(matches, metadata) {
    if (!Array.isArray(matches) || matches.length === 0) {
        console.log('No matches to insert');
        return;
    }
    let connection;
    try {
        connection = await this.pool.getConnection();
        for (const match of matches) {
            await connection.execute(
                `INSERT INTO cal_sync_matches 
                 (season_name, region_name, age_group_name, pool_name, tournament_level,
                  google_color_id, season, region, age_group, pool_value, venue, hex_color,
                  match_data, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    metadata.season_name || 'Unknown',
                    metadata.region_name || 'Unknown',
                    metadata.age_group_name || 'Unknown',
                    metadata.pool_name || 'Unknown',
                    metadata.tournament_level || 'Unknown',
                    metadata.google_color_id !== null && metadata.google_color_id !== undefined ? parseInt(metadata.google_color_id) : null, // Handle integer or NULL
                    metadata.season || 'Unknown',
                    metadata.region || 'Unknown',
                    metadata.ageGroup || 'Unknown',
                    metadata.poolValue || 'Unknown',
                    metadata.venue || 'Unknown',
                    metadata.hex_color || '#000000',
                    JSON.stringify(match)
                ]
            );
        }
        console.log(`💾 Inserted ${matches.length} matches to database`);
    } catch (error) {
        console.error('❌ Error inserting matches:', error);
        throw error; // Propagate error to caller
    } finally {
        if (connection) connection.release();
    }
}

    // Keep all your other existing methods...
    async runAllCalendarScraper(params) {
        let connection;
        try {
            const { season, linkStructure, venue, sessionId } = params;
            connection = await pool.getConnection();
            const pools = await this.loadPools(season);
            if (!pools || pools.length === 0) {
                throw new Error(`No tournament pools found for season ${season}`);
            }
            
            let totalMatches = 0;
            const allMatches = [];
            
            for (const pool of pools) {
                console.log('Processing pool:', pool);
                const matches = await this.scrapeMatchesForPool({ 
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
            
            // Save matches
            if (allMatches.length > 0) {
                await this.insertMatches(allMatches, {
                    season_name: season,
                    region_name: pools[0].region_name || 'Unknown',
                    age_group_name: pools[0].age_group_name || 'Unknown',
                    pool_name: pools[0].pool_name || 'Unknown',
                    tournament_level: pools[0].tournament_level || 'Unknown',
                    google_color_id: pools[0].google_color_id || 'Unknown',
                    season,
                    region: pools[0].region_id || 'Unknown',
                    ageGroup: pools[0].age_group_id || 'Unknown',
                    poolValue: pools[0].pool_value || 'Unknown',
                    venue,
                    hex_color: pools[0].hex_color || '#000000'
                });
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

    async closePool() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}

module.exports = ScraperService;