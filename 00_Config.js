
const CONFIG = {
    // Vertex AI Configuration
    VERTEX_AI_PROJECT_ID: 'invoice-detection-agent',
    VERTEX_AI_LOCATION: 'global',
    VERTEX_AI_MODEL: 'gemini-3-flash-preview',
    
    // Google Drive Configuration
    DRIVE_ROOT_FOLDER_ID: '1uc8k59QQTY32cXcxWT7SsZK4PfykwFov',
    
    // Google Sheets Configuration
    SPREADSHEET_ID: '1ORi3ZlPRYDumCljdBMijc07H5-BPdfFISUrVXqfQXU8',
    
    // Gmail Configuration
    SEARCH_KEYWORDS: ['factura', 'facturas', 'invoice', 'invoices', 'ticket', 'tickets', 'recibo', 'recibos'],
    PRIORITY_LABEL: 'Facturas',
    EMAIL_ACCOUNTS: [
      'patricio.hunt@gmail.com',
      'patricio.hunt@intelectium.com'
    ],
    
    // Processing Configuration
    MAX_RETRIES: 3,
    RATE_LIMIT_CALLS_PER_MINUTE: 60,
    BATCH_SIZE: 10,
    MAX_THREADS_PER_RUN: 50, // Maximum threads to process per execution (prevents timeout)
    MAX_EXECUTION_TIME_MS: 300000, // 5 minutes max execution time (safety limit)
    
    // Email Search Date Configuration
    SEARCH_START_DATE: '2025-10-01', // Fecha de inicio (YYYY-MM-DD)
    SEARCH_END_DATE: '2025-10-07', // Fecha final (YYYY-MM-DD). null = hasta hoy
    
    // Feature Flags
    MARK_AS_READ: true,
    LOG_TO_SHEET: false,
    DEBUG_MODE: false,
    
    // Vertex AI Prompt Template
    INVOICE_EXTRACTION_PROMPT: `IMPORTANTE: Solo analiza si el contenido es una FACTURA REAL. Si es un email de marketing, publicidad, confirmación de pago, o cualquier otro tipo de mensaje que NO sea la factura en sí, responde con: {"esFactura": false}
    
    CONTENIDO:
    {content}
    
    INSTRUCCIONES:
    1. Verifica que sea una factura real (debe tener número de factura, importes, fecha, proveedor). Si el email es una confirmación de envío de factura, asume que la factura real está en el PDF adjunto y busca los datos allí.
    2. Si NO es una factura (ej: "marketing", "publicidad", "tickets to", "win tickets"), responde: {"esFactura": false}
    3. Si ES una factura, extrae la información y responde SOLO en formato JSON válido:
    
    {
      "esFactura": true,
      "proveedor": "<nombre del proveedor>",
      "fechaFactura": "<YYYY-MM-DD>",
      "numeroFactura": "<número de factura completo>",
      "concepto": "<descripción del concepto>",
      "importeSinIVA": <número decimal>,
      "iva": <número decimal>,
      "importeTotal": <número decimal>
    }
    
    REGLAS:
    - Si algún campo no se puede determinar, usa null para valores numéricos y "" para strings.
    - El número de factura es CRÍTICO - debe estar presente en la factura. Si no se encuentra, intenta inferirlo o déjalo en "".
    - La fecha de factura (fechaFactura) es CRÍTICA - DEBE ser la fecha que aparece en la factura misma, NO la fecha del email. Busca campos como "Fecha", "Fecha de emisión", "Fecha factura", "Date", "Fecha de facturación". El formato DEBE ser YYYY-MM-DD (ejemplo: 2025-10-15). Si la factura muestra "15/10/2025" o "15-10-2025", conviértela a "2025-10-15". Si la factura muestra solo mes y año, usa el día 01 (ejemplo: "Octubre 2025" → "2025-10-01").
    - Para "importeSinIVA", busca términos como "Base imponible", "Subtotal", "Neto", "Suma (neto)", "Importe base", "Base". Es el importe ANTES de aplicar IVA.
    - Para "iva", busca el IMPORTE del IVA (no el porcentaje). Puede aparecer como "I.V.A.", "IVA", "I.V.A.:", "IVA:" seguido de un número. Si aparece "XX% IVA SOBRE YYY = ZZZ", entonces el IVA es ZZZ. Busca en líneas de resumen o totales.
    - Para "importeTotal", busca términos como "Total", "Suma Total", "Total a pagar", "Importe total", "Total factura". Es el importe FINAL incluyendo IVA.
    - Asegúrate de que el JSON sea válido y no incluyas texto adicional fuera del JSON.`
  };
