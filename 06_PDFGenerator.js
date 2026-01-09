/**
 * PDF Generator Module
 * Creates PDF files from email body content
 */

const PDFGenerator = {
  /**
   * Create PDF from email body content
   * @param {string} requestId - Request tracking ID
   * @param {string} emailBody - Email body HTML/text content
   * @param {string} subject - Email subject for filename
   * @param {string} folderId - Drive folder ID to save PDF
   * @returns {GoogleAppsScript.Drive.File} Created PDF file
   */
  createFromEmailBody: function(requestId, emailBody, subject, folderId) {
    Log.info('Creating PDF from email body', {
      subject: subject,
      folderId: folderId
    });
    
    try {
      // Create a temporary HTML file
      const htmlContent = this._formatEmailAsHTML(emailBody, subject);
      
      // Create blob from HTML
      const blob = Utilities.newBlob(htmlContent, 'text/html', 'email.html');
      
      // Convert to PDF
      const pdfBlob = blob.getAs('application/pdf');
      
      // Generate filename
      const filename = this._generateFilename(subject, new Date());
      
      // Save to Drive
      const file = DriveApp.getFolderById(folderId).createFile(pdfBlob.setName(filename));
      
      Log.info('PDF created successfully', {
        fileId: file.getId(),
        filename: filename
      });
      
      return file;
      
    } catch (error) {
      Log.error('Failed to create PDF from email body', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  
  /**
   * Format email body as HTML for PDF conversion
   * @param {string} emailBody - Raw email body
   * @param {string} subject - Email subject
   * @returns {string} Formatted HTML
   * @private
   */
  _formatEmailAsHTML: function(emailBody, subject) {
    // If email body is already HTML, use it; otherwise convert plain text
    const isHTML = emailBody.includes('<html') || emailBody.includes('<body') || 
                   emailBody.includes('<div') || emailBody.includes('<p>');
    
    let htmlContent = emailBody;
    
    if (!isHTML) {
      // Convert plain text to HTML
      htmlContent = emailBody
        .replace(/\n/g, '<br>')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    
    // Wrap in proper HTML structure
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this._escapeHtml(subject)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    .subject {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #ddd;
    }
    .content {
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="subject">${this._escapeHtml(subject)}</div>
  <div class="content">${htmlContent}</div>
</body>
</html>`;
  },
  
  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   * @private
   */
  _escapeHtml: function(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
  
  /**
   * Generate filename for PDF
   * @param {string} subject - Email subject
   * @param {Date} date - Date for filename
   * @returns {string} Generated filename
   * @private
   */
  _generateFilename: function(subject, date) {
    // Clean subject for filename
    const cleanSubject = subject
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .substring(0, 50)
      .trim()
      .replace(/\s+/g, '_');
    
    const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    
    return `Email_${cleanSubject}_${dateStr}.pdf`;
  }
};
