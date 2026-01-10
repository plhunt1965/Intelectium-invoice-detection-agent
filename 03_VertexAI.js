/**
 * Vertex AI Module
 * Handles invoice data extraction using Vertex AI Gemini 3
 * Updated: 2026-01-09 - v1.6: Prompt mejorado con ejemplo Carles, balanceo por mes, validación estricta, logging mejorado
 */

const VertexAI = {
  _rateLimiter: {
    _calls: [],
    _maxCalls: CONFIG.RATE_LIMIT_CALLS_PER_MINUTE,
    
    /**
     * Check if we can make a call
     */
    canCall: function() {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      this._calls = this._calls.filter(timestamp => timestamp > oneMinuteAgo);
      return this._calls.length < this._maxCalls;
    },
    
    /**
     * Record a call
     */
    recordCall: function() {
      this._calls.push(Date.now());
    },
    
    /**
     * Wait until we can make a call
     */
    waitIfNeeded: function() {
      const waitStartTime = Date.now();
      const maxWaitTime = CONFIG.MAX_RATE_LIMITER_WAIT_MS;
      
      while (!this.canCall()) {
        // Check if we've exceeded maximum wait time
        const waitElapsed = Date.now() - waitStartTime;
        if (waitElapsed > maxWaitTime) {
          Log.warn('Rate limiter: Maximum wait time exceeded, proceeding anyway', {
            waitElapsed: waitElapsed,
            maxWaitTime: maxWaitTime
          });
          break;
        }
        
        // Safety check: if array is empty, we should be able to call
        if (this._calls.length === 0) {
          Log.warn('Rate limiter: _calls is empty but canCall() returned false, breaking loop');
          break;
        }
        
        const oldestCall = Math.min(...this._calls);
        const now = Date.now();
        const ageOfOldestCall = now - oldestCall;
        
        // Calculate how long to wait until the oldest call expires (leaves the 1-minute window)
        // We need to wait until oldestCall is more than 60 seconds old
        const waitTime = Math.max(0, 60000 - ageOfOldestCall + 1000); // +1000ms buffer
        
        // Cap wait time to remaining max wait time
        const remainingWaitTime = maxWaitTime - waitElapsed;
        const actualWaitTime = Math.min(waitTime, remainingWaitTime, 30000); // Cap at 30 seconds per iteration
        
        if (actualWaitTime > 0 && actualWaitTime <= 30000) { // Sanity check: wait time should be reasonable
          Log.debug('Rate limit reached, waiting', { 
            waitTime: actualWaitTime,
            oldestCallAge: ageOfOldestCall,
            callsInWindow: this._calls.length,
            totalWaitElapsed: waitElapsed
          });
          Utilities.sleep(actualWaitTime);
        } else {
          // Invalid wait time - something is wrong, break to avoid infinite loop
          Log.warn('Rate limiter: Invalid wait time calculated, breaking loop', {
            waitTime: waitTime,
            actualWaitTime: actualWaitTime,
            oldestCall: oldestCall,
            now: now,
            ageOfOldestCall: ageOfOldestCall
          });
          break;
        }
        
        // Re-check after sleep - canCall() will filter expired calls
        this.canCall();
      }
    }
  },
  
  /**
   * Extract invoice data from content using Vertex AI with multimodal support
   * @param {string} requestId - Request tracking ID
   * @param {string} content - Text content (email body + file reference)
   * @param {number} maxRetries - Maximum retry attempts
   * @param {Blob} fileBlob - Optional PDF blob for multimodal injection (skip text extraction)
   * @returns {Object} Extracted invoice data
   */
  extractInvoiceData: function(requestId, content, maxRetries, fileBlob) {
    maxRetries = maxRetries || CONFIG.MAX_RETRIES;
    
    const startTime = Date.now();
    const maxTotalTime = CONFIG.MAX_INVOICE_PROCESSING_TIME_MS - 10000; // Reserve 10s for other operations (PDF, Drive, etc)
    const maxSingleCallTime = CONFIG.MAX_VERTEX_AI_CALL_TIME_MS;
    
    Log.info('Extracting invoice data with Vertex AI', {
      contentLength: content ? content.length : 0,
      maxRetries: maxRetries,
      maxTotalTime: maxTotalTime + 'ms',
      maxSingleCallTime: maxSingleCallTime + 'ms'
    });
    
    // Check timeout before starting
    const checkTimeout = function() {
      const elapsed = Date.now() - startTime;
      if (elapsed > maxTotalTime) {
        throw new Error(`Vertex AI extraction timeout after ${elapsed}ms (max: ${maxTotalTime}ms)`);
      }
    };
    
    checkTimeout();
    this._rateLimiter.waitIfNeeded();
    checkTimeout();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        checkTimeout(); // Check before each attempt
        
        this._rateLimiter.recordCall();
        
        // MULTIMODAL INJECTION: Use fileBlob if provided (skip text extraction for small PDFs)
        // If fileBlob is provided, use multimodal mode (PDF sent directly to Vertex AI)
        // Otherwise, use text content (limited to prevent timeouts)
        let prompt;
        
        if (fileBlob) {
          // Multimodal mode: send PDF blob directly, use minimal prompt
          prompt = CONFIG.INVOICE_EXTRACTION_PROMPT.replace('{content}', 'PDF adjunto - extrae los datos directamente del PDF.');
          Log.debug('Using multimodal mode with PDF blob', {
            blobSize: fileBlob.getBytes().length,
            blobSizeMB: (fileBlob.getBytes().length / 1024 / 1024).toFixed(2)
          });
        } else {
          // Text mode: Limit to 2000 chars to prevent Vertex AI timeouts
          const MAX_CONTENT_LENGTH = 2000;
          let textContent = content || '';
          
          if (content && content.length > MAX_CONTENT_LENGTH) {
            Log.warn('Content too long, truncating to prevent timeout', {
              originalLength: content.length,
              truncatedLength: MAX_CONTENT_LENGTH
            });
            textContent = content.substring(0, MAX_CONTENT_LENGTH);
          }
          
          prompt = CONFIG.INVOICE_EXTRACTION_PROMPT.replace('{content}', textContent);
        }
        
        const callStartTime = Date.now();
        Log.debug('Calling Vertex AI API', { 
          attempt: attempt, 
          promptLength: prompt.length,
          hasFileBlob: !!fileBlob,
          elapsed: callStartTime - startTime + 'ms',
          maxCallTime: maxSingleCallTime + 'ms',
          remainingTime: (maxTotalTime - (callStartTime - startTime)) + 'ms'
        });
        
        // Check timeout before making the call
        checkTimeout();
        
        // Call API with optional fileBlob for multimodal
        const response = this._callAPI(requestId, prompt, fileBlob);
        const callElapsed = Date.now() - callStartTime;
        
        // Double check - if the call took longer than expected, throw error immediately
        if (callElapsed > maxSingleCallTime) {
          throw new Error(`Vertex AI call took too long: ${callElapsed}ms (max: ${maxSingleCallTime}ms)`);
        }
        
        // Also check total time elapsed
        checkTimeout();
        
        checkTimeout(); // Check after API call
        
        const invoiceData = this._parseResponse(requestId, response);
        checkTimeout(); // Check after parsing
        
        // Validate and normalize numeric fields
        if (invoiceData) {
          // Convert string numbers to actual numbers and handle comma decimals
          if (typeof invoiceData.importeSinIVA === 'string') {
            invoiceData.importeSinIVA = parseFloat(invoiceData.importeSinIVA.replace(',', '.')) || null;
          }
          if (typeof invoiceData.iva === 'string') {
            invoiceData.iva = parseFloat(invoiceData.iva.replace(',', '.')) || null;
          }
          if (typeof invoiceData.importeTotal === 'string') {
            invoiceData.importeTotal = parseFloat(invoiceData.importeTotal.replace(',', '.')) || null;
          }
          
          // Ensure numbers are properly formatted
          if (invoiceData.importeSinIVA !== null && isNaN(invoiceData.importeSinIVA)) {
            invoiceData.importeSinIVA = null;
          }
          if (invoiceData.iva !== null && isNaN(invoiceData.iva)) {
            invoiceData.iva = null;
          }
          if (invoiceData.importeTotal !== null && isNaN(invoiceData.importeTotal)) {
            invoiceData.importeTotal = null;
          }
        }
        
        // Validate that this is actually an invoice
        if (!this._isValidInvoice(invoiceData)) {
          Log.warn('Extracted data does not appear to be a valid invoice', {
            invoiceData: invoiceData
          });
          return null;
        }
        
        const totalTime = Date.now() - startTime;
        Log.info('Invoice data extracted successfully', {
          proveedor: invoiceData.proveedor,
          numeroFactura: invoiceData.numeroFactura,
          totalTime: totalTime + 'ms',
          attempts: attempt
        });
        
        return invoiceData;
        
      } catch (error) {
        const elapsed = Date.now() - startTime;
        
        // EXPONENTIAL BACKOFF: Handle different error types
        const isTimeout = error.message && error.message.includes('timeout');
        const isRetriableError = error.type === 'RETRIABLE_ERROR' || error.type === 'FAILED_TEMPORARY';
        const isRetriableHttpCode = error.code && (error.code === 429 || error.code === 500 || error.code === 503);
        
        // If timeout or non-retriable error, don't retry
        if (isTimeout && !isRetriableError) {
          Log.error('Vertex AI extraction timeout, aborting', {
            attempt: attempt,
            elapsed: elapsed + 'ms',
            error: error.message
          });
          throw error;
        }
        
        // If not retriable and not last attempt, continue to next attempt
        if (!isRetriableError && !isRetriableHttpCode && attempt < maxRetries) {
          Log.warn('Vertex AI extraction attempt failed (non-retriable)', {
            attempt: attempt,
            maxRetries: maxRetries,
            error: error.message || error.type,
            elapsed: elapsed + 'ms'
          });
          // Continue to next attempt without backoff
          continue;
        }
        
        // Last attempt or retriable error - check if we should retry
        if (attempt >= maxRetries) {
          Log.error('Vertex AI extraction failed after retries', {
            error: error.message || error.type || 'Unknown error',
            errorCode: error.code,
            totalTime: elapsed + 'ms',
            stack: error.stack
          });
          throw error;
        }
        
        // EXPONENTIAL BACKOFF: Jittered exponential backoff for retriable errors
        checkTimeout();
        
        // Calculate jittered exponential backoff: base * 2^attempt + random jitter
        const baseBackoff = Math.pow(2, attempt) * 1000; // Base: 2s, 4s, 8s
        const jitter = Math.random() * 1000; // Random jitter 0-1000ms
        const backoffTime = Math.min(baseBackoff + jitter, 10000); // Cap at 10s
        
        Log.warn('Vertex AI extraction attempt failed, retrying with backoff', {
          attempt: attempt,
          maxRetries: maxRetries,
          error: error.message || error.type,
          errorCode: error.code,
          elapsed: elapsed + 'ms',
          backoffTime: Math.round(backoffTime) + 'ms',
          jitter: Math.round(jitter) + 'ms',
          nextAttempt: attempt + 1
        });
        
        Utilities.sleep(backoffTime);
        checkTimeout();
      }
    }
  },
  
  /**
   * Extract text from PDF file using Drive API
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Drive.File} file - Drive file (PDF)
   * @returns {string} Extracted text content
   * @private
   */
  _extractTextFromPDF: function(requestId, file) {
    Log.debug('Extracting text from PDF file', { fileId: file.getId(), fileName: file.getName() });
    
    const startTime = Date.now();
    const maxTime = CONFIG.MAX_PDF_EXTRACTION_TIME_MS;
    
    try {
      const fileId = file.getId();
      const pdfFile = DriveApp.getFileById(fileId);
      const fileSize = pdfFile.getSize();
      
      // PDF HANDLING: Skip text extraction for large PDFs (>2MB) to save time
      // Rely on email body + filename instead
      if (fileSize > CONFIG.MAX_PDF_SIZE_FOR_EXTRACTION) {
        Log.info('PDF too large for text extraction, skipping', {
          fileId: fileId,
          fileName: pdfFile.getName(),
          fileSize: Math.round(fileSize / 1024 / 1024) + 'MB',
          maxSize: Math.round(CONFIG.MAX_PDF_SIZE_FOR_EXTRACTION / 1024 / 1024) + 'MB',
          note: 'Will use email body and filename instead'
        });
        return ''; // Return empty - will use email body + filename
      }
      
      // Method: Convert PDF to Google Docs temporarily to extract text
      try {
        
        // Create a temporary Google Doc from the PDF
        // Use Drive API v3 to copy and convert
        const tempDocFile = Drive.Files.copy(
          { title: `temp_invoice_doc_${fileId}`, mimeType: 'application/vnd.google-apps.document' },
          fileId,
          { convert: true }
        );
        const tempDocId = tempDocFile.id;
        
        // Try to extract text immediately (optimization: many conversions are fast)
        let text = null;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts && !text) {
          // Check timeout
          const elapsed = Date.now() - startTime;
          if (elapsed > maxTime) {
            Log.warn('PDF extraction timeout reached', {
              elapsed: elapsed,
              maxTime: maxTime,
              fileId: fileId
            });
            break;
          }
          
          try {
            // Get text from the Google Doc
            const doc = DocumentApp.openById(tempDocId);
            const extractedText = doc.getBody().getText();
            
            if (extractedText && extractedText.trim().length > 50) {
              text = extractedText;
              break;
            }
          } catch (e) {
            // If first attempt fails, wait for conversion (optimization: reduced from 2000ms to 1000ms)
            if (attempts === 0) {
              Utilities.sleep(1000);
            } else if (attempts === 1) {
              // Second retry with additional wait
              Utilities.sleep(1000);
            }
            // If still fails after retries, will fall through to cleanup
          }
          attempts++;
        }
        
        // Clean up temp doc
        try {
          DriveApp.getFileById(tempDocId).setTrashed(true);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        
        if (text && text.trim().length > 50) {
          Log.info('PDF text extracted via Google Docs conversion', { 
            fileId: fileId,
            textLength: text.length,
            attempts: attempts
          });
          return text;
        } else {
          Log.warn('Extracted text too short or empty after Google Docs conversion', { 
            textLength: text ? text.length : 0,
            attempts: attempts
          });
        }
      } catch (e) {
        Log.warn('Google Docs conversion failed', { error: e.message });
      }
      
      // Fallback: return empty - will use email body
      Log.warn('Could not extract text from PDF, will use email body as fallback');
      return '';
      
    } catch (error) {
      Log.error('Failed to extract text from PDF', {
        error: error.message,
        fileId: file.getId()
      });
      return '';
    }
  },
  
  /**
   * Validate that extracted data represents a real invoice
   * @param {Object} invoiceData - Extracted invoice data
   * @returns {boolean} True if valid invoice
   * @private
   */
  _isValidInvoice: function(invoiceData) {
    if (!invoiceData) return false;
    
    // Check if AI explicitly said it's not an invoice
    if (invoiceData.esFactura === false) {
      Log.info('AI determined this is not an invoice', {
        razon: invoiceData.razon || 'Unknown reason'
      });
      return false;
    }
    
    // Check if it's an invoice issued BY Intelectium (should be rejected)
    const proveedor = (invoiceData.proveedor || '').toLowerCase();
    const concepto = (invoiceData.concepto || '').toLowerCase();
    
    // Check in provider name
    if (CONFIG.EMPRESAS_EMISORAS.some(empresa => proveedor.includes(empresa))) {
      Log.info('Rejected: Invoice issued by Intelectium/Ipronics, not received', {
        proveedor: invoiceData.proveedor
      });
      return false;
    }
    
    // Also check in concept (sometimes the provider name is in the concept)
    if (CONFIG.EMPRESAS_EMISORAS.some(empresa => concepto.includes(empresa))) {
      Log.info('Rejected: Invoice issued by Intelectium/Ipronics (found in concept), not received', {
        proveedor: invoiceData.proveedor,
        concepto: invoiceData.concepto
      });
      return false;
    }
    
    // Must have at least provider or invoice number
    if (!invoiceData.proveedor && !invoiceData.numeroFactura) {
      Log.warn('Missing both provider and invoice number');
      return false;
    }
    
    // Must have either invoice number OR total amount (for receipts without formal invoice numbers)
    // Many receipts (Stripe, AWS, etc.) don't have invoice numbers but have amounts
    const hasInvoiceNumber = invoiceData.numeroFactura && invoiceData.numeroFactura.trim() !== '';
    const hasAnyAmount = (invoiceData.importeSinIVA !== null && invoiceData.importeSinIVA !== undefined && invoiceData.importeSinIVA !== 0) ||
                         (invoiceData.iva !== null && invoiceData.iva !== undefined && invoiceData.iva !== 0) ||
                         (invoiceData.importeTotal !== null && invoiceData.importeTotal !== undefined && invoiceData.importeTotal !== 0);
    
    if (!hasInvoiceNumber && !hasAnyAmount) {
      Log.warn('Missing both invoice number and all amount fields - REJECTING', {
        proveedor: invoiceData.proveedor,
        numeroFactura: invoiceData.numeroFactura || 'missing',
        importeSinIVA: invoiceData.importeSinIVA,
        iva: invoiceData.iva,
        importeTotal: invoiceData.importeTotal
      });
      return false;
    }
    
    // If missing invoice number but has amount, log warning but allow (for receipts)
    if (!hasInvoiceNumber && hasAnyAmount) {
      Log.info('Invoice number missing but has amount - allowing (receipt type)', {
        proveedor: invoiceData.proveedor,
        importeTotal: invoiceData.importeTotal
      });
    }
    
    // Check for common false positive patterns
    // (concepto already declared above)
    
    // Reject marketing emails (but be careful - if there's a PDF, the invoice might be there)
    const marketingKeywords = ['marketing', 'publicidad', 'promoción', 'descuento', 'oferta especial', 'newsletter', 'tickets to', 'win tickets'];
    // Only reject if it's clearly marketing AND we don't have invoice data
    if (marketingKeywords.some(keyword => concepto.includes(keyword) || proveedor.includes(keyword))) {
      // If we have invoice number or amounts, it might still be valid
      if (!invoiceData.numeroFactura && (invoiceData.importeTotal === null || invoiceData.importeTotal === 0)) {
        Log.info('Rejected as marketing email', { proveedor: proveedor, concepto: concepto });
        return false;
      }
    }
    
    return true;
  },
  
  /**
   * Call Vertex AI API with support for multimodal (PDF blob) input
   * @param {string} requestId - Request tracking ID
   * @param {string} prompt - Text prompt
   * @param {Blob} fileBlob - Optional PDF blob for multimodal injection
   * @returns {Object} Parsed API response
   */
  _callAPI: function(requestId, prompt, fileBlob) {
    // URL correcta para Gemini 3 con locations/global
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${CONFIG.VERTEX_AI_PROJECT_ID}/locations/global/publishers/google/models/${CONFIG.VERTEX_AI_MODEL}:generateContent`;
    
    // MULTIMODAL INJECTION: Build payload with or without PDF blob
    const parts = [{ text: prompt }];
    
    if (fileBlob) {
      // Add PDF blob as inline_data for multimodal processing
      const base64Data = Utilities.base64Encode(fileBlob.getBytes());
      parts.push({
        inline_data: {
          mime_type: "application/pdf",
          data: base64Data
        }
      });
      
      Log.debug('Multimodal payload: PDF blob included', {
        requestId: requestId,
        blobSize: fileBlob.getBytes().length,
        base64Length: base64Data.length
      });
    }
    
    const payload = {
      contents: [{
        role: "user",
        parts: parts
      }],
      generationConfig: {
        temperature: 0.1
      }
    };
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: 25 // CRITICAL: Timeout in SECONDS. Set to 25s to match MAX_VERTEX_AI_CALL_TIME_MS
    };
    
    Log.debug('Calling Vertex AI', { 
      endpoint: endpoint,
      hasMultimodal: !!fileBlob,
      payloadSize: JSON.stringify(payload).length
    });
    
    const startTime = Date.now();
    let response;
    try {
      response = UrlFetchApp.fetch(endpoint, options);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      
      // EXPONENTIAL BACKOFF: Handle Socket Timeout errors
      if (error.message && error.message.includes('Socket Timeout')) {
        Log.warn('Socket Timeout error - temporary failure', {
          requestId: requestId,
          error: error.message,
          elapsed: elapsed
        });
        throw { 
          type: 'FAILED_TEMPORARY', 
          message: `Socket Timeout after ${elapsed}ms`,
          originalError: error 
        };
      }
      
      Log.error('Vertex AI fetch failed', {
        error: error.message,
        elapsed: elapsed
      });
      throw new Error(`Vertex AI API call failed after ${elapsed}ms: ${error.message}`);
    }
    
    const elapsed = Date.now() - startTime;
    Log.debug('Vertex AI response received', { elapsed: elapsed });
    
    const responseCode = response.getResponseCode();
    
    // EXPONENTIAL BACKOFF: Handle retriable HTTP errors
    if (responseCode === 429 || responseCode === 500 || responseCode === 503) {
      const errorText = response.getContentText();
      Log.warn('Retriable HTTP error from Vertex AI', {
        code: responseCode,
        requestId: requestId,
        respuesta_servidor: errorText.substring(0, 500)
      });
      throw { 
        type: 'RETRIABLE_ERROR', 
        code: responseCode,
        message: `Vertex AI API error: ${responseCode}`,
        responseText: errorText
      };
    }
    
    if (responseCode !== 200) {
      const errorText = response.getContentText();
      Log.error('Vertex AI Error Details', {
        code: responseCode,
        url_utilizada: endpoint,
        respuesta_servidor: errorText
      });
      throw new Error(`Vertex AI API error: ${responseCode} - ${errorText}`);
    }
    
    return JSON.parse(response.getContentText());
  },
  
  /**
   * Parse Vertex AI response to extract JSON
   */
  _parseResponse: function(requestId, response) {
    try {
      const text = response.candidates[0].content.parts[0].text.trim();
      
      // VERTEX AI OPTIMIZATION: Handle potential long responses better
      // Log raw response (truncated for large responses)
      const logLength = Math.min(text.length, 1000);
      Log.debug('Vertex AI raw response', {
        requestId: requestId,
        responseLength: text.length,
        firstChars: text.substring(0, logLength),
        truncated: text.length > logLength
      });
      
      // Try direct JSON parse first (prompt now returns ONLY JSON without markdown)
      try {
        const parsed = JSON.parse(text);
        Log.debug('Vertex AI parsed response (direct JSON)', {
          requestId: requestId,
          parsed: parsed
        });
        return parsed;
      } catch (directParseError) {
        // If direct parse fails, try to find JSON object in response
        // Remove markdown code blocks if present (backwards compatibility)
        let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        
        // Find JSON object (first { to last })
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            Log.debug('Vertex AI parsed response (extracted JSON)', {
              requestId: requestId,
              parsed: parsed
            });
            return parsed;
          } catch (extractParseError) {
            throw new Error('JSON encontrado pero no válido: ' + extractParseError.message);
          }
        }
        
        throw new Error('No se encontró un JSON válido en la respuesta. Direct parse error: ' + directParseError.message);
      }
      
    } catch (error) {
      Log.error('Error al parsear respuesta de Vertex AI', {
        error: error.message,
        requestId: requestId,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : [],
        texto_recibido: response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts && response.candidates[0].content.parts[0] ? response.candidates[0].content.parts[0].text.substring(0, 1000) : JSON.stringify(response).substring(0, 500)
      });
      throw new Error('Error al parsear respuesta de Vertex AI: ' + error.message);
    }
  }
};
