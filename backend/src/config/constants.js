// backend/src/config/constants.js

module.exports = {
  // Cron job timing — midnight daily
  CRON_SCHEDULES: {
    DAILY_SCRAPE: '0 0 * * *'
  },

  // Logging event types
  LOG_TYPES: {
    AUTO: 'auto',
    MANUAL: 'manual',
    ERROR: 'error'
  },

  // Scraper defaults
  SCRAPER_CONFIG: {
    DEFAULT_USER_AGENT: 'Mozilla/5.0 (compatible; TournamentScraper/1.0)',
    TIMEOUT_MS: 30000
  },

  // Calendar integration constants
  CALENDAR: {
    DEFAULT_CALENDAR_ID: 'your_calendar_id_here'
  }
};
