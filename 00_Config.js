
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
    MAX_RETRIES: 2, // Reduced from 3 to speed up processing (fail fast)
    RATE_LIMIT_CALLS_PER_MINUTE: 60,
    BATCH_SIZE: 20, // Increased from 10 for better throughput
    MAX_THREADS_PER_RUN: 100, // Increased from 50 - will process in multiple runs for 1000 emails
    MAX_EXECUTION_TIME_MS: 330000, // 5.5 minutes (closer to 6 min GAS limit, but with safety margin)
    
    // Email Search Date Configuration
    SEARCH_START_DATE: '2025-10-01', // Fecha de inicio (YYYY-MM-DD)
    SEARCH_END_DATE: '2025-10-07', // Fecha final (YYYY-MM-DD). null = hasta hoy
    
    // Feature Flags
    MARK_AS_READ: true,
    LOG_TO_SHEET: false,
    DEBUG_MODE: false,
    
    // Vertex AI Prompt Template
    INVOICE_EXTRACTION_PROMPT: `IMPORTANTE: Solo analiza si el contenido es una FACTURA REAL RECIBIDA. 

CONTENIDO:
{content}

INSTRUCCIONES:
1. Si es SOLO un email de confirmación, marketing, publicidad, o notificación SIN la factura (ej: "confirmación de pago", "recibirás tu factura", "ahorra con tu factura", "ya tienes disponible tu factura"), responde: {"esFactura": false}

2. Si la factura es EMITIDA POR INTELECTIUM o IPRONICS hacia un cliente (no recibida), responde: {"esFactura": false}

3. Si ES una factura RECIBIDA (de un proveedor hacia Intelectium), extrae TODA la información:

{
  "esFactura": true,
  "proveedor": "<nombre completo del proveedor que emite la factura>",
  "fechaFactura": "<YYYY-MM-DD - fecha de la factura, no del email>",
  "numeroFactura": "<número completo de factura>",
  "concepto": "<descripción del servicio/producto facturado>",
  "importeSinIVA": <número decimal sin comas, ej: 100.50>,
  "iva": <número decimal sin comas, ej: 21.00>,
  "importeTotal": <número decimal sin comas, ej: 121.50>
}

EXTRACCIÓN DE IMPORTES (CRÍTICO - LEE TODO EL PDF):
- Busca en TODO el contenido del PDF, línea por línea, incluyendo tablas y listados
- "importeSinIVA": busca términos como "Base imponible", "Subtotal", "Sin IVA", "Neto", "Base", "Importe base", "Base imponible", "Importe", "Precio", "Cuota", "Honorarios"
- "iva": busca "IVA", "Impuesto", "Tax", "21%", "10%", "4%", o calcula si ves un porcentaje aplicado
- "importeTotal": busca "Total", "Total a pagar", "Importe total", "Total factura", "Total a ingresar", "Total documento", "TOTAL"
- IMPORTANTE: Si ves números con formato de moneda (€, EUR, euros) o separadores (1.234,56 o 1,234.56), conviértelos a número decimal (1234.56)
- Si hay múltiples líneas con importes, usa los TOTALES (no subtotales parciales)
- Si encuentras los importes, EXTRAE LOS NÚMEROS REALES EXACTOS, nunca uses 0 a menos que realmente sea 0

EJEMPLOS DE BÚSQUEDA:
- Si ves "Base imponible: 1.200,00 €" → importeSinIVA: 1200.00
- Si ves "IVA (21%): 252,00 €" → iva: 252.00
- Si ves "Total: 1.452,00 €" → importeTotal: 1452.00
- Si ves "Cuota fija: 150,00" → importeTotal: 150.00 (y calcula IVA si aplica)

REGLAS:
- Si algún campo numérico NO se encuentra después de buscar exhaustivamente, usa null (nunca 0)
- Si algún campo de texto no se encuentra, usa ""
- Fecha SIEMPRE formato YYYY-MM-DD
- Números con punto decimal, sin comas (ej: 121.50, no 121,50)
- JSON válido sin texto adicional fuera del JSON`
  };
