const ScraperService = require('../services/scraperService');

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'scraper_db'
};

const scraperService = new ScraperService(dbConfig);

const runAllCalendarScraper = async (req, res) => {
    try {
        const { season, linkStructure, venue, sessionId } = req.body;
        const finalSessionId = sessionId || `session_${Date.now()}`;

        console.log('🚀 Starting scraper with params:', { 
            season, 
            linkStructure, 
            venue, 
            sessionId: finalSessionId 
        });

        // Validate required parameters
        if (!season) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: season'
            });
        }

        if (!linkStructure) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: linkStructure'
            });
        }

        if (!venue) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: venue'
            });
        }

        const result = await scraperService.runAllCalendarScraper({
            season,
            linkStructure,
            venue,
            sessionId: finalSessionId
        });

        console.log('✅ Scraper service result:', result);

        res.json(result);
    } catch (error) {
        console.error('❌ Controller error:', error);
        res.status(500).json({
            success: false,
            message: `Server error: ${error.message}`,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

const getScraperProgress = async (req, res) => {
    try {
        const { session_id } = req.query;
        
        if (!session_id) {
            return res.status(400).json({
                success: false,
                data: { message: 'Session ID is required' }
            });
        }

        const result = await scraperService.getScraperProgress(session_id);
        res.json(result);
    } catch (error) {
        console.error('Error getting progress:', error);
        res.status(500).json({
            success: false,
            data: { message: `Server error: ${error.message}` }
        });
    }
};

const deleteAllEvents = async (req, res) => {
    try {
        const connection = await scraperService.pool.getConnection();
        const [result] = await connection.execute('DELETE FROM cal_sync_matches');
        connection.release();

        res.json({
            success: true,
            message: `Deleted ${result.affectedRows} matches successfully`
        });
    } catch (error) {
        console.error('Error deleting events:', error);
        res.status(500).json({
            success: false,
            message: `Error deleting events: ${error.message}`
        });
    }
};

const clearLog = async (req, res) => {
    try {
        const connection = await scraperService.pool.getConnection();
        await connection.execute('DELETE FROM cal_sync_logs');
        connection.release();

        res.json({
            success: true,
            message: 'Log cleared successfully'
        });
    } catch (error) {
        console.error('Error clearing log:', error);
        res.status(500).json({
            success: false,
            message: `Error clearing log: ${error.message}`
        });
    }
};

const getLogInfo = async (req, res) => {
    try {
        const connection = await scraperService.pool.getConnection();
        const [logs] = await connection.execute(`
            SELECT * FROM cal_sync_logs 
            ORDER BY start_datetime DESC 
            LIMIT 50
        `);
        connection.release();

        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error('Error fetching log info:', error);
        res.status(500).json({
            success: false,
            message: `Error fetching log info: ${error.message}`
        });
    }
};

const saveVenueSearch = async (req, res) => {
    try {
        const { venue, searchTime } = req.body;
        
        const connection = await scraperService.pool.getConnection();
        await connection.execute(`
            INSERT INTO venue_searches (venue, search_time, created_at)
            VALUES (?, ?, NOW())
        `, [venue, searchTime]);
        connection.release();

        res.json({
            success: true,
            message: 'Venue search saved successfully'
        });
    } catch (error) {
        console.error('Error saving venue search:', error);
        res.status(500).json({
            success: false,
            message: `Error saving venue search: ${error.message}`
        });
    }
};

const getLastVenue = async (req, res) => {
    try {
        const connection = await scraperService.pool.getConnection();
        const [rows] = await connection.execute(`
            SELECT venue FROM venue_searches 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        connection.release();

        if (rows.length > 0) {
            res.json({
                success: true,
                venue: rows[0].venue
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'No venues found in database'
            });
        }
    } catch (error) {
        console.error('Error fetching last venue:', error);
        res.status(500).json({
            success: false,
            message: `Error fetching last venue: ${error.message}`
        });
    }
};

// Cleanup function
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, closing database pool...');
    await scraperService.closePool();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, closing database pool...');
    await scraperService.closePool();
    process.exit(0);
});

module.exports = {
    runAllCalendarScraper,
    getScraperProgress,
    deleteAllEvents,
    clearLog,
    getLogInfo,
    saveVenueSearch,
    getLastVenue
};
