const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { JSDOM } = require('jsdom');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');


class ScraperService {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.driver = null;
        this.pool = null;
        this.initDatabase();
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
        try {
            const connection = await this.pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT 
                    region_id,
                    age_group_id,
                    pool_value,
                    tournament_level,
                    pool_name,
                    season_name,
                    region_name,
                    age_group_name,
                    google_color_id,
                    hex_color
                FROM tournament_pools 
                WHERE season = ?
            `, [season]);
            
            connection.release();
            return rows;
        } catch (error) {
            console.error('Error loading pools:', error);
            return [];
        }
    }

    async scrapeResults(driver, url, venue) {
        try {
            await driver.get(url);
            await driver.wait(until.elementLocated(By.css('table.matchlist')), 15000);

            // Scroll to load content
            let lastHeight = await driver.executeScript('return document.body.scrollHeight;');
            for (let i = 0; i < 2; i++) {
                await driver.executeScript('window.scrollTo(0, document.body.scrollHeight);');
                await driver.sleep(500);
                const newHeight = await driver.executeScript('return document.body.scrollHeight;');
                const rowCount = await driver.executeScript('return document.querySelectorAll("table.matchlist tr:not(.headerrow)").length;');
                if (rowCount > 0 || newHeight === lastHeight) break;
                lastHeight = newHeight;
            }

            await driver.wait(until.elementLocated(By.css('table.matchlist tr:not(.headerrow)')), 15000);

            const html = await driver.getPageSource();
            if (!html) {
                return { error: `Empty page source returned for URL: ${url}` };
            }

            const dom = new JSDOM(html);
            const document = dom.window.document;
            const table = document.querySelector('table.matchlist');

            if (!table) {
                return { error: 'No matchlist table found' };
            }

            // Extract headers
            const headers = [];
            const headerRow = table.querySelector('tr.headerrow');
            if (headerRow) {
                const headerCells = headerRow.querySelectorAll('td');
                headerCells.forEach(cell => {
                    let headerText = cell.textContent.toLowerCase().replace(/\s/g, '');
                    headerText = headerText === '#' ? 'no' : headerText;
                    headers.push(headerText);
                });
            }

            // Extract matches
            const matches = [];
            const rows = table.querySelectorAll('tr:not(.headerrow)');
            
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const rowData = {};
                
                cells.forEach((cell, index) => {
                    const value = cell.textContent.trim();
                    const link = cell.querySelector('a');
                    
                    if (link && ['hjemmehold', 'udehold'].includes(headers[index])) {
                        const onclick = link.getAttribute('onclick');
                        const match = onclick?.match(/ShowStanding\((?:'[^']*',\s*){5}'(\d+)'/);
                        if (match) {
                            rowData[`${headers[index]}_id`] = match[1];
                        }
                    }
                    
                    if (index < headers.length) {
                        rowData[headers[index]] = value;
                    }
                });

                // Filter by venue
                if (rowData.spillested && 
                    rowData.spillested.toLowerCase().trim() === venue.toLowerCase().trim()) {
                    matches.push(rowData);
                }
            });

            return matches;
        } catch (error) {
            return { error: error.message };
        }
    }

    async runAllCalendarScraper(params) {
        const { season, linkStructure, venue, sessionId } = params;
        let logId = null;
        let grandTotalMatches = 0;
        const logMessages = [];

        try {
            // Load tournament pools
            const allPools = await this.loadPools(season);
            console.log('Loaded pools:', allPools.length);

            if (allPools.length === 0) {
                console.warn(`No pools found for season ${season}`);
                return {
                    success: false,
                    totalMatches: 0,
                    message: 'No tournament pools available for the specified season'
                };
            }

            // Start logging
            const initialMessage = `Starting session ${sessionId}, searching venue: ${venue}`;
            logId = await this.startLog(season, 0, 0, 0, sessionId, initialMessage);
            logMessages.push(initialMessage);

            // Initialize WebDriver
            const driver = await this.initDriver();
            console.log(`Browser initialized successfully for session: ${sessionId}`);

            // Process each pool
            for (const pool of allPools) {
                const {
                    region_id: region,
                    age_group_id: ageGroup,
                    pool_value: poolValue,
                    tournament_level,
                    pool_name,
                    season_name,
                    region_name,
                    age_group_name,
                    google_color_id,
                    hex_color
                } = pool;

                const url = linkStructure
                    .replace('{season}', season)
                    .replace('{region}', region)
                    .replace('{group}', ageGroup)
                    .replace('{pool}', poolValue);

                const matches = await this.scrapeResults(driver, url, venue);
                const totalMatches = Array.isArray(matches) ? matches.length : 0;

                if (matches.error) {
                    const errorMsg = `Error in pool ${tournament_level} - ${pool_name} (${poolValue}): ${matches.error}`;
                    logMessages.push(errorMsg);
                    console.error(errorMsg);
                } else {
                    const successMsg = `Season: ${season_name}, Region: ${region_name}, Age Group: ${age_group_name} -> Pool ${tournament_level} - ${pool_name} (${poolValue}): Found ${totalMatches} matches`;
                    logMessages.push(successMsg);
                    console.log(successMsg);

                    // Insert matches into database
                    await this.insertMatches(matches, {
                        season_name,
                        region_name,
                        age_group_name,
                        pool_name,
                        tournament_level,
                        google_color_id: google_color_id || 0,
                        season,
                        region,
                        ageGroup,
                        poolValue,
                        venue,
                        hex_color: hex_color || '#039be5'
                    });
                }

                grandTotalMatches += totalMatches;
                
                // Update log progress
                await this.updateLog(logId, grandTotalMatches, logMessages.join('\n'), 'running');
            }

            // Cleanup
            await this.quitDriver();
            console.log(`Browser quit for session: ${sessionId}`);

            // Final log update
            await this.updateLog(logId, grandTotalMatches, logMessages.join('\n'), 'completed');
            
            const finalMessage = `Scraping completed! Found ${grandTotalMatches} matches`;
            
            return {
                success: true,
                totalMatches: grandTotalMatches,
                message: finalMessage,
                matches: [] // You might want to return actual matches here
            };

        } catch (error) {
            console.error('Scraper error:', error);
            
            const errorMessage = `Error fetching data: ${error.message}`;
            logMessages.push(errorMessage);
            
            if (logId) {
                await this.updateLog(logId, grandTotalMatches, logMessages.join('\n'), 'failed');
            }
            
            await this.quitDriver();
            
            return {
                success: false,
                totalMatches: grandTotalMatches,
                message: errorMessage
            };
        }
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