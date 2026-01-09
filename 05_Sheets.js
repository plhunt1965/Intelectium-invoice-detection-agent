/**
 * Sheets Module
 * Manages invoice registry in Google Sheets
 */

const SheetsManager = {
  _sheet: null,
  
  /**
   * Initialize sheet connection
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} Sheet object
   * @private
   */
  _getSheet: function() {
    if (!this._sheet) {
      try {
        const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        this._sheet = ss.getSheetByName('Facturas') || ss.insertSheet('Facturas');
        this._initializeHeaders();
      } catch (error) {
        Log.error('Failed to access spreadsheet', {
          error: error.message,
          spreadsheetId: CONFIG.SPREADSHEET_ID
        });
        throw error;
      }
    }
    return this._sheet;
  },
  
  /**
   * Initialize column headers if sheet is empty
   * @private
   */
  _initializeHeaders: function() {
    const sheet = this._getSheet();
    
    if (sheet.getLastRow() === 0) {
      const headers = [
        'Proveedor',
        'Fecha',
        'Nº Factura',
        'Concepto',
        'Importe sin IVA',
        'IVA',
        'Importe Total',
        'Link al archivo en Drive'
      ];
      
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
      
      // Auto-resize columns
      sheet.autoResizeColumns(1, headers.length);
      
      Log.info('Sheet headers initialized');
    }
  },
  
  /**
   * Register invoice in spreadsheet
   * @param {string} requestId - Request tracking ID
   * @param {Object} invoiceData - Invoice data object
   * @param {string} fileUrl - Drive file URL
   * @returns {number} Row number where invoice was registered
   */
  registerInvoice: function(requestId, invoiceData, fileUrl) {
    Log.info('Registering invoice in sheet', {
      proveedor: invoiceData.proveedor,
      numeroFactura: invoiceData.numeroFactura
    });
    
    try {
      const sheet = this._getSheet();
      
      // Format date
      let fechaStr = '';
      if (invoiceData.fechaFactura) {
        try {
          const fecha = new Date(invoiceData.fechaFactura);
          fechaStr = Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } catch (e) {
          fechaStr = invoiceData.fechaFactura;
        }
      }
      
      // Prepare row data
      const rowData = [
        invoiceData.proveedor || '',
        fechaStr,
        invoiceData.numeroFactura || '',
        invoiceData.concepto || '',
        invoiceData.importeSinIVA || 0,
        invoiceData.iva || 0,
        invoiceData.importeTotal || 0,
        fileUrl || ''
      ];
      
      // Append row
      const newRow = sheet.getLastRow() + 1;
      sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
      
      // Format number columns
      const numberColumns = [5, 6, 7]; // Importe sin IVA, IVA, Importe Total
      numberColumns.forEach(col => {
        const cell = sheet.getRange(newRow, col);
        if (cell.getValue()) {
          cell.setNumberFormat('#,##0.00');
        }
      });
      
      // Format date column
      if (fechaStr) {
        sheet.getRange(newRow, 2).setNumberFormat('yyyy-mm-dd');
      }
      
      Log.info('Invoice registered successfully', {
        row: newRow,
        proveedor: invoiceData.proveedor
      });
      
      return newRow;
      
    } catch (error) {
      Log.error('Failed to register invoice in sheet', {
        error: error.message,
        invoiceData: invoiceData
      });
      throw error;
    }
  },
  
  /**
   * Check if invoice already exists in sheet
   * @param {string} numeroFactura - Invoice number
   * @param {string} proveedor - Provider name
   * @param {string} fileUrl - Optional file URL to check for duplicates
   * @returns {boolean} True if invoice exists
   */
  invoiceExists: function(numeroFactura, proveedor, fileUrl) {
    if (!numeroFactura && !proveedor) {
      return false;
    }
    
    try {
      const sheet = this._getSheet();
      const dataRange = sheet.getDataRange();
      const values = dataRange.getValues();
      
      // Normalize provider name for comparison
      const normalizedProveedor = (proveedor || '').toLowerCase().trim();
      
      // Special case: Reject ALL Ipronics/Intelectium invoices (they should not be registered)
      const empresasEmisoras = [
        'intelectium', 
        'ipronics', 
        'ipronics program', 
        'ipronics programmable',
        'ipronics programmable photonics'
      ];
      if (empresasEmisoras.some(empresa => normalizedProveedor.includes(empresa))) {
        Log.info('Rejected: Invoice from Ipronics/Intelectium should not be registered', {
          proveedor: proveedor
        });
        return true; // Return true to prevent registration
      }
      
      // Skip header row
      for (let i = 1; i < values.length; i++) {
        const rowProveedor = (values[i][0] || '').toLowerCase().trim(); // Column A
        const rowNumero = (values[i][2] || '').toString().trim(); // Column C
        const rowFileUrl = values[i][7] || ''; // Column H (Link al archivo)
        
        // Check by invoice number (exact match)
        if (numeroFactura && rowNumero && rowNumero === numeroFactura.toString().trim()) {
          Log.info('Duplicate invoice found by number', {
            numeroFactura: numeroFactura,
            row: i + 1
          });
          return true;
        }
        
        // Check by provider + invoice number
        if (normalizedProveedor && numeroFactura && 
            rowProveedor === normalizedProveedor && 
            rowNumero === numeroFactura.toString().trim()) {
          Log.info('Duplicate invoice found by provider + number', {
            proveedor: proveedor,
            numeroFactura: numeroFactura,
            row: i + 1
          });
          return true;
        }
        
        // Special check: If this is an Ipronics invoice, reject it even if number is different
        if (empresasEmisoras.some(empresa => normalizedProveedor.includes(empresa) || rowProveedor.includes(empresa))) {
          Log.info('Duplicate Ipronics invoice found (rejecting all Ipronics invoices)', {
            proveedor: proveedor,
            existingProveedor: values[i][0],
            row: i + 1
          });
          return true;
        }
        
        // Check by file URL if provided (for duplicate PDF detection)
        if (fileUrl && rowFileUrl && rowFileUrl === fileUrl) {
          Log.info('Duplicate invoice found by file URL', {
            fileUrl: fileUrl,
            row: i + 1
          });
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      Log.warn('Error checking if invoice exists', {
        error: error.message
      });
      return false; // Assume not exists on error
    }
  }
};
