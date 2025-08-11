const fs = require('fs');
const path = require('path');
const { DB } = require('../config/database');
const { SCRAPER_CONFIG } = require('../config/constants');

class TournamentLogger {
  constructor() {
    this.logFilePath = path.join(__dirname, '../../logs/scraper.log');
    this.maxLogSize = 10 * 1024 * 1024; // 10MB max log size
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  async logScrapingEvent(message, triggerType = 'manual', level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      triggerType, // 'auto' or 'manual' as per contract
      level,
      message,
      season: SCRAPER_CONFIG.CURRENT_SEASON
    };

    // 1. Write to file log
    this.writeToFileLog(logEntry);

    // 2. Store in database
    await this.writeToDatabase(logEntry);

    // 3. Console output (for dev)
    console.log(`[${timestamp}] [${level.toUpperCase()}] [${triggerType}] ${message}`);
  }

  writeToFileLog(entry) {
    try {
      // Rotate log if needed
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size > this.maxLogSize) {
          this.rotateLogFile();
        }
      }

      fs.appendFileSync(
        this.logFilePath,
        `${JSON.stringify(entry)}\n`
      );
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  rotateLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivedPath = this.logFilePath.replace('.log', `-${timestamp}.log`);
    fs.renameSync(this.logFilePath, archivedPath);
  }

  async writeToDatabase(entry) {
    try {
      await DB('scraper_logs').insert({
        timestamp: entry.timestamp,
        trigger_type: entry.triggerType,
        log_level: entry.level,
        message: entry.message,
        season: entry.season,
        records_processed: entry.recordsCount || null,
        execution_time: entry.executionTime || null
      });
    } catch (error) {
      console.error('Failed to write to database log:', error);
    }
  }

  async getRecentLogs(limit = 50) {
    try {
      return await DB('scraper_logs')
        .orderBy('timestamp', 'desc')
        .limit(limit);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      return [];
    }
  }

  async clearLogs() {
    try {
      // Archive current logs before clearing
      const archiveName = `logs-archive-${new Date().toISOString()}.json`;
      const currentLogs = await this.getRecentLogs(1000);
      
      fs.writeFileSync(
        path.join(path.dirname(this.logFilePath), archiveName),
        JSON.stringify(currentLogs, null, 2)
      );

      // Clear database logs
      await DB('scraper_logs').truncate();

      // Clear file log
      fs.writeFileSync(this.logFilePath, '');

      return { success: true, archivedTo: archiveName };
    } catch (error) {
      console.error('Failed to clear logs:', error);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
module.exports = new TournamentLogger();