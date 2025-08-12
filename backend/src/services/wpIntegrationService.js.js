const axios = require('axios');
const logger = require('./logger');

class WPIntegrationService {
  constructor() {
    this.api = axios.create({
      baseURL: process.env.WP_API_URL,
      headers: {
        'Authorization': `Bearer ${process.env.WP_API_TOKEN}`
      }
    });
  }

  async syncMatches(matches) {
    try {
      const results = await Promise.all(
        matches.map(match => this.createEvent(match))
      );
      
      logger.logScrapingEvent('WordPress sync completed', 'system', 'info', {
        eventsCreated: results.length
      });
      
      return results;
    } catch (error) {
      logger.logScrapingEvent('WordPress sync failed', 'system', 'error', {
        error: error.message
      });
      throw error;
    }
  }

  async createEvent(match) {
    const eventData = {
      title: `${match.homeTeam} vs ${match.awayTeam}`,
      start_date: `${match.date}T${match.time}:00`,
      status: 'publish',
      meta: {
        location: match.venue
      }
    };

    const response = await this.api.post('/wp-json/tribe/events/v1/events', eventData);
    return response.data;
  }
}

module.exports = WPIntegrationService;