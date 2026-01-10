
// v1.6 - 2026-01-09: Prompt mejorado, balanceo por mes, validación estricta
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
    
    // Companies that issue invoices (should be rejected, not received)
    EMPRESAS_EMISORAS: [
      'intelectium',
      'ipronics',
      'ipronics program',
      'ipronics programmable',
      'ipronics programmable photonics',
      'ipronics programmable s.l.'
    ],
    
    // Processing Configuration
    MAX_RETRIES: 3,
    RATE_LIMIT_CALLS_PER_MINUTE: 60,
    BATCH_SIZE: 10,
    MAX_THREADS_PER_RUN: 50, // Maximum threads to process per execution (prevents timeout)
    MAX_EXECUTION_TIME_MS: 300000, // 5 minutes max execution time (safety limit)
    MAX_PDF_EXTRACTION_TIME_MS: 10000, // 10 seconds max for PDF text extraction
    MAX_INVOICE_PROCESSING_TIME_MS: 45000, // 45 seconds max per invoice (reduced from 60s to fail even faster)
    MAX_VERTEX_AI_CALL_TIME_MS: 20000, // 20 seconds max for single Vertex AI call (reduced from 30s)
    MAX_RATE_LIMITER_WAIT_MS: 10000, // 10 seconds max wait for rate limiter (reduced from 15s)
    
    // Email Search Date Configuration
    SEARCH_START_DATE: '2025-10-01', // Fecha de inicio (YYYY-MM-DD)
    SEARCH_END_DATE: '2025-12-31', // Fecha final (YYYY-MM-DD). null = hasta hoy
    
    // Feature Flags
    MARK_AS_READ: true,
    LOG_TO_SHEET: false,
    DEBUG_MODE: false,
    
    // Vertex AI Prompt Template
    INVOICE_EXTRACTION_PROMPT: `Eres un extractor experto de datos de facturas. Analiza el contenido y extrae SOLO los datos de factura en formato JSON.

CONTENIDO:
{content}

RESPONDE EN FORMATO JSON:
{
  "esFactura": true/false,
  "proveedor": "string",
  "fechaFactura": "YYYY-MM-DD",
  "numeroFactura": "string",
  "concepto": "string",
  "importeSinIVA": número,
  "iva": número,
  "importeTotal": número
}

REGLAS CRÍTICAS:

1. Si NO es una factura (marketing, confirmaciones, etc.), responde: {"esFactura": false}

2. NÚMERO DE FACTURA (CRÍTICO - DEBE ESTAR):
   Busca: "Nº de factura", "Nº factura", "Factura Nº", "Número factura" seguido de números.
   Ejemplo: Si encuentras "Nº de factura 10983" → "numeroFactura": "10983"
   Si no encuentras el número, usa "" (pero la factura será rechazada si falta).

3. FECHA DE FACTURA (CRÍTICA):
   Busca en la factura misma: "Fecha", "Fecha de emisión", "Fecha factura".
   Convierte formatos: "15/10/2025" → "2025-10-15", "09/09/2025" → "2025-09-09".
   Si solo hay mes/año, usa día 01: "Septiembre 2025" → "2025-09-01".

4. IMPORTES - BUSCAR EN SECCIÓN FINAL DE TOTALES:
   
   IMPORTESINIVA:
   - Busca "Suma:" seguido de número SIN decimales → agrega .00
     Ejemplo: "Suma: 778" → "importeSinIVA": 778.00
   - Busca "Suma" seguido de número: "Suma 778" → 778.00
   - Busca "Base imponible", "Subtotal", "Neto"
   - Convierte comas a puntos: "778,00" → 778.00
   
   IVA:
   - Busca "I.V.A." seguido de número: "I.V.A. 163,38" → "iva": 163.38
   - Busca "IVA" seguido de número: "IVA 163,38" → 163.38
   - Busca el IMPORTE del IVA, NO el porcentaje
   - Convierte comas a puntos: "163,38" → 163.38
   
   IMPORTETOTAL:
   - Busca "Suma Total" seguido de número: "Suma Total 824,68" → "importeTotal": 824.68
   - Busca "Total", "Total a pagar", "Importe total"
   - Convierte comas a puntos: "824,68" → 824.68

EJEMPLO CONCRETO (Factura Carles):
Si encuentras al final de la factura:
  "Nº de factura 10983"
  "Suma: 778"
  "IVA: 163,38"
  "Suma Total: 824,68"

Responde:
{
  "esFactura": true,
  "proveedor": "CARLES LOPEZ GARCIA",
  "fechaFactura": "2025-09-09",
  "numeroFactura": "10983",
  "concepto": "...",
  "importeSinIVA": 778.00,
  "iva": 163.38,
  "importeTotal": 824.68
}

IMPORTANTE:
- Si falta numeroFactura O todos los importes, la factura será rechazada
- Convierte TODAS las comas a puntos en números
- Agrega .00 a números sin decimales
- Responde SOLO JSON, sin texto adicional`
  };
