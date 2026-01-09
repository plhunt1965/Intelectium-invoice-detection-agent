/**
 * Structured Logging Module
 * Provides request-scoped logging with optional sheet persistence
 */

const Log = {
  _sheet: null,
  _requestId: null,
  
  /**
   * Initialize logging with request ID
   * @param {string} requestId - Unique request identifier
   * @returns {string} The request ID
   */
  init: function(requestId) {
    this._requestId = requestId || Utilities.getUuid();
    return this._requestId;
  },
  
  /**
   * Get current request ID
   * @returns {string} Current request ID
   */
  getRequestId: function() {
    if (!this._requestId) {
      this.init();
    }
    return this._requestId;
  },
  
  /**
   * Write log entry
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - Log message
   * @param {Object} data - Additional data object
   * @private
   */
  _write: function(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      requestId: this._requestId || 'unknown',
      level: level,
      message: message,
      data: data ? JSON.stringify(data) : ''
    };
    
    // Console output
    const logMessage = `[${entry.timestamp}] [${entry.level}] [${entry.requestId}] ${message}`;
    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
    
    // Optional: write to sheet for persistence
    if (CONFIG.LOG_TO_SHEET && this._sheet) {
      try {
        this._writeToSheet(entry);
      } catch (error) {
        console.error('Failed to write log to sheet:', error);
      }
    }
  },
  
  /**
   * Write log entry to sheet
   * @param {Object} entry - Log entry object
   * @private
   */
  _writeToSheet: function(entry) {
    if (!this._sheet) {
      // Initialize sheet if needed
      try {
        const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        this._sheet = ss.getSheetByName('Logs') || ss.insertSheet('Logs');
        
        // Set headers if first row is empty
        if (this._sheet.getLastRow() === 0) {
          this._sheet.getRange(1, 1, 1, 5).setValues([[
            'Timestamp', 'Request ID', 'Level', 'Message', 'Data'
          ]]);
        }
      } catch (error) {
        console.error('Cannot initialize log sheet:', error);
        return;
      }
    }
    
    this._sheet.appendRow([
      entry.timestamp,
      entry.requestId,
      entry.level,
      entry.message,
      entry.data
    ]);
  },
  
  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} data - Optional data object
   */
  info: function(message, data) {
    this._write('INFO', message, data);
  },
  
  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} data - Optional data object
   */
  warn: function(message, data) {
    this._write('WARN', message, data);
  },
  
  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Object} data - Optional data object
   */
  error: function(message, data) {
    this._write('ERROR', message, data);
  },
  
  /**
   * Log debug message (only if DEBUG_MODE is enabled)
   * @param {string} message - Log message
   * @param {Object} data - Optional data object
   */
  debug: function(message, data) {
    if (CONFIG.DEBUG_MODE) {
      this._write('DEBUG', message, data);
    }
  }
};
