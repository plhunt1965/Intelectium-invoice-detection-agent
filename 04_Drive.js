/**
 * Drive Module
 * Manages folder structure and file operations in Google Drive
 */

const DriveManager = {
  /**
   * Get or create folder for invoice date
   * @param {string} requestId - Request tracking ID
   * @param {Date} invoiceDate - Date of invoice
   * @returns {GoogleAppsScript.Drive.Folder} Folder object
   */
  getOrCreateMonthFolder: function(requestId, invoiceDate) {
    Log.debug('Getting month folder', { invoiceDate: invoiceDate.toISOString() });
    
    try {
      const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
      const yearMonth = Utilities.formatDate(invoiceDate, Session.getScriptTimeZone(), 'yyyy-MM');
      
      // Check if folder already exists
      const folders = rootFolder.getFoldersByName(yearMonth);
      if (folders.hasNext()) {
        const folder = folders.next();
        Log.debug('Month folder exists', { folderId: folder.getId(), yearMonth: yearMonth });
        return folder;
      }
      
      // Create new folder
      const folder = rootFolder.createFolder(yearMonth);
      Log.info('Created month folder', { folderId: folder.getId(), yearMonth: yearMonth });
      
      return folder;
      
    } catch (error) {
      Log.error('Failed to get/create month folder', {
        error: error.message,
        invoiceDate: invoiceDate.toISOString()
      });
      throw error;
    }
  },
  
  /**
   * Save attachment to Drive
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Gmail.GmailAttachment} attachment - Gmail attachment
   * @param {GoogleAppsScript.Drive.Folder} folder - Target folder
   * @returns {GoogleAppsScript.Drive.File} Created file
   */
  saveAttachment: function(requestId, attachment, folder) {
    Log.debug('Saving attachment', {
      name: attachment.getName(),
      size: attachment.getSize(),
      contentType: attachment.getContentType()
    });
    
    try {
      const blob = attachment.copyBlob();
      const file = folder.createFile(blob);
      
      Log.info('Attachment saved', {
        fileId: file.getId(),
        filename: file.getName()
      });
      
      return file;
      
    } catch (error) {
      Log.error('Failed to save attachment', {
        error: error.message,
        attachmentName: attachment.getName()
      });
      throw error;
    }
  },
  
  /**
   * Rename file with invoice information
   * @param {string} requestId - Request tracking ID
   * @param {GoogleAppsScript.Drive.File} file - File to rename
   * @param {Object} invoiceData - Invoice data object
   * @returns {GoogleAppsScript.Drive.File} Renamed file
   */
  renameInvoiceFile: function(requestId, file, invoiceData) {
    try {
      const filename = this._generateInvoiceFilename(invoiceData);
      file.setName(filename);
      
      Log.info('File renamed', {
        fileId: file.getId(),
        newName: filename
      });
      
      return file;
      
    } catch (error) {
      Log.warn('Failed to rename file', {
        error: error.message,
        fileId: file.getId()
      });
      // Don't throw - renaming is not critical
      return file;
    }
  },
  
  /**
   * Generate filename for invoice
   * @param {Object} invoiceData - Invoice data object
   * @returns {string} Generated filename
   * @private
   */
  _generateInvoiceFilename: function(invoiceData) {
    const proveedor = this._sanitizeFilename(invoiceData.proveedor || 'Unknown');
    const numeroFactura = this._sanitizeFilename(invoiceData.numeroFactura || 'N/A');
    
    let fechaStr = 'Unknown';
    if (invoiceData.fechaFactura) {
      try {
        const fecha = new Date(invoiceData.fechaFactura);
        fechaStr = Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } catch (e) {
        // Use original string if date parsing fails
        fechaStr = invoiceData.fechaFactura.replace(/[^0-9-]/g, '').substring(0, 10);
      }
    }
    
    return `${proveedor}_${numeroFactura}_${fechaStr}.pdf`;
  },
  
  /**
   * Sanitize string for use in filename
   * @param {string} text - Text to sanitize
   * @returns {string} Sanitized text
   * @private
   */
  _sanitizeFilename: function(text) {
    if (!text) return 'Unknown';
    return text
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50)
      .trim();
  },
  
  /**
   * Get file URL
   * @param {GoogleAppsScript.Drive.File} file - Drive file
   * @returns {string} File URL
   */
  getFileUrl: function(file) {
    return file.getUrl();
  }
};
