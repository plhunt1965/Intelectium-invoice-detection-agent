/**
 * Main Module
 * Entry points and orchestration for Invoice Detection Agent
 * Updated: 2026-01-09 - Added timeouts to prevent hanging
 */

/**
 * Main function to process invoice emails
 * Can be triggered manually or by time-based trigger
 */
function processInvoiceEmails() {
  const requestId = Log.init();
  const startTime = Date.now();
  
  // Circuit breaker pattern: stop processing after consecutive timeouts
  let consecutiveTimeouts = 0;
  const MAX_CONSECUTIVE_TIMEOUTS = 2;
  
  Log.info('Starting invoice email processing', {
    timestamp: new Date().toISOString(),
    maxExecutionTime: CONFIG.MAX_EXECUTION_TIME_MS,
    maxThreads: CONFIG.MAX_THREADS_PER_RUN,
    maxConsecutiveTimeouts: MAX_CONSECUTIVE_TIMEOUTS
  });
  
  // Track if time limit was reached for auto-recovery trigger
  let isTimeLimitReached = false;
  let allThreads = [];
  
  try {
    // Search for invoice emails
    const threads = GmailManager.searchInvoiceEmails(requestId, true);
    allThreads = threads; // Store for auto-recovery trigger
    
    if (threads.length === 0) {
      Log.info('No invoice emails found');
      return { processed: 0, created: 0, errors: 0 };
    }
    
    // Balance threads by month to ensure all months are processed (not just first N threads)
    const threadsByMonth = {};
    threads.forEach(thread => {
      const messages = thread.getMessages();
      if (messages.length > 0) {
        const latestMessage = messages[messages.length - 1];
        const messageDate = new Date(latestMessage.getDate());
        const yearMonth = Utilities.formatDate(messageDate, Session.getScriptTimeZone(), 'yyyy-MM');
        
        if (!threadsByMonth[yearMonth]) {
          threadsByMonth[yearMonth] = [];
        }
        threadsByMonth[yearMonth].push(thread);
      }
    });
    
    Log.info('Threads grouped by month', {
      months: Object.keys(threadsByMonth),
      counts: Object.keys(threadsByMonth).map(month => ({ month: month, count: threadsByMonth[month].length }))
    });
    
    // Balance threads across months (take proportionally from each month)
    let threadsToProcess = [];
    const maxThreads = Math.min(threads.length, CONFIG.MAX_THREADS_PER_RUN);
    const months = Object.keys(threadsByMonth).sort(); // Sort to ensure deterministic order
    const threadsPerMonth = Math.ceil(maxThreads / months.length);
    
    for (const month of months) {
      const monthThreads = threadsByMonth[month];
      const threadsToTake = Math.min(threadsPerMonth, monthThreads.length);
      threadsToProcess.push(...monthThreads.slice(0, threadsToTake));
    }
    
    // If we still have room, fill with remaining threads from all months (round-robin)
    if (threadsToProcess.length < maxThreads) {
      const remainingThreads = [];
      months.forEach(month => {
        const monthThreads = threadsByMonth[month];
        const alreadyTaken = threadsPerMonth;
        remainingThreads.push(...monthThreads.slice(alreadyTaken));
      });
      
      const additionalNeeded = maxThreads - threadsToProcess.length;
      threadsToProcess.push(...remainingThreads.slice(0, additionalNeeded));
    }
    
    if (threads.length > maxThreads) {
      Log.info('Balanced threads for processing across months', {
        total: threads.length,
        processingThisRun: threadsToProcess.length,
        remainingForNextRun: threads.length - threadsToProcess.length,
        estimatedRuns: Math.ceil(threads.length / CONFIG.MAX_THREADS_PER_RUN),
        distribution: Object.keys(threadsByMonth).map(month => {
          const monthThreadsInBatch = threadsToProcess.filter(t => {
            const messages = t.getMessages();
            if (messages.length === 0) return false;
            const messageDate = new Date(messages[messages.length - 1].getDate());
            const yearMonth = Utilities.formatDate(messageDate, Session.getScriptTimeZone(), 'yyyy-MM');
            return yearMonth === month;
          }).length;
          return { month: month, processing: monthThreadsInBatch, total: threadsByMonth[month].length };
        })
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
      // FATAL ERROR FIX: Check execution time before processing next batch with buffer
      const elapsedTime = Date.now() - startTime;
      const timeRemaining = CONFIG.MAX_EXECUTION_TIME_MS - elapsedTime;
      
      if (elapsedTime > CONFIG.MAX_EXECUTION_TIME_MS) {
        isTimeLimitReached = true;
        Log.warn('Graceful shutdown: Maximum execution time reached, stopping processing', {
          elapsedTime: Math.round(elapsedTime / 1000) + 's',
          maxTime: Math.round(CONFIG.MAX_EXECUTION_TIME_MS / 1000) + 's',
          processed: results.processed,
          created: results.created,
          skipped: results.skipped,
          remaining: threadsToProcess.length - i
        });
        break;
      }
      
      const batch = threadsToProcess.slice(i, i + CONFIG.BATCH_SIZE);
      
      Log.info('Processing batch', {
        batch: Math.floor(i / CONFIG.BATCH_SIZE) + 1,
        totalBatches: Math.ceil(threadsToProcess.length / CONFIG.BATCH_SIZE),
        batchSize: batch.length,
        elapsedTime: Math.round(elapsedTime / 1000) + 's',
        timeRemaining: Math.round(timeRemaining / 1000) + 's'
      });
      
      for (const thread of batch) {
        // FATAL ERROR FIX: Check execution time before processing each thread
        const elapsedTime = Date.now() - startTime;
        const timeRemaining = CONFIG.MAX_EXECUTION_TIME_MS - elapsedTime;
        
        if (elapsedTime > CONFIG.MAX_EXECUTION_TIME_MS) {
          isTimeLimitReached = true;
          Log.warn('Graceful shutdown: Maximum execution time reached, stopping processing', {
            elapsedTime: Math.round(elapsedTime / 1000) + 's',
            processed: results.processed,
            created: results.created,
            timeRemaining: Math.round(timeRemaining / 1000) + 's'
          });
          break;
        }
        
        // LOGGING & TELEMETRY: Log remaining GAS execution time
        const remainingGASTime = (CONFIG.MAX_EXECUTION_TIME_MS - elapsedTime) / 1000;
        Log.debug('Time remaining before GAS timeout', {
          elapsedTime: Math.round(elapsedTime / 1000) + 's',
          timeRemaining: Math.round(timeRemaining / 1000) + 's',
          remainingGASExecutionTime: Math.round(remainingGASTime) + 's',
          buffer: '40s before 6-minute limit'
        });
        
        try {
          const threadResult = processThread(requestId, thread);
          results.processed += threadResult.processed;
          results.created += threadResult.created;
          results.skipped += threadResult.skipped;
          
          // Reset consecutive timeout counter on successful processing
          if (threadResult.processed > 0 || threadResult.created > 0) {
            consecutiveTimeouts = 0;
          }
          
        } catch (error) {
          results.errors++;
          
          // Circuit breaker: check for timeout errors
          const isTimeout = error.message && (
            error.message.includes('timeout') || 
            error.message.includes('Timeout') ||
            error.message.includes('took too long')
          );
          
          if (isTimeout) {
            consecutiveTimeouts++;
            Log.warn('Timeout detected, circuit breaker active', { 
              consecutiveTimeouts: consecutiveTimeouts,
              maxAllowed: MAX_CONSECUTIVE_TIMEOUTS,
              threadId: thread.getId()
            });
            
            if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
              Log.error('Too many consecutive Vertex AI timeouts, stopping execution to prevent waste', {
                consecutiveTimeouts: consecutiveTimeouts,
                processed: results.processed,
                created: results.created,
                skipped: results.skipped,
                errors: results.errors
              });
              break; // Exit the processing loop
            }
          } else {
            // Reset counter on non-timeout errors
            consecutiveTimeouts = 0;
          }
          
          Log.error('Error processing thread', {
            error: error.message,
            threadId: thread.getId(),
            isTimeout: isTimeout
          });
        }
      }
      
      // Small delay between batches (optimized: reduced from 500ms to 100ms)
      if (i + CONFIG.BATCH_SIZE < threadsToProcess.length) {
        Utilities.sleep(100);
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
    
  } finally {
    // AUTO-RECOVERY TRIGGER: If time limit reached and there are remaining threads, schedule next run
    if (isTimeLimitReached && allThreads.length > 0) {
      try {
        setupNextTrigger(requestId);
      } catch (triggerError) {
        Log.error('Failed to setup auto-recovery trigger', {
          error: triggerError.message,
          requestId: requestId
        });
      }
    }
  }
}

/**
 * Setup auto-recovery trigger for next execution (if time limit reached)
 * Deletes existing triggers first to avoid trigger-leaking
 * @param {string} requestId - Request tracking ID
 */
function setupNextTrigger(requestId) {
  // TRIGGER CLEANUP: Wrap all ScriptApp calls in try/catch to prevent crashes
  // Even though we added the OAuth scope, permission issues can still occur
  try {
    // Delete existing triggers with same name to avoid trigger-leaking
    let existingTriggers = [];
    try {
      existingTriggers = ScriptApp.getProjectTriggers().filter(trigger => 
        trigger.getHandlerFunction() === 'processInvoiceEmails'
      );
    } catch (error) {
      Log.warn('Failed to get existing triggers (permission issue?)', {
        error: error.message,
        requestId: requestId
      });
      // Continue anyway - try to create new trigger
    }
    
    // Delete existing triggers
    if (existingTriggers.length > 0) {
      try {
        existingTriggers.forEach(trigger => {
          try {
            ScriptApp.deleteTrigger(trigger);
            Log.debug('Deleted existing trigger', {
              triggerId: trigger.getUniqueId(),
              handlerFunction: trigger.getHandlerFunction()
            });
          } catch (deleteError) {
            Log.warn('Failed to delete existing trigger', {
              error: deleteError.message,
              triggerId: trigger.getUniqueId()
            });
            // Continue - try to delete others
          }
        });
      } catch (error) {
        Log.warn('Error during trigger cleanup', {
          error: error.message,
          requestId: requestId
        });
        // Continue - try to create new trigger anyway
      }
    }
    
    // Create one-time trigger to continue processing after 60 seconds
    let newTrigger = null;
    try {
      newTrigger = ScriptApp.newTrigger('processInvoiceEmails')
        .timeBased()
        .after(60000) // 60 seconds delay
        .create();
      
      Log.info('Auto-recovery trigger created successfully', {
        requestId: requestId,
        triggerId: newTrigger.getUniqueId(),
        handlerFunction: 'processInvoiceEmails',
        delay: '60 seconds',
        reason: 'Time limit reached, continuing processing in next execution'
      });
    } catch (createError) {
      Log.error('Failed to create auto-recovery trigger (permission issue?)', {
        error: createError.message,
        requestId: requestId,
        suggestion: 'Check OAuth scope: https://www.googleapis.com/auth/script.scriptapp'
      });
      // Don't throw - allow execution to complete even if trigger creation fails
      return false;
    }
    
    return true;
    
  } catch (error) {
    // Catch-all for any unexpected errors
    Log.error('Unexpected error in setupNextTrigger', {
      error: error.message,
      stack: error.stack,
      requestId: requestId
    });
    // Don't throw - allow execution to complete even if trigger setup fails
    return false;
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
        const isTimeout = error.message && (
          error.message.includes('timeout') || 
          error.message.includes('Timeout') ||
          error.message.includes('took too long')
        );
        
        if (isTimeout) {
          Log.warn('Message processing timeout - skipping and continuing', {
            error: error.message,
            messageId: messageId,
            subject: msgData.subject
          });
          result.skipped++;
        } else {
          Log.error('Error processing message', {
            error: error.message,
            messageId: messageId,
            subject: msgData.subject
          });
        }
        // Continue with next message
        result.processed++;
      }
    }
    
  } catch (error) {
    const isTimeout = error.message && (
      error.message.includes('timeout') || 
      error.message.includes('Timeout') ||
      error.message.includes('took too long') ||
      error.message.includes('Maximum execution time reached')
    );
    
    if (isTimeout) {
      Log.warn('Thread processing timeout - skipping and continuing', {
        error: error.message,
        threadId: thread.getId()
      });
      // Return partial results so we continue processing
      return result;
    }
    
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
  const messageStartTime = Date.now();
  const maxProcessingTime = CONFIG.MAX_INVOICE_PROCESSING_TIME_MS;
  
  Log.info('Processing message', {
    messageId: msgData.messageId,
    subject: msgData.subject,
    hasAttachments: msgData.hasAttachments
  });
  
  try {
    let file = null;
    let invoiceData = null;
    
    // Check timeout before starting processing
    const checkTimeout = function() {
      const elapsed = Date.now() - messageStartTime;
      if (elapsed > maxProcessingTime) {
        throw new Error(`Invoice processing timeout after ${elapsed}ms (max: ${maxProcessingTime}ms)`);
      }
    };
    
    // REJECTION LOGIC: Do NOT reject early based on email body/subject
    // Only reject if AI identifies them as "proveedor" (issuer) in the extracted data
    // This prevents false positives from signatures, email footers, or context mentions
    
    // Handle attachments or validate email body first
    if (msgData.hasAttachments && msgData.attachments.length > 0) {
      // Filter for PDF attachments only
      const pdfAttachments = msgData.attachments.filter(att => {
        const contentType = att.getContentType();
        const name = att.getName().toLowerCase();
        return contentType === 'application/pdf' || name.endsWith('.pdf');
      });
      
      if (pdfAttachments.length === 0) {
        // Has attachments but no PDFs - skip (not an invoice)
        Log.info('Has attachments but no PDFs, skipping', {
          attachments: msgData.attachments.map(a => a.getName()),
          subject: msgData.subject
        });
        return null;
      }
      
      // Prioritize PDFs - use first PDF attachment
      const attachment = pdfAttachments[0];
      Log.info('Found PDF attachment(s), using first PDF', {
        count: pdfAttachments.length,
        filename: attachment.getName(),
        totalAttachments: msgData.attachments.length
      });
      
      // Check attachment filename for Ipronics/Intelectium BEFORE downloading
      const attachmentName = (attachment.getName() || '').toLowerCase();
      if (CONFIG.EMPRESAS_EMISORAS.some(empresa => attachmentName.includes(empresa))) {
        Log.info('Rejected: Attachment filename mentions Intelectium/Ipronics', {
          filename: attachment.getName(),
          subject: msgData.subject
        });
        return null;
      }
      
      // Early duplicate check for attachments based on filename pattern
      // Extract potential invoice number from filename (e.g., "Invoice-12345.pdf" or "FRA_L_1629.pdf")
      const filename = attachment.getName();
      const filenameMatch = filename.match(/[A-Z0-9]+[-_][0-9]+|[A-Z]+[_-]?[0-9]{4,}|[0-9]{5,}/i);
      if (filenameMatch) {
        const potentialInvoiceNum = filenameMatch[0].replace(/[-_]/g, '').replace(/^[A-Z]+/i, '');
        if (potentialInvoiceNum && potentialInvoiceNum.length >= 3) {
          // Quick check if similar invoice exists (using only invoice number, provider will be null)
          if (SheetsManager.invoiceExists(potentialInvoiceNum, null, null)) {
            Log.info('Skipping: Potential duplicate detected from filename', {
              filename: filename,
              invoiceNumber: potentialInvoiceNum,
              subject: msgData.subject
            });
            return null;
          }
        }
      }
      
      // Save attachment first (PDFs are always saved, they're already invoices)
      // We'll move it to the correct folder after extracting invoice data
      const tempFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
      file = DriveManager.saveAttachment(requestId, attachment, tempFolder);
      
      // MULTIMODAL INJECTION: For PDFs < 1MB, skip text extraction and pass blob directly to Vertex AI
      const pdfSize = file.getSize();
      const useMultimodal = pdfSize < 1048576; // 1MB threshold
      
      // VARIABLE SCOPE FIX: Do NOT redeclare invoiceData here - it's already declared at function scope (line 404)
      // Remove "let" keyword to assign to parent scope variable
      let fileBlob = null;
      
      if (useMultimodal) {
        // Small PDF: Use multimodal injection (send PDF blob directly to Vertex AI)
        Log.info('PDF < 1MB, using multimodal injection (skipping text extraction)', {
          fileId: file.getId(),
          fileName: file.getName(),
          fileSize: Math.round(pdfSize / 1024) + 'KB',
          threshold: '1MB'
        });
        
        checkTimeout();
        fileBlob = file.getBlob();
        
        // Prepare minimal content (email body as context)
        let combinedContent = '';
        if (msgData.body && msgData.body.trim().length > 0) {
          combinedContent += `CONTENIDO DEL EMAIL (contexto adicional):\n${msgData.body}\n\n`;
        }
        if (msgData.subject) {
          combinedContent += `ASUNTO DEL EMAIL: ${msgData.subject}\n\n`;
        }
        
        checkTimeout();
        Log.info('Extracting invoice data using multimodal (PDF blob + email context)', {
          fileId: file.getId(),
          blobSize: fileBlob.getBytes().length
        });
        // Assign to parent scope invoiceData (no let keyword)
        invoiceData = VertexAI.extractInvoiceData(requestId, combinedContent, CONFIG.MAX_RETRIES, fileBlob);
        checkTimeout();
        
      } else {
        // Large PDF: Extract text (existing flow)
        Log.info('PDF >= 1MB, using text extraction method', {
          fileId: file.getId(),
          fileSize: Math.round(pdfSize / 1024 / 1024 * 100) / 100 + 'MB',
          threshold: '1MB'
        });
        
        checkTimeout();
        const pdfText = VertexAI._extractTextFromPDF(requestId, file);
        checkTimeout();
        
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
        
        checkTimeout();
        Log.info('Extracting invoice data from PDF text + email body', { fileId: file.getId() });
        // Assign to parent scope invoiceData (no let keyword)
        invoiceData = VertexAI.extractInvoiceData(requestId, combinedContent, CONFIG.MAX_RETRIES);
        checkTimeout();
      }
      
      // VALIDATION LOGIC FIX: extractInvoiceData already calls _isValidInvoice internally
      // If it returns null, validation failed. If it returns an object, invoice is valid.
      // No need for additional validation checks here - they would conflict with _isValidInvoice logic
      if (!invoiceData) {
        Log.warn('Invoice extraction returned null (rejected by _isValidInvoice in extractInvoiceData)', {
          fileId: file ? file.getId() : 'N/A',
          note: 'Check VertexAI logs for detailed rejection reason'
        });
        if (file) {
          try {
            DriveApp.getFileById(file.getId()).setTrashed(true);
            Log.info('Cleaned up rejected invoice file', { fileId: file.getId() });
          } catch (e) {
            Log.warn('Could not clean up rejected file', { error: e.message });
          }
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
      
      // REJECTION LOGIC: Do NOT reject early based on email body/subject keywords
      // Only reject if AI identifies them as "proveedor" (issuer) in the extracted data
      // This prevents false positives from signatures, email footers, or context mentions
      
      // Quick rejection patterns for obvious non-invoices (BEFORE calling Vertex AI)
      const nonInvoicePatterns = [
        /entregado.*productos/i,
        /pedido.*enviado/i,
        /suscripción.*camino/i,
        /último correo/i,
        /your.*order.*shipped/i,
        /tracking.*number/i,
        /envío realizado/i,
        /tu pedido.*se ha/i,
        /n\.º de pedido/i,
        /número de pedido/i,
        /order.*number/i
      ];
      
      const subjectLower = (msgData.subject || '').toLowerCase();
      const bodyPreview = emailContent.substring(0, 500).toLowerCase();
      
      if (nonInvoicePatterns.some(pattern => 
          pattern.test(subjectLower) || pattern.test(bodyPreview))) {
        Log.info('Rejected early: Email matches non-invoice pattern (shipping/order confirmation)', {
          subject: msgData.subject,
          matchedPattern: nonInvoicePatterns.find(p => p.test(subjectLower) || p.test(bodyPreview)).toString()
        });
        return null;
      }
      
      Log.info('Validating email body before creating PDF', {
        contentLength: emailContent.length
      });
      
      // Extract invoice data from email body first
      checkTimeout(); // Check timeout before expensive operation
      invoiceData = VertexAI.extractInvoiceData(requestId, emailContent, CONFIG.MAX_RETRIES);
      checkTimeout(); // Check timeout after expensive operation
      
      // Validation for emails without attachments:
      // 1. Must explicitly be marked as invoice (esFactura !== false)
      // 2. Must have proveedor AND (numeroFactura OR importeTotal)
      //    - Many receipts (Stripe, AWS) don't have formal invoice numbers but have amounts
      // 3. Must pass _isValidInvoice check
      if (invoiceData && 
          invoiceData.esFactura !== false && 
          invoiceData.proveedor && 
          invoiceData.proveedor.trim() !== '' &&
          (invoiceData.numeroFactura || invoiceData.importeTotal)) {
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
    
    // VALIDATION LOGIC FIX: extractInvoiceData already calls _isValidInvoice internally
    // If it returns a non-null object, the invoice is already validated
    // We only need to check if it's null (which means validation failed)
    // DO NOT add duplicate validation logic here - it will conflict with _isValidInvoice
    if (!invoiceData) {
      Log.warn('Invoice extraction returned null (rejected by _isValidInvoice)', {
        invoiceData: invoiceData,
        note: 'Check VertexAI logs for rejection reason'
      });
      // If we created a file but validation failed, clean it up
      if (file) {
        try {
          DriveApp.getFileById(file.getId()).setTrashed(true);
          Log.info('Cleaned up rejected PDF file', { fileId: file.getId() });
        } catch (e) {
          Log.warn('Could not clean up rejected PDF file', { error: e.message });
        }
      }
      return null;
    }
    
    // Get file URL first (needed for duplicate check)
    const fileUrl = file ? DriveManager.getFileUrl(file) : '';
    
    // Check if invoice already exists (by number, provider, or file URL)
    // This is the definitive check after we have extracted data
    if (SheetsManager.invoiceExists(invoiceData.numeroFactura, invoiceData.proveedor, fileUrl)) {
      Log.info('Invoice already exists in sheet - skipping', {
        numeroFactura: invoiceData.numeroFactura,
        proveedor: invoiceData.proveedor,
        fileUrl: fileUrl
      });
      
      // Clean up file if we created it but it's a duplicate
      if (file) {
        try {
          DriveApp.getFileById(file.getId()).setTrashed(true);
          Log.info('Cleaned up duplicate PDF file', { fileId: file.getId() });
        } catch (e) {
          Log.warn('Could not clean up duplicate PDF file', { error: e.message });
        }
      }
      
      return null;
    }
    
    // Rename file with invoice information
    if (file) {
      DriveManager.renameInvoiceFile(requestId, file, invoiceData);
    }
    
    // Register in spreadsheet
    SheetsManager.registerInvoice(requestId, invoiceData, fileUrl);
    
    // RELIABILITY: Mark as processed IMMEDIATELY after successful registration to prevent duplicates
    Storage.markEmailProcessed(msgData.messageId);
    
    Log.info('Message processed successfully', {
      messageId: msgData.messageId,
      proveedor: invoiceData.proveedor,
      numeroFactura: invoiceData.numeroFactura
    });
    
    return invoiceData;
    
  } catch (error) {
    const elapsed = Date.now() - messageStartTime;
    Log.error('Failed to process message', {
      error: error.message,
      messageId: msgData.messageId,
      elapsed: elapsed + 'ms',
      stack: error.stack
    });
    
    // If timeout, don't throw - just skip this message and continue
    if (error.message && error.message.includes('timeout')) {
      Log.warn('Skipping message due to timeout', {
        messageId: msgData.messageId,
        elapsed: elapsed
      });
      return null;
    }
    
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
