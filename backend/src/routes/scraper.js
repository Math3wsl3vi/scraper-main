const express = require('express');
const scraperController = require('../controllers/scrapperController');

const router = express.Router();

router.post('/start', scraperController.startScraper);
router.get('/status', scraperController.getScraperStatus);

module.exports = router;
