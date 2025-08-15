const express = require('express');
const {
    runAllCalendarScraper,
    getScraperProgress,
    deleteAllEvents,
    clearLog,
    getLogInfo,
    saveVenueSearch,
    getLastVenue,
    getMatches,
    clearMatches
} = require('../controllers/scraperController');

const router = express.Router();

// Simple debug middleware
router.use((req, res, next) => {
    console.log(`Scraper route: ${req.method} ${req.path}`);
    next();
});

// Basic route handlers without async/await wrappers
router.post('/run-all-calendar-scraper', runAllCalendarScraper);
router.get('/scraper-progress', getScraperProgress);
router.delete('/events', deleteAllEvents);
router.delete('/logs', clearLog);
router.get('/logs', getLogInfo);
router.post('/venue-search', saveVenueSearch);
router.get('/last-venue', getLastVenue);
router.delete('/matches', clearMatches);
router.get('/matches', getMatches);

// Simple test endpoint
router.get('/test', (req, res) => {
    res.json({ 
        status: 'ok',
        routes: [
            'POST /run-all-calendar-scraper',
            'GET /scraper-progress',
            'DELETE /events',
            'DELETE /logs',
            'GET /logs',
            'POST /venue-search',
            'GET /last-venue'
        ]
    });
});

module.exports = router;