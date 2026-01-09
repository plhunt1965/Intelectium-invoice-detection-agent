/**
 * Gmail Module
 * Handles email search, processing, and attachment management
 * Updated: 2026-01-09 - Added monthly search, limits set to 500 (Gmail max)
 */

const GmailManager = {
  /**
   * Search for invoice emails
   * @param {string} requestId - Request tracking ID
   * @param {boolean} usePriorityLabel - Search emails with priority label first
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Array of email threads
   */
  searchInvoiceEmails: function(requestId, usePriorityLabel) {
    usePriorityLabel = usePriorityLabel !== false; // Default to true
    
    // Calculate date range for search
    const dateRange = this._calculateDateRange(requestId);
    
    Log.info('Searching for invoice emails', {
      usePriorityLabel: usePriorityLabel,
      keywords: CONFIG.SEARCH_KEYWORDS,
      dateRange: {
        from: dateRange.from ? Utilities.formatDate(dateRange.from, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'unlimited',
        to: dateRange.to ? Utilities.formatDate(dateRange.to, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'unlimited'
      }
    });
    
    const threads = [];
    
    try {
      // CRITICAL FIX: Search month by month to ensure we don't miss emails
      // Gmail search can miss emails if there are too many in one month
      const monthlyThreads = this._searchByMonth(requestId, dateRange, usePriorityLabel);
      threads.push(...monthlyThreads);
      
      // Also do the original search as a fallback (in case monthly search misses something)
      if (usePriorityLabel && CONFIG.PRIORITY_LABEL) {
        const labelThreads = this._searchWithLabel(requestId, CONFIG.PRIORITY_LABEL, dateRange);
        threads.push(...labelThreads);
        Log.info('Found emails with priority label (fallback)', { count: labelThreads.length });
      }
      
      const keywordThreads = this._searchByKeywords(requestId, dateRange);
      threads.push(...keywordThreads);
      Log.info('Found emails by keywords (fallback)', { count: keywordThreads.length });
      
      // Remove duplicates
      const uniqueThreads = this._deduplicateThreads(threads);
      
      // Filter by date range (additional check since Gmail search may not be perfect)
      const filteredThreads = this._filterByDateRange(uniqueThreads, dateRange);
      
      // Log breakdown by month for debugging
      const monthBreakdown = this._getMonthBreakdown(filteredThreads);
      Log.info('Total unique invoice threads found', { 
        count: filteredThreads.length,
        beforeFilter: uniqueThreads.length,
        byMonth: monthBreakdown
      });
      
      return filteredThreads;
      
    } catch (error) {
      Log.error('Failed to search invoice emails', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  
  /**
   * Calculate date range for email search based on configuration
   * @param {string} requestId - Request tracking ID
   * @returns {{from: Date|null, to: Date|null}} Date range object
   * @private
   */
  _calculateDateRange: function(requestId) {
    let fromDate = null;
    let toDate = new Date(); // Default to today
    
    // Parse start date - ensure it's at start of day in local timezone
    if (CONFIG.SEARCH_START_DATE) {
      try {
        // Parse date string (YYYY-MM-DD) and set to start of day in local timezone
        const dateParts = CONFIG.SEARCH_START_DATE.split('-');
        if (dateParts.length === 3) {
          fromDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
          fromDate.setHours(0, 0, 0, 0);
          Log.debug('Using configured start date', { 
            date: Utilities.formatDate(fromDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
            original: CONFIG.SEARCH_START_DATE
          });
        } else {
          throw new Error('Invalid date format');
        }
      } catch (error) {
        Log.warn('Invalid SEARCH_START_DATE format', { 
          error: error.message,
          date: CONFIG.SEARCH_START_DATE
        });
      }
    }
    
    // Parse end date - ensure it's at end of day in local timezone
    if (CONFIG.SEARCH_END_DATE) {
      try {
        // Parse date string (YYYY-MM-DD) and set to end of day in local timezone
        const dateParts = CONFIG.SEARCH_END_DATE.split('-');
        if (dateParts.length === 3) {
          toDate = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
          toDate.setHours(23, 59, 59, 999);
          Log.debug('Using configured end date', { 
            date: Utilities.formatDate(toDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
            original: CONFIG.SEARCH_END_DATE
          });
        } else {
          throw new Error('Invalid date format');
        }
      } catch (error) {
        Log.warn('Invalid SEARCH_END_DATE format, using today', { 
          error: error.message,
          date: CONFIG.SEARCH_END_DATE
        });
        toDate = new Date();
        toDate.setHours(23, 59, 59, 999);
      }
    } else {
      // If no end date, use today at end of day
      toDate.setHours(23, 59, 59, 999);
    }
    
    return {
      from: fromDate,
      to: toDate
    };
  },
  
  /**
   * Build Gmail search query with date filters
   * @param {string} baseQuery - Base search query
   * @param {{from: Date|null, to: Date|null}} dateRange - Date range
   * @returns {string} Complete search query with date filters
   * @private
   */
  _buildDateQuery: function(baseQuery, dateRange) {
    let query = baseQuery;
    
    // Gmail date format: YYYY/MM/DD
    // Note: "after:YYYY/MM/DD" includes that day (emails on or after that date)
    // Note: "before:YYYY/MM/DD" excludes that day (emails before that date)
    // To include the end date, we need to use the day AFTER as "before"
    if (dateRange.from) {
      const fromStr = Utilities.formatDate(dateRange.from, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      query += ` after:${fromStr}`;
      Log.debug('Added date filter (after)', { date: fromStr });
    }
    
    if (dateRange.to) {
      // To include the end date, we need to add 1 day and use "before"
      // Example: to include 2025/12/31, we use before:2026/01/01
      const nextDay = new Date(dateRange.to);
      nextDay.setDate(nextDay.getDate() + 1);
      const toStr = Utilities.formatDate(nextDay, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      query += ` before:${toStr}`;
      Log.debug('Added date filter (before)', { 
        endDate: Utilities.formatDate(dateRange.to, Session.getScriptTimeZone(), 'yyyy/MM/dd'),
        beforeDate: toStr
      });
    }
    
    return query;
  },
  
  /**
   * Filter threads by date range (additional check)
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads - Array of threads
   * @param {{from: Date|null, to: Date|null}} dateRange - Date range
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Filtered threads
   * @private
   */
  _filterByDateRange: function(threads, dateRange) {
    if (!dateRange.from && !dateRange.to) {
      return threads;
    }
    
    const filtered = [];
    
    for (const thread of threads) {
      const messages = thread.getMessages();
      if (messages.length === 0) continue;
      
      // Check if ANY message in the thread falls within the date range
      // This ensures we don't exclude threads that have messages from different months
      let hasMessageInRange = false;
      
      for (const message of messages) {
        const messageDate = message.getDate();
        let inRange = true;
        
        if (dateRange.from && messageDate < dateRange.from) {
          inRange = false;
        }
        
        if (dateRange.to && messageDate > dateRange.to) {
          inRange = false;
        }
        
        if (inRange) {
          hasMessageInRange = true;
          break; // Found at least one message in range, include the thread
        }
      }
      
      if (hasMessageInRange) {
        filtered.push(thread);
      }
    }
    
    return filtered;
  },
  
  /**
   * Search emails month by month to ensure we don't miss any
   * @param {string} requestId - Request tracking ID
   * @param {{from: Date|null, to: Date|null}} dateRange - Date range
   * @param {boolean} usePriorityLabel - Whether to use priority label
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Array of threads
   * @private
   */
  _searchByMonth: function(requestId, dateRange, usePriorityLabel) {
    if (!dateRange.from || !dateRange.to) {
      // If no date range, fall back to regular search
      return [];
    }
    
    const allThreads = [];
    const startDate = new Date(dateRange.from);
    const endDate = new Date(dateRange.to);
    
    // Generate list of months to search
    const months = [];
    let currentDate = new Date(startDate);
    currentDate.setDate(1); // Start of month
    
    while (currentDate <= endDate) {
      const monthStart = new Date(currentDate);
      monthStart.setHours(0, 0, 0, 0);
      
      const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      
      // Don't search beyond the configured end date
      if (monthEnd > endDate) {
        monthEnd.setTime(endDate.getTime());
      }
      
      months.push({
        start: monthStart,
        end: monthEnd,
        label: Utilities.formatDate(monthStart, Session.getScriptTimeZone(), 'yyyy-MM')
      });
      
      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    Log.info('Searching month by month', { 
      monthCount: months.length,
      months: months.map(m => m.label)
    });
    
    // Search each month separately
    for (const month of months) {
      const monthRange = { from: month.start, to: month.end };
      let monthThreads = [];
      
      // Search with label if enabled
      if (usePriorityLabel && CONFIG.PRIORITY_LABEL) {
        const labelThreads = this._searchWithLabel(requestId, CONFIG.PRIORITY_LABEL, monthRange);
        monthThreads.push(...labelThreads);
      }
      
      // Search by keywords for this month
      const keywordThreads = this._searchByKeywords(requestId, monthRange);
      monthThreads.push(...keywordThreads);
      
      // Remove duplicates within this month
      const uniqueMonthThreads = this._deduplicateThreads(monthThreads);
      
      // Filter by date range
      const filteredMonthThreads = this._filterByDateRange(uniqueMonthThreads, monthRange);
      
      Log.info('Found emails for month', {
        month: month.label,
        count: filteredMonthThreads.length,
        beforeFilter: uniqueMonthThreads.length
      });
      
      allThreads.push(...filteredMonthThreads);
    }
    
    return allThreads;
  },
  
  /**
   * Get breakdown of threads by month for debugging
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads - Array of threads
   * @returns {Object} Breakdown by month
   * @private
   */
  _getMonthBreakdown: function(threads) {
    const breakdown = {};
    
    for (const thread of threads) {
      const messages = thread.getMessages();
      if (messages.length === 0) continue;
      
      // Use the first message date to determine month
      const messageDate = messages[0].getDate();
      const monthKey = Utilities.formatDate(messageDate, Session.getScriptTimeZone(), 'yyyy-MM');
      
      if (!breakdown[monthKey]) {
        breakdown[monthKey] = 0;
      }
      breakdown[monthKey]++;
    }
    
    return breakdown;
  },
  
  /**
   * Search emails with specific label
   * @param {string} requestId - Request tracking ID
   * @param {string} labelName - Label name
   * @param {{from: Date|null, to: Date|null}} dateRange - Date range
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Array of threads
   * @private
   */
  _searchWithLabel: function(requestId, labelName, dateRange) {
    try {
      const label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        Log.warn('Priority label not found', { labelName: labelName });
        return [];
      }
      
      // Build query with label and date filters
      let query = `label:${labelName}`;
      query = this._buildDateQuery(query, dateRange);
      
      // Gmail API maximum limit is 500
      const threads = GmailApp.search(query, 0, 500);
      
      Log.debug('Searched with label and date filters', {
        labelName: labelName,
        found: threads.length,
        query: query
      });
      
      // Additional filter by date range (double check)
      const filteredThreads = this._filterByDateRange(threads, dateRange);
      
      if (filteredThreads.length !== threads.length) {
        Log.warn('Date filter removed some threads', {
          before: threads.length,
          after: filteredThreads.length
        });
      }
      
      return filteredThreads;
      
    } catch (error) {
      Log.warn('Error searching with label', {
        error: error.message,
        labelName: labelName
      });
      return [];
    }
  },
  
  /**
   * Search emails by keywords in subject
   * @param {string} requestId - Request tracking ID
   * @param {{from: Date|null, to: Date|null}} dateRange - Date range
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Array of threads
   * @private
   */
  _searchByKeywords: function(requestId, dateRange) {
    const allThreads = [];
    
    for (const keyword of CONFIG.SEARCH_KEYWORDS) {
      try {
        // Build base query - search for keyword in subject
        // Remove the "is:unread" restriction to find ALL emails (read and unread)
        // This ensures we find invoices from October/November even if they were read
        const baseQuery = `subject:${keyword}`;
        
        // Add date filters
        const query = this._buildDateQuery(baseQuery, dateRange);
        
        // Gmail API maximum limit is 500 per keyword
        const threads = GmailApp.search(query, 0, 500);
        allThreads.push(...threads);
        
        Log.debug('Searched keyword', {
          keyword: keyword,
          found: threads.length,
          query: query
        });
        
      } catch (error) {
        Log.warn('Error searching keyword', {
          error: error.message,
          keyword: keyword
        });
      }
    }
    
    return allThreads;
  },
  
  /**
   * Remove duplicate threads
   * @param {GoogleAppsScript.Gmail.GmailThread[]} threads - Array of threads
   * @returns {GoogleAppsScript.Gmail.GmailThread[]} Deduplicated threads
   * @private
   */
  _deduplicateThreads: function(threads) {
    const seen = new Set();
    const unique = [];
    
    for (const thread of threads) {
      const id = thread.getId();
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(thread);
      }
    }
    
    return unique;
  },
  
  /**
   * Process email thread and extract messages
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Gmail.GmailThread} thread - Gmail thread
   * @returns {Object[]} Array of message objects with attachments info
   */
  processThread: function(requestId, thread) {
    const messages = thread.getMessages();
    const processedMessages = [];
    
    Log.info('Processing thread', {
      threadId: thread.getId(),
      messageCount: messages.length
    });
    
    for (const message of messages) {
      const messageId = message.getId();
      
      // Skip if already processed
      if (Storage.isEmailProcessed(messageId)) {
        Log.info('Message already processed, skipping', { 
          messageId: messageId,
          subject: message.getSubject()
        });
        continue;
      }
      
      const attachments = message.getAttachments();
      const hasAttachments = attachments.length > 0;
      
      processedMessages.push({
        message: message,
        messageId: messageId,
        subject: message.getSubject(),
        body: message.getPlainBody(),
        htmlBody: message.getBody(),
        attachments: attachments,
        hasAttachments: hasAttachments,
        date: message.getDate()
      });
      
      Log.debug('Message extracted', {
        messageId: messageId,
        subject: message.getSubject(),
        hasAttachments: hasAttachments,
        attachmentCount: attachments.length
      });
    }
    
    return processedMessages;
  },
  
  /**
   * Mark email as read
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Gmail.GmailMessage} message - Gmail message
   */
  markAsRead: function(requestId, message) {
    if (!CONFIG.MARK_AS_READ) {
      return;
    }
    
    try {
      message.markRead();
      Log.debug('Message marked as read', { messageId: message.getId() });
    } catch (error) {
      Log.warn('Failed to mark message as read', {
        error: error.message,
        messageId: message.getId()
      });
    }
  },
  
  /**
   * Extract text from PDF attachment
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Gmail.GmailAttachment} attachment - Gmail attachment
   * @returns {string} Extracted text content
   */
  extractTextFromPDF: function(requestId, attachment) {
    Log.debug('Extracting text from PDF', {
      name: attachment.getName(),
      size: attachment.getSize()
    });
    
    try {
      // Convert attachment to blob
      const blob = attachment.copyBlob();
      
      // Use Drive API to extract text (requires file in Drive)
      const tempFile = DriveApp.createFile(blob);
      const fileId = tempFile.getId();
      
      try {
        // Use Drive API to get text content
        const file = DriveApp.getFileById(fileId);
        const textContent = file.getBlob().getDataAsString();
        
        // Try to extract text (basic approach - Drive API doesn't directly extract PDF text)
        // For better extraction, we'd need to use a service or parse the PDF
        // For now, return empty and let Vertex AI work with the file directly
        return '';
        
      } finally {
        // Clean up temp file
        try {
          DriveApp.getFileById(fileId).setTrashed(true);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
    } catch (error) {
      Log.error('Failed to extract text from PDF', {
        error: error.message,
        attachmentName: attachment.getName()
      });
      return '';
    }
  }
};
