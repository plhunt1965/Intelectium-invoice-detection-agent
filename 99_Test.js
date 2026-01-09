/**
 * Test and Diagnostic Functions
 * Functions for testing and troubleshooting
 */

/**
 * Test all components
 */
function TEST_All() {
  const requestId = Log.init();
  console.log('🧪 Running all tests...\n');
  
  const results = {
    config: TEST_Configuration(),
    gmail: TEST_Gmail_Connection(),
    drive: TEST_Drive_Connection(),
    sheets: TEST_Sheets_Connection(),
    vertexAI: TEST_VertexAI_Connection(),
    storage: TEST_Storage(),
    pdfGenerator: TEST_PDFGenerator()
  };
  
  console.log('\n📊 Test Results:');
  console.log(JSON.stringify(results, null, 2));
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('\n✅ All tests passed!');
  } else {
    console.log('\n❌ Some tests failed. Check configuration.');
  }
  
  return results;
}

/**
 * Test configuration
 */
function TEST_Configuration() {
  console.log('Testing configuration...');
  
  const checks = {
    vertexProjectId: !!CONFIG.VERTEX_AI_PROJECT_ID,
    vertexLocation: !!CONFIG.VERTEX_AI_LOCATION,
    driveFolderId: !!CONFIG.DRIVE_ROOT_FOLDER_ID,
    spreadsheetId: !!CONFIG.SPREADSHEET_ID,
    searchKeywords: CONFIG.SEARCH_KEYWORDS.length > 0,
    emailAccounts: CONFIG.EMAIL_ACCOUNTS.length > 0
  };
  
  const allOk = Object.values(checks).every(v => v === true);
  
  if (allOk) {
    console.log('✅ Configuration OK');
  } else {
    console.log('❌ Configuration issues:');
    Object.keys(checks).forEach(key => {
      if (!checks[key]) {
        console.log(`  - Missing: ${key}`);
      }
    });
  }
  
  return allOk;
}

/**
 * Test Gmail connection
 */
function TEST_Gmail_Connection() {
  console.log('Testing Gmail connection...');
  
  try {
    const threads = GmailApp.getInboxThreads(0, 1);
    console.log('✅ Gmail connection OK');
    return true;
  } catch (error) {
    console.log('❌ Gmail error: ' + error.message);
    return false;
  }
}

/**
 * Test Drive connection
 */
function TEST_Drive_Connection() {
  console.log('Testing Drive connection...');
  
  try {
    if (!CONFIG.DRIVE_ROOT_FOLDER_ID) {
      console.log('⚠️  DRIVE_ROOT_FOLDER_ID not configured');
      return false;
    }
    
    const folder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
    console.log('✅ Drive connection OK - Folder: ' + folder.getName());
    return true;
  } catch (error) {
    console.log('❌ Drive error: ' + error.message);
    return false;
  }
}

/**
 * Test Sheets connection
 */
function TEST_Sheets_Connection() {
  console.log('Testing Sheets connection...');
  
  try {
    if (!CONFIG.SPREADSHEET_ID) {
      console.log('⚠️  SPREADSHEET_ID not configured');
      return false;
    }
    
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log('✅ Sheets connection OK - Spreadsheet: ' + ss.getName());
    return true;
  } catch (error) {
    console.log('❌ Sheets error: ' + error.message);
    return false;
  }
}

/**
 * Test Vertex AI connection
 */
function TEST_VertexAI_Connection() {
  console.log('Testing Vertex AI connection...');
  
  try {
    if (!CONFIG.VERTEX_AI_PROJECT_ID) {
      console.log('⚠️  VERTEX_AI_PROJECT_ID not configured');
      return false;
    }
    
    const requestId = Log.init();
    const testPrompt = 'Respond with: {"status": "ok", "test": true}';
    
    const result = VertexAI.extractInvoiceData(requestId, testPrompt, 1);
    
    if (result && (result.status === 'ok' || result.test === true)) {
      console.log('✅ Vertex AI connection OK');
      return true;
    } else {
      console.log('⚠️  Vertex AI responded but format unexpected');
      return true; // Still consider it working
    }
  } catch (error) {
    console.log('❌ Vertex AI error: ' + error.message);
    return false;
  }
}

/**
 * Test Storage functionality
 */
function TEST_Storage() {
  console.log('Testing Storage...');
  
  try {
    const testKey = 'test_key_' + Date.now();
    const testValue = { test: true, timestamp: new Date().toISOString() };
    
    Storage.set(testKey, testValue);
    const retrieved = Storage.get(testKey);
    
    if (retrieved && retrieved.test === true) {
      // Clean up
      Storage._props.deleteProperty(testKey);
      console.log('✅ Storage OK');
      return true;
    } else {
      console.log('❌ Storage test failed - value mismatch');
      return false;
    }
  } catch (error) {
    console.log('❌ Storage error: ' + error.message);
    return false;
  }
}

/**
 * Test PDF Generator
 */
function TEST_PDFGenerator() {
  console.log('Testing PDF Generator...');
  
  try {
    if (!CONFIG.DRIVE_ROOT_FOLDER_ID) {
      console.log('⚠️  DRIVE_ROOT_FOLDER_ID not configured');
      return false;
    }
    
    const requestId = Log.init();
    const testContent = '<p>Test invoice content</p>';
    const testSubject = 'Test Invoice';
    
    const file = PDFGenerator.createFromEmailBody(
      requestId,
      testContent,
      testSubject,
      CONFIG.DRIVE_ROOT_FOLDER_ID
    );
    
    if (file && file.getId()) {
      // Clean up test file
      try {
        file.setTrashed(true);
      } catch (e) {
        // Ignore cleanup errors
      }
      console.log('✅ PDF Generator OK');
      return true;
    } else {
      console.log('❌ PDF Generator failed - no file created');
      return false;
    }
  } catch (error) {
    console.log('❌ PDF Generator error: ' + error.message);
    return false;
  }
}

/**
 * Diagnostic: Check configuration
 */
function DIAGNOSTIC_CheckConfiguration() {
  console.log('🔍 Configuration Diagnostic\n');
  
  const config = {
    'Vertex AI Project ID': CONFIG.VERTEX_AI_PROJECT_ID || '❌ NOT SET',
    'Vertex AI Location': CONFIG.VERTEX_AI_LOCATION,
    'Drive Root Folder ID': CONFIG.DRIVE_ROOT_FOLDER_ID || '❌ NOT SET',
    'Spreadsheet ID': CONFIG.SPREADSHEET_ID || '❌ NOT SET',
    'Search Keywords': CONFIG.SEARCH_KEYWORDS.join(', '),
    'Priority Label': CONFIG.PRIORITY_LABEL,
    'Email Accounts': CONFIG.EMAIL_ACCOUNTS.join(', '),
    'Max Retries': CONFIG.MAX_RETRIES,
    'Rate Limit': CONFIG.RATE_LIMIT_CALLS_PER_MINUTE + ' calls/min',
    'Mark as Read': CONFIG.MARK_AS_READ ? 'Yes' : 'No',
    'Debug Mode': CONFIG.DEBUG_MODE ? 'Yes' : 'No'
  };
  
  console.log(JSON.stringify(config, null, 2));
  
  return config;
}

/**
 * Diagnostic: Check quotas
 */
function DIAGNOSTIC_CheckQuotas() {
  console.log('📊 Quota Status\n');
  
  const quotas = {
    'UrlFetchApp': 'Check Apps Script dashboard for quota usage',
    'PropertiesService': Storage._props.getKeys().length + ' / 500 keys used',
    'Active Triggers': ScriptApp.getProjectTriggers().length + ' triggers',
    'Processed Emails': Storage.getProcessedEmailIds().length + ' emails',
    'Last Processed': Storage.getLastProcessedTime() || 'Never'
  };
  
  console.log(JSON.stringify(quotas, null, 2));
  
  return quotas;
}

/**
 * Diagnostic: Search test emails
 */
function DIAGNOSTIC_SearchTestEmails() {
  console.log('🔍 Searching for test emails...\n');
  
  const requestId = Log.init();
  
  try {
    const threads = GmailManager.searchInvoiceEmails(requestId, true);
    
    console.log(`Found ${threads.length} invoice threads:\n`);
    
    threads.slice(0, 10).forEach((thread, index) => {
      const messages = thread.getMessages();
      const firstMessage = messages[0];
      
      console.log(`${index + 1}. ${firstMessage.getSubject()}`);
      console.log(`   From: ${firstMessage.getFrom()}`);
      console.log(`   Date: ${firstMessage.getDate()}`);
      console.log(`   Attachments: ${firstMessage.getAttachments().length}`);
      console.log('');
    });
    
    return {
      totalFound: threads.length,
      displayed: Math.min(threads.length, 10)
    };
    
  } catch (error) {
    console.log('❌ Error: ' + error.message);
    return { error: error.message };
  }
}

/**
 * Clear processed emails list (use with caution)
 */
function DIAGNOSTIC_ClearProcessedEmails() {
  console.log('⚠️  Clearing processed emails list...');
  
  const beforeCount = Storage.getProcessedEmailIds().length;
  Storage.clearProcessedEmails();
  const afterCount = Storage.getProcessedEmailIds().length;
  
  console.log(`✅ Processed emails list cleared`);
  console.log(`   Before: ${beforeCount} emails`);
  console.log(`   After: ${afterCount} emails`);
  console.log('⚠️  Emails may be reprocessed on next run');
}

/**
 * Force reprocess all emails in date range (clears processed list first)
 */
function FORCE_REPROCESS_ALL() {
  const requestId = Log.init();
  
  console.log('🔄 Force reprocessing all emails in date range...');
  console.log(`   Date range: ${CONFIG.SEARCH_START_DATE} to ${CONFIG.SEARCH_END_DATE || 'today'}`);
  
  // Clear processed emails
  const beforeCount = Storage.getProcessedEmailIds().length;
  Storage.clearProcessedEmails();
  console.log(`   Cleared ${beforeCount} processed email IDs`);
  
  // Run processing
  console.log('   Starting reprocessing...');
  const results = processInvoiceEmails();
  
  console.log('\n📊 Reprocessing Results:');
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Created: ${results.created}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`   Errors: ${results.errors}`);
  
  return results;
}
