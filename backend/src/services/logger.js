const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logFile = path.join(__dirname, '../../logs/scraper.log');
    if (!fs.existsSync(path.dirname(this.logFile))) {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    }
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} [${level.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(this.logFile, logEntry, (err) => {
      if (err) console.error('Failed to write to log file:', err);
    });
    console.log(logEntry); // Also log to console for debugging
  }

  startLog(sessionId, season, venue) {
    const logId = `LOG_${Date.now()}_${sessionId}`;
    this.log('info', `Starting log ${logId} for session ${sessionId}, season ${season}, venue ${venue}`);
    return logId;
  }

  updateLog(logId, totalMatches, message, status = 'running') {
    this.log('info', `${logId}: Updated - Matches: ${totalMatches}, Status: ${status}, Message: ${message}`);
  }
}

module.exports = new Logger();