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
                    '--headless=new',
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--window-size=1920,1080',
                    `--user-data-dir=/tmp/chrome-profile-${uuidv4()}`,
                    '--disable-extensions',
                    '--disable-blink-features=AutomationControlled',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    '--blink-settings=imagesEnabled=false'
                );
                    
                    options.excludeSwitches('enable-automation');
                    options.addArguments('--disable-blink-features=AutomationControlled');
                    
                    this.driver = await new Builder()
                        .forBrowser('chrome')
                        .setChromeOptions(options)
                        .build();
                    
                    // Remove webdriver traces
                    await this.driver.executeScript(`
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                    `);
                    
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

async handleAlerts(driver) {
    try {
        const alert = await driver.switchTo().alert();
        const alertText = await alert.getText();
        console.log(`🚨 Alert detected: "${alertText}"`);
        await alert.accept();
        await driver.sleep(1000);
        return { success: false, message: alertText }; // Indicate failure for retry
    } catch (e) {
        return { success: true, message: 'No alert present' };
    }
}

async scrapeResults(driver, url, venue, retries = 0) {
    let allMatches = [];
    let hasNextPage = true;
    let currentUrl = url;
    
    while (hasNextPage) {
        console.log(`🌐 Scraping page: ${currentUrl} (Attempt ${retries + 1}/3)`);
        try {
            await driver.get(currentUrl);
            const alertResult = await this.handleAlerts(driver);
            if (!alertResult.success && retries < 2) {
                console.log(`⚠️ Retrying due to alert: ${alertResult.message}`);
                await driver.sleep(2000);
                return await this.scrapeResults(driver, url, venue, retries + 1);
            }
            
            await this.waitForPageComplete(driver);
            await this.debugPageContent(driver, currentUrl);
            
            const interactionSuccessful = await this.handleInteractiveElements(driver);
            console.log(interactionSuccessful ? '🎉 Found content after interaction' : '⚠️ No additional content from interactions');
            
            const table = await this.findResultsTable(driver);
            const matches = table ? await this.extractMatchesFromTable(driver, table, venue) : await this.extractAlternativeContent(driver, venue);
            console.log(`📊 Matches on page: ${matches.length}`);
            allMatches.push(...matches);
            
            // Check for next page
            const nextButton = await driver.findElements(By.css('.pagination .next-page, [rel="next"], a[href*="page="], .page-link'));
            if (nextButton.length > 0 && await nextButton[0].isDisplayed()) {
                currentUrl = await nextButton[0].getAttribute('href');
                console.log(`🔗 Navigating to next page: ${currentUrl}`);
                await driver.sleep(1000);
            } else {
                hasNextPage = false;
                console.log('🏁 No more pages to scrape');
            }
        } catch (error) {
            console.error(`❌ Page scrape error: ${error.message}`);
            if (error.name === 'UnexpectedAlertOpenError' && retries < 2) {
                await driver.sleep(2000);
                return await this.scrapeResults(driver, url, venue, retries + 1);
            }
            hasNextPage = false;
        }
    }
    
    console.log(`✔ Total matches from all pages: ${allMatches.length}`);
    return allMatches;
}

async waitForPageComplete(driver) {
    console.log('⏳ Waiting for page to complete loading...');
    
    try {
        // Handle any immediate alerts
        await this.handleAlerts(driver);
        
        // Wait for body element
        await driver.wait(until.elementLocated(By.css('body')), 30000)
            .catch(async (error) => {
                console.error('Body element timeout:', error);
                await this.handleAlerts(driver); // Check for alerts on timeout
                throw error;
            });
        
        // Wait for document ready state
        await driver.wait(async () => {
            await this.handleAlerts(driver); // Check for alerts during ready state
            const readyState = await driver.executeScript('return document.readyState');
            return readyState === 'complete';
        }, 30000);
        
        // Wait for loading indicators to disappear
        const loadingSelectors = [
            '.loading', '.loader', '.spinner', '.preloader', 
            '[class*="loading"]', '[class*="spinner"]',
            '.fa-spinner', '.loading-overlay'
        ];
        
        for (const selector of loadingSelectors) {
            try {
                await driver.wait(async () => {
                    await this.handleAlerts(driver); // Check for alerts during loading
                    const elements = await driver.findElements(By.css(selector));
                    return elements.length === 0;
                }, 10000);
            } catch (e) {
                console.log(`No elements found for selector ${selector}`);
                await this.handleAlerts(driver);
            }
        }
        
        // Scroll to trigger lazy loading
        await this.handleAlerts(driver);
        await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
        await driver.sleep(2000);
        await this.handleAlerts(driver);
        await driver.executeScript('window.scrollTo(0, 0)');
        await driver.sleep(1000);
        await this.handleAlerts(driver);
        
        console.log('✅ Page loading complete');
    } catch (error) {
        console.error('❌ Page loading failed:', error);
        await this.handleAlerts(driver); // Final alert check
        throw error;
    }
}
async handleInteractiveElements(driver) {
    console.log('🔄 Checking for interactive elements...');
    const interactiveSelectors = [
        'a[href*="#"]', '.tab', '.nav-tab', '.nav-link', '[data-toggle="tab"]',
        'select[name*="season"]', 'select[name*="pool"]', 'select[name*="group"]',
        'select#season', 'select#pool', 'select#group', 'select#region',
        'button[data-season]', 'button[data-pool]', '.btn[data-target]', 
        '.button[data-target]', '[onclick*="show"]', '[onclick*="toggle"]',
        '.show-results', '.show-matches', '.calendar-control', '[data-date]',
        'input[type="date"]', '.dropdown-menu a', '[role="button"]',
        '.match-list-toggle', '.results-toggle', '.kamp-toggle', '.holdkamp-toggle'
    ];
    
    for (const selector of interactiveSelectors) {
        try {
            await this.handleAlerts(driver);
            const elements = await driver.findElements(By.css(selector));
            console.log(`   Found ${elements.length} elements matching: ${selector}`);
            
            if (elements.length > 0 && elements.length < 10) {
                for (let i = 0; i < elements.length; i++) {
                    try {
                        const element = elements[i];
                        const text = await element.getText();
                        const tag = await element.getTagName();
                        const href = await element.getAttribute('href') || '';
                        const onclick = await element.getAttribute('onclick') || '';
                        
                        console.log(`   Trying to interact with ${tag}: "${text}" (href: ${href}, onclick: ${onclick})`);
                        await driver.executeScript("arguments[0].scrollIntoView(true);", element);
                        await driver.sleep(500);
                        
                        if (tag === 'select') {
                            const options = await element.findElements(By.css('option'));
                            for (let j = 0; j < options.length; j++) {
                                const optionText = await options[j].getText();
                                if (optionText.includes('2024/2025') || optionText.toLowerCase().includes('pool c')) {
                                    await driver.executeScript(`arguments[0].value = arguments[0].options[${j}].value; arguments[0].dispatchEvent(new Event('change'));`, element);
                                    console.log(`   Selected option: ${optionText}`);
                                    await driver.sleep(3000);
                                    break;
                                }
                            }
                        } else {
                            await driver.executeScript("arguments[0].click();", element);
                        }
                        
                        await driver.sleep(3000);
                        await this.handleAlerts(driver);
                        
                        const tablesAfter = await driver.findElements(By.css('table, .match, .game, .fixture, .kamp, .holdkamp'));
                        if (tablesAfter.length > 0) {
                            console.log(`   ✅ Found ${tablesAfter.length} elements after interaction!`);
                            return true;
                        }
                    } catch (clickError) {
                        console.log(`   ❌ Interaction failed: ${clickError.message}`);
                    }
                }
            }
        } catch (e) {
            console.log(`   ❌ Selector ${selector} failed: ${e.message}`);
        }
    }
    
    return false;
}
async scrapeResults(driver, url, venue, retries = 0) {
    try {
        console.log(`🌐 Loading URL: ${url} (Attempt ${retries + 1}/3)`);
        await driver.get(url);
        const alertResult = await this.handleAlerts(driver);
        if (!alertResult.success && retries < 2) {
            console.log(`⚠️ Retrying due to alert: ${alertResult.message}`);
            await driver.sleep(2000);
            return await this.scrapeResults(driver, url, venue, retries + 1);
        }
        
        await this.waitForPageComplete(driver);
        await this.handleAlerts(driver);
        
        await this.debugPageContent(driver, url);
        
        const interactionSuccessful = await this.handleInteractiveElements(driver);
        if (interactionSuccessful) {
            console.log('🎉 Found content after interaction!');
        } else {
            console.log('⚠️ No additional content found through interactions');
        }
        
        const table = await this.findResultsTable(driver);
        await this.handleAlerts(driver);
        if (!table) {
            console.log('❌ No table found, trying alternative content extraction...');
            return await this.extractAlternativeContent(driver, venue);
        }
        
        console.log('✅ Table found, processing data...');
        return await this.extractMatchesFromTable(driver, table, venue);
    } catch (error) {
        console.error('❌ Scrape error:', error);
        await this.handleAlerts(driver);
        if (error.name === 'UnexpectedAlertOpenError' && retries < 2) {
            console.log(`⚠️ Retrying after UnexpectedAlertOpenError (Attempt ${retries + 1}/3)`);
            await driver.sleep(2000);
            return await this.scrapeResults(driver, url, venue, retries + 1);
        }
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
        '.result', '.score', 'div[class*="match"]', 
        'div[class*="game"]', 'div[class*="result"]',
        '.kamp', '.holdkamp', '.kamp-item', '.holdkamp-item' // Danish-specific
    ];
    
    for (const selector of contentSelectors) {
        try {
            await this.handleAlerts(driver);
            const elements = await driver.findElements(By.css(selector));
            console.log(`Found ${elements.length} elements with selector: ${selector}`);
            
            const matches = [];
            for (let i = 0; i < Math.min(elements.length, 20); i++) {
                try {
                    const element = elements[i];
                    const text = await element.getText();
                    const innerHTML = await element.getAttribute('innerHTML');
                    
                    // Stricter validation for match data
                    const teamPattern = /(\w[\w\s]+)\s+vs\.?\s+(\w[\w\s]+)/i;
                    const datePattern = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/;
                    const scorePattern = /\b(\d+)-(\d+)\b/;
                    const teamMatch = text.match(teamPattern);
                    const dateMatch = text.match(datePattern);
                    const scoreMatch = text.match(scorePattern);
                    
                    if (teamMatch && teamMatch[1] !== 'Holdturnering' && teamMatch[2] !== 'Holdturnering' && text.toLowerCase().includes(venue.toLowerCase())) {
                        matches.push({
                            match_id: uuidv4(),
                            home_team: teamMatch[1].trim(),
                            away_team: teamMatch[2].trim(),
                            date: dateMatch ? dateMatch[1] : null,
                            time: text.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || null,
                            venue: venue,
                            home_score: scoreMatch ? scoreMatch[1] : null,
                            away_score: scoreMatch ? scoreMatch[2] : null,
                            raw_text: text,
                            raw_html: innerHTML,
                            extraction_method: selector
                        });
                    } else {
                        console.log(`❌ Skipped element ${i}: Invalid match data (text: "${text.substring(0, 50)}...")`);
                    }
                } catch (elementError) {
                    console.log(`Error extracting element ${i}: ${elementError.message}`);
                }
            }
            
            if (matches.length > 0) {
                console.log(`✅ Extracted ${matches.length} matches using ${selector}:`, JSON.stringify(matches, null, 2));
                return matches;
            }
        } catch (e) {
            console.log(`❌ Selector ${selector} failed: ${e.message}`);
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
        'table', '.table', 'div.table', '[role="grid"]',
        '.kampe-table', '.holdkampe-table', '.kampoversigt' // Danish-specific
    ];
    
    for (const selector of selectors) {
        console.log(`🔍 Trying table selector: ${selector}`);
        try {
            await this.handleAlerts(driver);
            const tables = await driver.findElements(By.css(selector));
            console.log(`   Found ${tables.length} tables`);
            
            for (const table of tables) {
                if (await table.isDisplayed()) {
                    const rowCount = await driver.executeScript(`
                        return arguments[0].querySelectorAll('tr').length;
                    `, table);
                    
                    console.log(`   Table has ${rowCount} rows`);
                    if (rowCount > 1) {
                        console.log(`✅ Found valid table with selector: ${selector}`);
                        return table;
                    }
                }
            }
        } catch (e) {
            console.log(`❌ Selector ${selector} failed: ${e.message}`);
        }
    }
    
    console.log('❌ No valid table found');
    return null;
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

async scrapeMatchesForPool({ pool, linkStructure, venue, season }) {
    try {
        console.log(`\n🏊 Scraping matches for pool: ${pool.pool_name}`);
        await this.initDriver();
        
        // Validate pool parameters
        if (!pool.pool_value || !pool.age_group_id || !pool.region_id || !season) {
            console.error(`❌ Invalid pool parameters for ${pool.pool_name}:`, JSON.stringify(pool, null, 2));
            return [];
        }
        
        const url = linkStructure
            .replace('{pool}', pool.pool_value)
            .replace('{group}', pool.age_group_id)
            .replace('{region}', pool.region_id)
            .replace('{season}', season);
        
        console.log(`🔗 Constructed URL: ${url}`);
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
                }
            });
            console.log(`📡 URL status: ${response.status}`);
            if (response.status >= 400) {
                console.error(`❌ URL returned error status: ${response.status}`);
                return [];
            }
        } catch (error) {
            console.error(`❌ URL inaccessible: ${error.message}`);
            return [];
        }
        
        const matches = await this.scrapeResults(this.driver, url, venue);
        console.log(`📊 Raw matches:`, JSON.stringify(matches, null, 2));
        
        const processedMatches = matches.map(match => ({
            match_id: match.match_id || uuidv4(),
            team1: match.hjemmehold || match.home_team || match.team1 || 'Unknown',
            team2: match.udehold || match.away_team || match.team2 || 'Unknown',
            date: match.dato || match.date || new Date().toISOString().split('T')[0],
            time: match.tid || match.time || null,
            venue: match.spillested || match.venue || venue,
            pool_id: pool.pool_id,
            season: season,
            home_score: match.hjemmescore || match.home_score || null,
            away_score: match.udescore || match.away_score || null,
            round: match.runde || match.round || null,
            raw_data: match
        }));
        
        console.log(`✅ Processed ${processedMatches.length} matches for pool ${pool.pool_name}:`, JSON.stringify(processedMatches, null, 2));
        return processedMatches;
    } catch (error) {
        console.error(`❌ Error scraping pool ${pool.pool_name}:`, error);
        await this.handleAlerts(this.driver);
        return [];
    } finally {
        await this.quitDriver();
    }
}

async extractMatchesFromTable(driver, table, venue) {
    await driver.executeScript("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", table);
    await driver.sleep(1500);
    
    const tableHtml = await table.getAttribute('outerHTML');
    console.log(`📋 Table HTML (first 500 chars): ${tableHtml.substring(0, 500)}...`);
    
    const dom = new JSDOM(`<!DOCTYPE html>${tableHtml}`);
    const doc = dom.window.document;
    
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
        console.warn('⚠️ No header row detected, using default headers');
        headers.push('home_team', 'away_team', 'venue', 'date', 'time', 'score', 'round');
    }
    console.log(`📊 Headers found: ${headers.join(', ')}`);
    
    const matches = [];
    const rows = doc.querySelectorAll('tr:not(.headerrow)');
    console.log(`📋 Data rows found: ${rows.length}`);
    
    rows.forEach((row, rowIndex) => {
        try {
            const cells = row.querySelectorAll('td');
            const matchData = {};
            
            cells.forEach((cell, index) => {
                if (index < headers.length) {
                    const value = cell.textContent.trim();
                    matchData[headers[index]] = value;
                    
                    if (headers[index].includes('hold') || headers[index].includes('team')) {
                        const link = cell.querySelector('a');
                        if (link) {
                            matchData[headers[index]] = link.textContent.trim() || value;
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
                } else {
                    console.log(`⚠️ Extra cell at index ${index} ignored for row ${rowIndex}`);
                }
            });
            
            console.log(`📄 Row ${rowIndex} data:`, JSON.stringify(matchData, null, 2));
            
            const venueKey = headers.find(h => h.includes('spillested') || h.includes('venue') || h.includes('sted')) || 'venue';
            const homeTeamKey = headers.find(h => h.includes('hjemmehold') || h.includes('home') || h.includes('team1') || h.includes('hold1')) || 'home_team';
            const awayTeamKey = headers.find(h => h.includes('udehold') || h.includes('away') || h.includes('team2') || h.includes('hold2')) || 'away_team';
            
            const normalizeVenue = (str) => str?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '';
            const matchVenue = normalizeVenue(matchData[venueKey]);
            const targetVenue = normalizeVenue(venue);
            
            console.log(`🔍 Venue check: target=${targetVenue}, match=${matchVenue}, includes=${matchVenue.includes(targetVenue) || matchVenue.includes('grøndal')}`);
            if (!venue || !matchData[venueKey] || matchVenue.includes(targetVenue) || matchVenue.includes('grøndal')) {
                if (matchData[homeTeamKey] && matchData[awayTeamKey] && 
                    matchData[homeTeamKey].trim() !== 'Unknown' && 
                    matchData[awayTeamKey].trim() !== 'Unknown' && 
                    matchData[homeTeamKey].trim() !== '' && 
                    matchData[awayTeamKey].trim() !== '') {
                    matches.push({
                        match_id: matchData.id || matchData.no || uuidv4(),
                        date: matchData.dato || matchData.date || null,
                        time: matchData.tid || matchData.time || null,
                        home_team: matchData[homeTeamKey].trim(),
                        away_team: matchData[awayTeamKey].trim(),
                        venue: matchData[venueKey] || venue,
                        home_score: matchData.hjemmescore || matchData.score?.split('-')[0] || null,
                        away_score: matchData.udescore || matchData.score?.split('-')[1] || null,
                        round: matchData.runde || matchData.round || null,
                        row_index: rowIndex,
                        raw_data: matchData
                    });
                } else {
                    console.log(`❌ Row ${rowIndex} skipped: Invalid team names (home: "${matchData[homeTeamKey] || 'null'}", away: "${matchData[awayTeamKey] || 'null'}")`);
                }
            } else {
                console.log(`❌ Row ${rowIndex} filtered out: venue=${venue}, matchData[${venueKey}]=${matchData[venueKey] || 'null'}`);
            }
        } catch (rowError) {
            console.error(`Error processing row ${rowIndex}:`, rowError);
        }
    });
    
    console.log(`✔ Extracted ${matches.length} matches from table:`, JSON.stringify(matches, null, 2));
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
        console.log(`📋 Total pools loaded: ${pools.length}`, JSON.stringify(pools.map(p => ({
            pool_name: p.pool_name,
            pool_value: p.pool_value,
            region_id: p.region_id,
            age_group_id: p.age_group_id
        })), null, 2));
        if (!pools || pools.length === 0) {
            throw new Error(`No tournament pools found for season ${season}`);
        }
        
        this.progress.sessionId = sessionId;
        this.progress.status = 'running';
        this.progress.totalPools = pools.length;
        this.progress.poolsProcessed = 0;
        this.progress.totalMatches = 0;

        let totalMatches = 0;
        const allMatches = [];
        
        for (const pool of pools) {
            console.log(`🏊 Processing pool: ${pool.pool_name} (ID: ${pool.pool_value}, Region: ${pool.region_id}, Group: ${pool.age_group_id})`);
            this.progress.poolsProcessed++;
            const matches = await this.scrapeMatchesForPool({ 
                pool,
                linkStructure,
                venue,
                season
            });
            console.log(`📊 Matches for pool ${pool.pool_name}: ${matches.length}`, JSON.stringify(matches, null, 2));
            if (matches?.length > 0) {
                allMatches.push(...matches);
                totalMatches += matches.length;
                this.progress.totalMatches = totalMatches;
            }
        }
        
        if (allMatches.length > 0) {
            console.log(`💾 Saving ${allMatches.length} matches to database`);
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
        } else {
            console.warn(`⚠️ No matches found for venue ${venue}`);
        }
        
        this.progress.status = 'completed';
        return {
            success: true,
            totalMatches,
            message: `Successfully scraped ${totalMatches} matches`
        };
    } catch (error) {
        console.error('Scraping failed:', error);
        this.progress.status = 'failed';
        this.progress.error = error.message;
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