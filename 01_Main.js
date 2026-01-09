/**
 * Main Module
 * Entry points and orchestration for Invoice Detection Agent
 */

/**
 * Main function to process invoice emails
 * Can be triggered manually or by time-based trigger
 */
function processInvoiceEmails() {
  const requestId = Log.init();
  const startTime = Date.now();
  
  Log.info('Starting invoice email processing', {
    timestamp: new Date().toISOString(),
    maxExecutionTime: CONFIG.MAX_EXECUTION_TIME_MS,
    maxThreads: CONFIG.MAX_THREADS_PER_RUN
  });
  
  try {
    // Search for invoice emails
    const threads = GmailManager.searchInvoiceEmails(requestId, true);
    
    if (threads.length === 0) {
      Log.info('No invoice emails found');
      return { processed: 0, created: 0, errors: 0 };
    }
    
    // Limit threads to prevent timeout (for 1000+ emails, will process in multiple runs)
    const threadsToProcess = threads.slice(0, CONFIG.MAX_THREADS_PER_RUN);
    if (threads.length > CONFIG.MAX_THREADS_PER_RUN) {
      Log.info('Large batch detected - processing in chunks', {
        total: threads.length,
        processingThisRun: threadsToProcess.length,
        remainingForNextRun: threads.length - threadsToProcess.length,
        estimatedRuns: Math.ceil(threads.length / CONFIG.MAX_THREADS_PER_RUN),
        note: 'Remaining threads will be processed in subsequent executions'
      });
    }
    
    // Process threads in batches
    const results = {
      processed: 0,
      created: 0,
      errors: 0,
      skipped: 0
    };
    
    for (let i = 0; i < threadsToProcess.length; i += CONFIG.BATCH_SIZE) {
      // Check execution time before processing next batch
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > CONFIG.MAX_EXECUTION_TIME_MS) {
        Log.warn('Maximum execution time reached, stopping processing', {
          elapsedTime: elapsedTime,
          maxTime: CONFIG.MAX_EXECUTION_TIME_MS,
          processed: results.processed,
          remaining: threadsToProcess.length - i
        });
        break;
      }
      
      const batch = threadsToProcess.slice(i, i + CONFIG.BATCH_SIZE);
      
      Log.info('Processing batch', {
        batch: Math.floor(i / CONFIG.BATCH_SIZE) + 1,
        totalBatches: Math.ceil(threadsToProcess.length / CONFIG.BATCH_SIZE),
        batchSize: batch.length,
        elapsedTime: Math.round(elapsedTime / 1000) + 's'
      });
      
      for (const thread of batch) {
        // Check execution time before processing each thread
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > CONFIG.MAX_EXECUTION_TIME_MS) {
          Log.warn('Maximum execution time reached, stopping processing', {
            elapsedTime: elapsedTime,
            processed: results.processed
          });
          break;
        }
        
        try {
          const threadResult = processThread(requestId, thread);
          results.processed += threadResult.processed;
          results.created += threadResult.created;
          results.skipped += threadResult.skipped;
          
        } catch (error) {
          results.errors++;
          Log.error('Error processing thread', {
            error: error.message,
            threadId: thread.getId()
          });
        }
      }
      
      // Small delay between batches
      if (i + CONFIG.BATCH_SIZE < threadsToProcess.length) {
        Utilities.sleep(500);
      }
    }
    
    // Update last processed time
    Storage.setLastProcessedTime(new Date());
    
    Log.info('Invoice processing complete', results);
    
    return results;
    
  } catch (error) {
    Log.error('Invoice processing failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Process a single email thread
 * @param {string} requestId - Request tracking ID
 * @param {GoogleAppsScript.Gmail.GmailThread} thread - Gmail thread
 * @returns {Object} Processing results
 */
function processThread(requestId, thread) {
  const result = {
    processed: 0,
    created: 0,
    skipped: 0
  };
  
  try {
    const messages = GmailManager.processThread(requestId, thread);
    
    for (const msgData of messages) {
      const messageId = msgData.messageId;
      
      try {
        // Process message
        const invoiceData = processMessage(requestId, msgData);
        
        if (invoiceData) {
          result.created++;
          
          // Mark as processed
          Storage.markEmailProcessed(messageId);
          
          // Mark email as read
          GmailManager.markAsRead(requestId, msgData.message);
        } else {
          result.skipped++;
        }
        
        result.processed++;
        
      } catch (error) {
        Log.error('Error processing message', {
          error: error.message,
          messageId: messageId
        });
        // Continue with next message
      }
    }
    
  } catch (error) {
    Log.error('Error processing thread', {
      error: error.message,
      threadId: thread.getId()
    });
    throw error;
  }
  
  return result;
}

/**
 * Process a single email message
 * @param {string} requestId - Request tracking ID
 * @param {Object} msgData - Message data object
 * @returns {Object|null} Invoice data if successfully processed, null otherwise
 */
function processMessage(requestId, msgData) {
  Log.info('Processing message', {
    messageId: msgData.messageId,
    subject: msgData.subject,
    hasAttachments: msgData.hasAttachments
  });
  
  try {
    let file = null;
    let invoiceData = null;
    
    // Early rejection: Check for Ipronics/Intelectium in email subject/body before processing
    const emailContentForCheck = (msgData.subject || '') + ' ' + (msgData.body || '');
    const emailContentLower = emailContentForCheck.toLowerCase();
    const empresasEmisoras = [
      'intelectium', 
      'ipronics', 
      'ipronics program', 
      'ipronics programmable',
      'ipronics programmable photonics'
    ];
    if (empresasEmisoras.some(empresa => emailContentLower.includes(empresa))) {
      Log.info('Rejected early: Email mentions Intelectium/Ipronics (likely invoice issued by us)', {
        subject: msgData.subject
      });
      return null;
    }
    
    // Handle attachments or validate email body first
    if (msgData.hasAttachments && msgData.attachments.length > 0) {
      // Process first PDF attachment (or first attachment if no PDF)
      const attachment = msgData.attachments.find(a => 
        a.getContentType() === 'application/pdf' || 
        a.getName().toLowerCase().endsWith('.pdf')
      ) || msgData.attachments[0];
      
      // Check attachment filename for Ipronics/Intelectium BEFORE downloading
      const attachmentName = (attachment.getName() || '').toLowerCase();
      if (empresasEmisoras.some(empresa => attachmentName.includes(empresa))) {
        Log.info('Rejected: Attachment filename mentions Intelectium/Ipronics', {
          filename: attachment.getName(),
          subject: msgData.subject
        });
        return null;
      }
      
      // Save attachment first (PDFs are always saved, they're already invoices)
      // We'll move it to the correct folder after extracting invoice data
      const tempFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
      file = DriveManager.saveAttachment(requestId, attachment, tempFolder);
      
      // Try to extract PDF text, combine with email body
      const pdfText = VertexAI._extractTextFromPDF(requestId, file);
      
      // Combine PDF text with email body
      let combinedContent = '';
      
      if (pdfText && pdfText.trim().length > 0) {
        combinedContent += `CONTENIDO DEL PDF (LA FACTURA ESTÁ AQUÍ):\n${pdfText}\n\n`;
        Log.info('Using extracted PDF text', { textLength: pdfText.length });
      } else {
        // Include PDF file reference if text extraction failed
        combinedContent += `ARCHIVO PDF ADJUNTO: ${file.getName()}\n`;
        combinedContent += `NOTA: El PDF está guardado pero no se pudo extraer el texto. Usa el contenido del email.\n\n`;
      }
      
      // Include email body as context (but PDF has priority)
      if (msgData.body && msgData.body.trim().length > 0) {
        combinedContent += `CONTENIDO DEL EMAIL (contexto adicional):\n${msgData.body}\n\n`;
      }
      if (msgData.subject) {
        combinedContent += `ASUNTO DEL EMAIL: ${msgData.subject}\n\n`;
      }
      
      // Use combined content
      Log.info('Extracting invoice data from PDF + email body', { fileId: file.getId() });
      invoiceData = VertexAI.extractInvoiceData(requestId, combinedContent, CONFIG.MAX_RETRIES);
      
      // Validate after extraction - if rejected, clean up the downloaded file
      if (!invoiceData || invoiceData.esFactura === false) {
        Log.info('Invoice rejected after extraction, cleaning up downloaded file', {
          fileId: file.getId(),
          invoiceData: invoiceData
        });
        try {
          DriveApp.getFileById(file.getId()).setTrashed(true);
          Log.info('Cleaned up rejected invoice file', { fileId: file.getId() });
        } catch (e) {
          Log.warn('Could not clean up rejected file', { error: e.message });
        }
        return null;
      }
      
      // Get month folder using invoice date (preferred) or message date (fallback)
      const invoiceDate = _getInvoiceDate(invoiceData, msgData.date);
      const folder = DriveManager.getOrCreateMonthFolder(requestId, invoiceDate);
      
      // Log which date was used for debugging
      Log.info('Determined month folder', {
        fechaFactura: invoiceData.fechaFactura || 'NOT EXTRACTED',
        messageDate: msgData.date ? Utilities.formatDate(msgData.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'N/A',
        usedDate: Utilities.formatDate(invoiceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        folderName: folder.getName()
      });
      
      // Move file to correct month folder if it's not already there
      if (file.getParents().hasNext()) {
        const currentParent = file.getParents().next();
        if (currentParent.getId() !== folder.getId()) {
          folder.addFile(file);
          currentParent.removeFile(file);
          Log.info('Moved file to correct month folder', {
            fileId: file.getId(),
            fromFolder: currentParent.getName(),
            toFolder: folder.getName()
          });
        }
      }
      
    } else {
      // IMPORTANT: For emails without attachments, validate first before creating PDF
      // This prevents creating PDFs from non-invoice emails (e.g., Iberdrola marketing)
      const emailContent = msgData.body || msgData.htmlBody || msgData.subject || '';
      const emailContentLower = emailContent.toLowerCase();
      
      // Early rejection: Check for Ipronics/Intelectium in email content
      const empresasEmisoras = [
        'intelectium', 
        'ipronics', 
        'ipronics program', 
        'ipronics programmable',
        'ipronics programmable photonics'
      ];
      if (empresasEmisoras.some(empresa => emailContentLower.includes(empresa))) {
        Log.info('Rejected early: Email mentions Intelectium/Ipronics (likely invoice issued by us)', {
          subject: msgData.subject
        });
        return null;
      }
      
      Log.info('Validating email body before creating PDF', {
        contentLength: emailContent.length
      });
      
      // Extract invoice data from email body first
      invoiceData = VertexAI.extractInvoiceData(requestId, emailContent, CONFIG.MAX_RETRIES);
      
      // STRICT validation for emails without attachments:
      // 1. Must explicitly be marked as invoice (esFactura !== false)
      // 2. Must have proveedor AND numeroFactura (both required for emails without PDFs)
      // 3. Must pass _isValidInvoice check
      if (invoiceData && 
          invoiceData.esFactura !== false && 
          invoiceData.proveedor && 
          invoiceData.numeroFactura &&
          invoiceData.proveedor.trim() !== '' &&
          invoiceData.numeroFactura.trim() !== '') {
        // Get month folder using invoice date (preferred) or message date (fallback)
        const invoiceDate = _getInvoiceDate(invoiceData, msgData.date);
        const folder = DriveManager.getOrCreateMonthFolder(requestId, invoiceDate);
        
        // Log which date was used for debugging
        Log.info('Determined month folder', {
          fechaFactura: invoiceData.fechaFactura || 'NOT EXTRACTED',
          messageDate: msgData.date ? Utilities.formatDate(msgData.date, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'N/A',
          usedDate: Utilities.formatDate(invoiceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          folderName: folder.getName()
        });
        
        file = PDFGenerator.createFromEmailBody(
          requestId,
          msgData.htmlBody || msgData.body,
          msgData.subject,
          folder.getId()
        );
        
        Log.info('PDF created from email body (validated as invoice)', {
          fileId: file.getId(),
          folder: folder.getName()
        });
      } else {
        Log.info('Email body is not a valid invoice, skipping PDF creation', {
          invoiceData: invoiceData,
          reason: !invoiceData ? 'null' : 
                   invoiceData.esFactura === false ? 'esFactura=false' :
                   !invoiceData.proveedor ? 'missing proveedor' :
                   !invoiceData.numeroFactura ? 'missing numeroFactura' : 'other'
        });
        return null; // Don't process non-invoice emails
      }
    }
    
    // Validate extracted data (same logic as working version)
    // Note: _isValidInvoice already validates this, but we double-check here
    if (!invoiceData || (!invoiceData.proveedor && !invoiceData.numeroFactura)) {
      Log.warn('Insufficient invoice data extracted', {
        invoiceData: invoiceData
      });
      // If we created a file but it's not valid, we should clean it up
      if (file) {
        try {
          DriveApp.getFileById(file.getId()).setTrashed(true);
          Log.info('Cleaned up invalid PDF file', { fileId: file.getId() });
        } catch (e) {
          Log.warn('Could not clean up invalid PDF file', { error: e.message });
        }
      }
      return null;
    }
    
    // Get file URL first (needed for duplicate check)
    const fileUrl = file ? DriveManager.getFileUrl(file) : '';
    
    // Check if invoice already exists (by number, provider, or file URL)
    if (SheetsManager.invoiceExists(invoiceData.numeroFactura, invoiceData.proveedor, fileUrl)) {
      Log.info('Invoice already exists in sheet', {
        numeroFactura: invoiceData.numeroFactura,
        proveedor: invoiceData.proveedor,
        fileUrl: fileUrl
      });
      return null;
    }
    
    // Rename file with invoice information
    if (file) {
      DriveManager.renameInvoiceFile(requestId, file, invoiceData);
    }
    
    // Register in spreadsheet
    SheetsManager.registerInvoice(requestId, invoiceData, fileUrl);
    
    Log.info('Message processed successfully', {
      messageId: msgData.messageId,
      proveedor: invoiceData.proveedor,
      numeroFactura: invoiceData.numeroFactura
    });
    
    return invoiceData;
    
  } catch (error) {
    Log.error('Failed to process message', {
      error: error.message,
      messageId: msgData.messageId,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get invoice date from extracted data or fallback to message date
 * @param {Object} invoiceData - Extracted invoice data
 * @param {Date} messageDate - Email message date
 * @returns {Date} Invoice date
 * @private
 */
function _getInvoiceDate(invoiceData, messageDate) {
  // Prefer invoice date from extracted data
  if (invoiceData && invoiceData.fechaFactura) {
    try {
      // Clean the date string - remove any extra whitespace or characters
      const cleanDate = invoiceData.fechaFactura.trim();
      
      // Parse date string (YYYY-MM-DD)
      const dateParts = cleanDate.split('-');
      if (dateParts.length === 3) {
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(dateParts[2], 10);
        
        // Validate parsed values
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
          throw new Error('Invalid date parts: ' + JSON.stringify(dateParts));
        }
        
        // Validate reasonable date ranges
        if (year < 2000 || year > 2100) {
          throw new Error('Year out of range: ' + year);
        }
        if (month < 0 || month > 11) {
          throw new Error('Month out of range: ' + (month + 1));
        }
        if (day < 1 || day > 31) {
          throw new Error('Day out of range: ' + day);
        }
        
        const invoiceDate = new Date(year, month, day);
        invoiceDate.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
        
        // Verify the date was created correctly
        if (invoiceDate.getFullYear() !== year || 
            invoiceDate.getMonth() !== month || 
            invoiceDate.getDate() !== day) {
          throw new Error('Date validation failed after creation');
        }
        
        Log.info('Using invoice date from extracted data', {
          fechaFactura: invoiceData.fechaFactura,
          parsedDate: Utilities.formatDate(invoiceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          yearMonth: Utilities.formatDate(invoiceDate, Session.getScriptTimeZone(), 'yyyy-MM')
        });
        return invoiceDate;
      } else {
        throw new Error('Date format invalid - expected YYYY-MM-DD, got: ' + cleanDate);
      }
    } catch (error) {
      Log.warn('Failed to parse invoice date, using message date', {
        fechaFactura: invoiceData.fechaFactura,
        error: error.message,
        messageDate: messageDate ? Utilities.formatDate(messageDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'N/A'
      });
    }
  } else {
    Log.warn('No fechaFactura in invoice data, using fallback', {
      hasInvoiceData: !!invoiceData,
      fechaFactura: invoiceData ? invoiceData.fechaFactura : 'N/A',
      messageDate: messageDate ? Utilities.formatDate(messageDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : 'N/A'
    });
  }
  
  // Fallback to message date or current date
  const fallbackDate = messageDate || new Date();
  Log.info('Using fallback date for folder', {
    date: Utilities.formatDate(fallbackDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    yearMonth: Utilities.formatDate(fallbackDate, Session.getScriptTimeZone(), 'yyyy-MM'),
    source: messageDate ? 'message date' : 'current date'
  });
  return fallbackDate;
}

/**
 * Setup time-based trigger for automatic processing
 * Run this once to enable automatic processing
 */
function setupTrigger() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processInvoiceEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger (runs every 6 hours)
  ScriptApp.newTrigger('processInvoiceEmails')
    .timeBased()
    .everyHours(6)
    .create();
  
  Log.info('Trigger configured', {
    function: 'processInvoiceEmails',
    frequency: 'every 6 hours'
  });
  
  console.log('✅ Trigger configured: processInvoiceEmails will run every 6 hours');
}

/**
 * Create custom menu in Google Sheets for manual execution
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Invoice Detection')
    .addItem('Process Invoices', 'processInvoiceEmails')
    .addItem('Force Reprocess All', 'FORCE_REPROCESS_ALL')
    .addItem('Setup Trigger', 'setupTrigger')
    .addSeparator()
    .addItem('Run Tests', 'TEST_All')
    .addItem('Check Configuration', 'DIAGNOSTIC_CheckConfiguration')
    .addItem('Clear Processed Emails', 'DIAGNOSTIC_ClearProcessedEmails')
    .addToUi();
}
