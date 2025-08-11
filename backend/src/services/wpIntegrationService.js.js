const axios = require('axios');
const { WP_API, EVENTS_CALENDAR } = require('../config/wordpress');
const logger = require('./logger');
const { Tournament } = require('../models/matchesModel');
const { TeamVisual } = require('../models/teamVisualsModel');

class WPIntegrationService {
  constructor() {
    this.api = axios.create({
      baseURL: WP_API.url,
      headers: {
        'Authorization': `Bearer ${WP_API.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Sync a single match to The Events Calendar
   * @param {Object} match - Match data from scraper
   * @returns {Promise<Object>} - WordPress event object
   */
  async syncEvent(match) {
    try {
      // 1. Check if event exists
      const existingEvent = await this.findExistingEvent(match);

      // 2. Prepare event data according to contract requirements
      const eventData = this.prepareEventData(match);

      // 3. Create or update event
      let result;
      if (existingEvent) {
        result = await this.updateEvent(existingEvent.id, eventData);
      } else {
        result = await this.createEvent(eventData);
      }

      // 4. Apply team visuals if home match
      if (this.isHomeMatch(match)) {
        await this.applyTeamVisuals(result.id, match.homeTeam);
      }

      await logger.logScrapingEvent(
        `Synced event: ${match.homeTeam} vs ${match.awayTeam}`,
        'system',
        'info'
      );

      return result;
    } catch (error) {
      await logger.logScrapingEvent(
        `Failed to sync event ${match.id}: ${error.message}`,
        'system',
        'error'
      );
      throw error;
    }
  }

  /**
   * Clear all events from the calendar (with warning)
   * @returns {Promise<Object>} - Operation result
   */
  async clearCalendar() {
    try {
      // Get all events first for archiving
      const events = await this.api.get(EVENTS_CALENDAR.endpoints.events, {
        params: { per_page: 100 }
      });

      // Archive before deletion (per contract requirement)
      await Tournament.query().insert(events.data.map(e => ({
        wp_event_id: e.id,
        event_data: JSON.stringify(e),
        archived_at: new Date()
      })));

      // Delete all events
      await Promise.all(
        events.data.map(event => 
          this.api.delete(`${EVENTS_CALENDAR.endpoints.events}/${event.id}`)
        )
      );

      await logger.logScrapingEvent(
        `Calendar cleared: ${events.data.length} events removed`,
        'manual',
        'warning'
      );

      return {
        success: true,
        events_removed: events.data.length,
        archived_to: 'tournaments_archive'
      };
    } catch (error) {
      await logger.logScrapingEvent(
        `Failed to clear calendar: ${error.message}`,
        'system',
        'critical'
      );
      throw error;
    }
  }

  /**
   * Find existing event in WordPress
   * @param {Object} match - Match data
   * @returns {Promise<Object|null>} - Existing event or null
   */
  async findExistingEvent(match) {
    try {
      const response = await this.api.get(EVENTS_CALENDAR.endpoints.events, {
        params: {
          search: `${match.homeTeam} vs ${match.awayTeam}`,
          after: match.date,
          before: match.date
        }
      });
      return response.data[0] || null;
    } catch (error) {
      throw new Error(`Event lookup failed: ${error.message}`);
    }
  }

  /**
   * Prepare event data according to contract specs
   * @param {Object} match - Raw match data
   * @returns {Object} - Formatted event data
   */
  prepareEventData(match) {
    const startDate = new Date(`${match.date}T${match.time}:00`);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 2); // Default 2h duration

    return {
      title: `${match.homeTeam} vs ${match.awayTeam}`,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      meta: {
        // Infobox data as per contract Figures 10-13
        _bt_match_details: {
          tournament: match.tournamentPath,
          location: match.location,
          home_team: match.homeTeam,
          away_team: match.awayTeam,
          result: match.result || 'Not played yet',
          points: match.points || '0',
          external_links: match.links
        },
        // For hover infobox
        _bt_visual_settings: {
          show_infobox: true,
          infobox_template: 'tournament_match'
        }
      },
      venue: this.mapVenue(match.location)
    };
  }

  /**
   * Map physical location to WordPress venue
   * @param {String} location - Raw location from scraper
   * @returns {Number} - WordPress venue ID
   */
  mapVenue(location) {
    const venues = require('../config/venues');
    const normalized = location.toLowerCase().trim();
    
    const venue = venues.find(v => 
      normalized.includes(v.name.toLowerCase()) ||
      (v.aliases && v.aliases.some(a => normalized.includes(a.toLowerCase())))
    );

    return venue ? venue.wp_id : EVENTS_CALENDAR.default_venue_id;
  }

  /**
   * Apply team colors/pictures to event
   * @param {Number} eventId - WordPress event ID
   * @param {String} teamName - Team name to apply visuals for
   */
  async applyTeamVisuals(eventId, teamName) {
    try {
      const visual = await TeamVisual.query()
        .where('team_name', teamName)
        .first();

      if (visual) {
        await this.api.post(`${EVENTS_CALENDAR.endpoints.event_meta}/${eventId}`, {
          meta: {
            _bt_team_color: visual.color_hex,
            _bt_team_logo: visual.picture_url || null
          }
        });
      }
    } catch (error) {
      throw new Error(`Failed to apply team visuals: ${error.message}`);
    }
  }

  /**
   * Check if match is a home match per contract definition
   * @param {Object} match - Match data
   * @returns {Boolean} - True if home match
   */
  isHomeMatch(match) {
    const { DEFAULT_VENUE, HOME_TEAM_STRINGS } = require('../config/constants');
    
    // 1. Check venue (primary criteria)
    const isVenueMatch = match.location.includes(DEFAULT_VENUE) || 
                       match.location.includes('Grøndal MultiCenter, lokale 28');
    
    // 2. Check home team strings (special cases)
    const isTeamMatch = HOME_TEAM_STRINGS.split(/[ ;]/)
      .filter(s => s.trim())
      .some(term => match.homeTeam.includes(term.replace('*', '')));

    return isVenueMatch || isTeamMatch;
  }

  /**
   * Create new event in WordPress
   * @param {Object} eventData - Prepared event data
   * @returns {Promise<Object>} - Created event
   */
  async createEvent(eventData) {
    try {
      const response = await this.api.post(
        EVENTS_CALENDAR.endpoints.events,
        eventData
      );
      return response.data;
    } catch (error) {
      throw new Error(`Event creation failed: ${error.message}`);
    }
  }

  /**
   * Update existing event
   * @param {Number} eventId - WordPress event ID
   * @param {Object} eventData - Prepared event data
   * @returns {Promise<Object>} - Updated event
   */
  async updateEvent(eventId, eventData) {
    try {
      const response = await this.api.put(
        `${EVENTS_CALENDAR.endpoints.events}/${eventId}`,
        eventData
      );
      return response.data;
    } catch (error) {
      throw new Error(`Event update failed: ${error.message}`);
    }
  }
}

module.exports = WPIntegrationService;