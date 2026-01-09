/**
 * Vertex AI Module
 * Handles invoice data extraction using Vertex AI Gemini 3
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
      while (!this.canCall()) {
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
        
        if (waitTime > 0 && waitTime <= 61000) { // Sanity check: wait time should be reasonable
          Log.debug('Rate limit reached, waiting', { 
            waitTime: waitTime,
            oldestCallAge: ageOfOldestCall,
            callsInWindow: this._calls.length
          });
          Utilities.sleep(Math.min(waitTime, 61000)); // Cap at 61 seconds max
        } else {
          // Invalid wait time - something is wrong, break to avoid infinite loop
          Log.warn('Rate limiter: Invalid wait time calculated, breaking loop', {
            waitTime: waitTime,
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
   * Extract invoice data from content using Vertex AI
   * @param {string} requestId - Request tracking ID
   * @param {string} content - Text content (email body + file reference)
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Object} Extracted invoice data
   */
  extractInvoiceData: function(requestId, content, maxRetries) {
    maxRetries = maxRetries || CONFIG.MAX_RETRIES;
    
    const startTime = Date.now();
    
    Log.info('Extracting invoice data with Vertex AI', {
      contentLength: content ? content.length : 0
    });
    
    this._rateLimiter.waitIfNeeded();
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this._rateLimiter.recordCall();
        
        // Extract from text content (email body + file reference)
        const textContent = content.substring(0, 50000);
        const prompt = CONFIG.INVOICE_EXTRACTION_PROMPT.replace('{content}', textContent);
        
        Log.debug('Calling Vertex AI API', { attempt: attempt, promptLength: prompt.length });
        const response = this._callAPI(requestId, prompt);
        
        const invoiceData = this._parseResponse(response);
        
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
          totalTime: totalTime + 'ms'
        });
        
        return invoiceData;
        
      } catch (error) {
        const elapsed = Date.now() - startTime;
        Log.warn('Vertex AI extraction attempt failed', {
          attempt: attempt,
          maxRetries: maxRetries,
          error: error.message,
          elapsed: elapsed + 'ms'
        });
        
        if (attempt === maxRetries) {
          Log.error('Vertex AI extraction failed after retries', {
            error: error.message,
            totalTime: elapsed + 'ms',
            stack: error.stack
          });
          throw error;
        }
        
        const backoffTime = Math.pow(2, attempt) * 1000;
        Utilities.sleep(backoffTime);
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
    
    try {
      const fileId = file.getId();
      
      // Method: Convert PDF to Google Docs temporarily to extract text
      try {
        // Get the file
        const pdfFile = DriveApp.getFileById(fileId);
        
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
    const empresasEmisoras = [
      'intelectium', 
      'ipronics', 
      'ipronics program', 
      'ipronics programmable',
      'ipronics programmable photonics',
      'ipronics programmable s.l.'
    ];
    
    // Check in provider name
    if (empresasEmisoras.some(empresa => proveedor.includes(empresa))) {
      Log.info('Rejected: Invoice issued by Intelectium/Ipronics, not received', {
        proveedor: invoiceData.proveedor
      });
      return false;
    }
    
    // Also check in concept (sometimes the provider name is in the concept)
    if (empresasEmisoras.some(empresa => concepto.includes(empresa))) {
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
    
    // Invoice number is important but not always critical
    // Some invoices may not have a clear number format
    if (!invoiceData.numeroFactura || invoiceData.numeroFactura.trim() === '') {
      Log.warn('Invoice number is missing or empty', { 
        proveedor: invoiceData.proveedor 
      });
      // Still allow if we have provider and some amount data
      if (!invoiceData.proveedor) {
        return false;
      }
    }
    
    // Total amount should be present, but allow 0 for some cases
    if (invoiceData.importeTotal === null || invoiceData.importeTotal === undefined) {
      Log.warn('Missing total amount, but may still be valid invoice');
      // Don't reject immediately - allow if we have other data
      if (!invoiceData.proveedor && !invoiceData.numeroFactura) {
        return false;
      }
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
   * Call Vertex AI API - URL corregida según documentación oficial
   */
  _callAPI: function(requestId, prompt) {
    // URL correcta para Gemini 3 con locations/global
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${CONFIG.VERTEX_AI_PROJECT_ID}/locations/global/publishers/google/models/${CONFIG.VERTEX_AI_MODEL}:generateContent`;
    
    const payload = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
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
      timeout: 30000 // 30 seconds timeout (max for UrlFetchApp)
    };
    
    Log.debug('Calling Vertex AI', { endpoint: endpoint });
    
    const startTime = Date.now();
    let response;
    try {
      response = UrlFetchApp.fetch(endpoint, options);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      Log.error('Vertex AI fetch failed', {
        error: error.message,
        elapsed: elapsed
      });
      throw new Error(`Vertex AI API call failed after ${elapsed}ms: ${error.message}`);
    }
    
    const elapsed = Date.now() - startTime;
    Log.debug('Vertex AI response received', { elapsed: elapsed });
    
    const responseCode = response.getResponseCode();
    
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
  _parseResponse: function(response) {
    try {
      const text = response.candidates[0].content.parts[0].text;
      
      // Intentar encontrar un bloque de código JSON o el objeto directamente
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      throw new Error('No se encontró un JSON válido en la respuesta del modelo');
      
    } catch (error) {
      Log.error('Error al parsear respuesta de Vertex AI', {
        error: error.message,
        texto_recibido: JSON.stringify(response).substring(0, 500)
      });
      throw new Error('Error al parsear respuesta de Vertex AI: ' + error.message);
    }
  }
};