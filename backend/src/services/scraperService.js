const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { JSDOM } = require('jsdom');
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database'); 


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

       async scrapeMatchesForPool({ pool, linkStructure, venue, season }) {
        try {
            console.log(`Scraping matches for pool: ${pool.pool_name}`);
            
            // Implement your actual scraping logic here
            // Example placeholder - replace with real implementation:
            const matches = [
                {
                    match_id: '1',
                    team1: 'Team A',
                    team2: 'Team B',
                    date: '2024-01-01',
                    venue: venue || 'Unknown venue'
                }
            ];
            
            return matches;
        } catch (error) {
            console.error(`Error scraping pool ${pool.pool_id}:`, error);
            throw error;
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