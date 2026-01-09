/**
 * Storage Module
 * Manages processed email IDs and state using PropertiesService
 */

const Storage = {
  _props: PropertiesService.getScriptProperties(),
  
  /**
   * Get stored value
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Stored value or default
   */
  get: function(key, defaultValue) {
    const value = this._props.getProperty(key);
    if (value === null) return defaultValue;
    
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  },
  
  /**
   * Set stored value
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   */
  set: function(key, value) {
    const stored = typeof value === 'object' ? JSON.stringify(value) : value;
    this._props.setProperty(key, stored);
  },
  
  /**
   * Get list of processed email IDs
   * @returns {string[]} Array of processed email IDs
   */
  getProcessedEmailIds: function() {
    return this.get('processed_email_ids', []);
  },
  
  /**
   * Check if email has been processed
   * @param {string} emailId - Gmail message ID
   * @returns {boolean} True if already processed
   */
  isEmailProcessed: function(emailId) {
    const processed = this.getProcessedEmailIds();
    return processed.includes(emailId);
  },
  
  /**
   * Mark email as processed
   * @param {string} emailId - Gmail message ID
   */
  markEmailProcessed: function(emailId) {
    const processed = this.getProcessedEmailIds();
    if (!processed.includes(emailId)) {
      processed.push(emailId);
      
      // Keep only last 5000 IDs to avoid quota issues
      if (processed.length > 5000) {
        processed.splice(0, processed.length - 5000);
      }
      
      this.set('processed_email_ids', processed);
    }
  },
  
  /**
   * Get last processed timestamp
   * @returns {Date|null} Last processed timestamp or null
   */
  getLastProcessedTime: function() {
    const timestamp = this.get('last_processed_time', null);
    return timestamp ? new Date(timestamp) : null;
  },
  
  /**
   * Set last processed timestamp
   * @param {Date} date - Timestamp to store
   */
  setLastProcessedTime: function(date) {
    this.set('last_processed_time', date.toISOString());
  },
  
  /**
   * Clear all processed email IDs (use with caution)
   */
  clearProcessedEmails: function() {
    this._props.deleteProperty('processed_email_ids');
  }
};
