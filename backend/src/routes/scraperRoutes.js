const express = require('express');
const scrapperController = require('../controllers/scrapperController');
const router = express.Router();

router.post('/run-all-calendar-scraper', scrapperController.runAllCalendarScraper);
router.get('/get-scraper-progress', scrapperController.getScraperProgress);
// Add other routes

module.exports = router;