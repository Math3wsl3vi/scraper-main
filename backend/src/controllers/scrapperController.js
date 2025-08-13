const scraperService = require('../services/scraperService');
const db = require('../config/database');

class ScraperController {
  async runAllCalendarScraper(req, res) {
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  const { season, linkStructure, venue, sessionId } = req.body;
  try {
    if (!season || !linkStructure || !venue || !sessionId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }
    console.log('Calling scraper service with:', { season, linkStructure, venue, sessionId });
    const result = await scraperService.runAllCalendarScraper({ season, linkStructure, venue, sessionId });
    console.log('Scraper service result:', result);
    res.json(result);
  } catch (error) {
    console.error('Scraper error:', error.stack); // Include stack trace for detailed debugging
    res.status(500).json({ success: false, message: error.message });
  }
}

  async getScraperProgress(req, res) {
    const { sessionId, totalMatches } = req.query;
    try {
      const log = await db.query('SELECT status, total_matches, error_message FROM logs WHERE session_id = $1', [sessionId]);
      if (log.rows.length) {
        const progress = totalMatches ? Math.min(100, Math.max(1, (log.rows[0].total_matches / totalMatches) * 100)) : 0;
        res.json({ success: true, data: { progress, message: log.rows[0].error_message, status: log.rows[0].status } });
      } else {
        res.json({ success: false, message: 'No log found for session' });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // Implement other methods (setAutoexecutionEnabled, deleteAllEvents, etc.) similarly
}

module.exports = new ScraperController();