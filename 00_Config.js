
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
    SEARCH_END_DATE: '2025-12-31', // Fecha final (YYYY-MM-DD). null = hasta hoy
    
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
    - El número de factura es CRÍTICO - debe estar presente en la factura. Busca específicamente:
      * "Nº de factura" seguido de números (ej: "Nº de factura 10983" → numeroFactura es "10983")
      * "N° factura", "Nº factura", "Factura N°", "Número factura" seguido de números
      * "Factura nº" o "Factura Nº" seguido de números
      * Si encuentras "Nº de factura 10983", extrae "10983" (solo el número, sin espacios ni texto adicional)
      * Si no se encuentra, intenta inferirlo o déjalo en ""
    - La fecha de factura (fechaFactura) es CRÍTICA - DEBE ser la fecha que aparece en la factura misma, NO la fecha del email. Busca campos como "Fecha", "Fecha de emisión", "Fecha factura", "Date", "Fecha de facturación". El formato DEBE ser YYYY-MM-DD (ejemplo: 2025-10-15). Si la factura muestra "15/10/2025" o "15-10-2025", conviértela a "2025-10-15". Si la factura muestra "30/09/2025", conviértela a "2025-09-30". Si la factura muestra solo mes y año, usa el día 01 (ejemplo: "Octubre 2025" → "2025-10-01").
    - CRÍTICO: Busca SIEMPRE en la SECCIÓN DE RESUMEN/TOTALES al final de la factura (después de la tabla de líneas de detalle). Esta sección suele estar separada por una línea y contiene los importes finales. LEE TODO EL CONTENIDO DEL PDF COMPLETO, especialmente las últimas líneas donde están los totales.
    - Para "importeSinIVA", busca en la sección de resumen/totales al final. Busca específicamente:
      * "Suma:" seguido de un número (ej: "Suma: 778" → importeSinIVA es 778.00)
      * "Suma" seguido de un número (ej: "Suma 778" → importeSinIVA es 778.00)
      * "Suma (neto)" seguido de un número (ej: "Suma (neto) 778,00" → importeSinIVA es 778.00)
      * También busca "Base imponible", "Subtotal", "Neto", "Importe base", "Base"
      * Es el importe ANTES de aplicar IVA
      * IMPORTANTE: Si encuentras "Suma: 778" (sin decimales), conviértelo a 778.00 en el JSON
      * Si encuentras "778,00" (con coma), conviértelo a 778.00 (con punto)
      * Si encuentras "778.00" (con punto), úsalo tal cual
    - Para "iva", busca en la sección de resumen/totales al final. Busca específicamente:
      * "I.V.A." seguido de un número (ej: "I.V.A. 163,38" → iva es 163.38)
      * "I.V.A" seguido de un número (sin punto final)
      * "IVA" seguido de un número (ej: "IVA 163,38" → iva es 163.38)
      * "I.V.A.:" o "IVA:" seguido de un número
      * Si aparece "XX% IVA SOBRE YYY = ZZZ", entonces el IVA es ZZZ (convierte la coma a punto)
      * IMPORTANTE: Busca el IMPORTE del IVA (no el porcentaje). Si encuentras "163,38", conviértelo a 163.38
    - Para "importeTotal", busca en la sección de resumen/totales al final. Busca específicamente:
      * "Suma Total" seguido de un número (ej: "Suma Total 824,68" → importeTotal es 824.68)
      * "Total" seguido de un número
      * "Total a pagar", "Importe total", "Total factura"
      * Es el importe FINAL incluyendo IVA
      * Si encuentras "824,68", conviértelo a 824.68
    - FORMATO DE NÚMEROS - REGLAS CRÍTICAS:
      * Si encuentras números SIN decimales (ej: "Suma: 778"), agrega .00 → 778.00
      * Si encuentras números con comas como separador decimal (ej: 778,00, 163,38, 824,68), CONVIÉRTELOS a formato con punto (778.00, 163.38, 824.68)
      * Si encuentras números con puntos como separador decimal (ej: 778.00), úsalos tal cual
      * NUNCA dejes un número sin formato decimal en el JSON (siempre debe tener .00 o .XX)
    - Asegúrate de que el JSON sea válido y no incluyas texto adicional fuera del JSON.`
  };
