
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
    - La fecha debe ser la fecha de la factura, no la fecha del email.
    
    EXTRACCIÓN DE IMPORTES:
    - "importeSinIVA": Busca términos como "Base imponible", "Subtotal", "Neto", "Suma (neto)", "Importe base", "Base". Es el importe ANTES de aplicar IVA.
    - "iva": Busca específicamente el IMPORTE del IVA (no el porcentaje). Puede aparecer como:
      * "I.V.A." o "IVA" seguido de un número (ej: "I.V.A. 163,38" o "IVA: 163,38")
      * En una línea de resumen como "I.V.A. 163,38" o "IVA 163,38"
      * En formato tabla con el importe del IVA
      * Busca el VALOR NUMÉRICO del IVA, no el porcentaje (ej: si dice "21% IVA sobre 778,00 = 163,38", el IVA es 163,38)
      * Si aparece "XX% IVA SOBRE YYY" seguido de un importe, ese importe ES el IVA
    - "importeTotal": Busca términos como "Total", "Suma Total", "Total a pagar", "Importe total", "Total factura". Es el importe FINAL incluyendo IVA.
    
    IMPORTANTE PARA IVA:
    - El campo "iva" debe ser el IMPORTE del IVA en euros (ej: 163,38), NO el porcentaje (ej: 21).
    - Si la factura muestra "21% IVA sobre 778,00 = 163,38", entonces iva = 163,38.
    - Si aparece una línea como "I.V.A. 163,38" o "IVA: 163,38", ese es el valor a extraer.
    - Busca en secciones de resumen, totales, o líneas que contengan "IVA" o "I.V.A." seguido de un número.
    
    - Asegúrate de que el JSON sea válido y no incluyas texto adicional fuera del JSON.`
  };
