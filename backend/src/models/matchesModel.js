const db = require('../config/database');

class MatchesModel {
  static async bulkInsert(matches) {
    try {
      return await db('matches').insert(matches);
    } catch (error) {
      throw new Error(`Failed to save matches: ${error.message}`);
    }
  }

  static async clearAll() {
    return await db('matches').truncate();
  }
}

module.exports = MatchesModel;