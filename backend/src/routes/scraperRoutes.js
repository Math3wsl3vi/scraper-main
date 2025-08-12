const express = require('express');
const ScraperController = require('../controllers/scrapperController');
const router = express.Router();

// Create an instance of the controller
const scraperController = new ScraperController();

// Scraping operations
router.post('/start', scraperController.startScraping.bind(scraperController));
router.get('/status/:scrapeId', scraperController.getScrapingStatus.bind(scraperController));

module.exports = router;
