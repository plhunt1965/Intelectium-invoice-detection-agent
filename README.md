# Invoice Detection Agent

Sistema automatizado de Google Apps Script para detectar, procesar y registrar facturas desde Gmail usando Vertex AI.

## ✅ Versión Estable (v1.1 - 2026-01-09)

**Esta versión está marcada como estable y funcional.**

### Características verificadas:
- ✅ Extracción de texto de PDFs funcionando correctamente
- ✅ Registro de datos en Google Sheets con valores correctos
- ✅ Drive API configurada y funcionando
- ✅ Validación previa antes de crear PDFs (evita crear PDFs de emails no facturas)
- ✅ Detección y rechazo de facturas emitidas por Intelectium/Ipronics
- ✅ Rechazo de emails de marketing y confirmaciones
- ✅ Limpieza automática de PDFs rechazados
- ✅ Verificación temprana de Ipronics en nombres de archivos
- ✅ Optimizaciones de velocidad para alto volumen (1000+ emails)
- ✅ Timeout explícito en llamadas a Vertex AI (30s)
- ✅ Rate limiter corregido (sin cuelgues)

### Cambios importantes en esta versión:
- **Fix crítico**: Rate limiter corregido para evitar loops infinitos y cuelgues
- **Validación previa**: Los emails sin adjuntos se validan ANTES de crear el PDF, evitando crear archivos innecesarios
- **Limpieza automática**: PDFs rechazados por el AI se eliminan automáticamente
- **Verificación temprana**: Rechazo de Ipronics antes de descargar PDFs (verifica nombre del archivo)
- **Optimizaciones de velocidad**: Rate limiter optimizado, backoff reducido, timeouts explícitos
- **Alto volumen**: Configurado para procesar hasta 1000 emails en múltiples ejecuciones (100 por ejecución)
- **Drive API**: Servicio avanzado configurado correctamente en `appsscript.json`

## 📋 Características

- 🔍 **Detección automática** de emails con facturas por palabras clave
- 📎 **Procesamiento de adjuntos** PDF o creación de PDF desde cuerpo del email
- 🤖 **Extracción inteligente** de datos usando Vertex AI (Gemini)
- 📁 **Organización automática** en Drive por mes (YYYY-MM/)
- 📊 **Registro en Google Sheets** con todos los datos extraídos
- 🔄 **Prevención de duplicados** mediante tracking de emails procesados
- ⚡ **Rate limiting** y reintentos con exponential backoff

## 🏗️ Estructura del Proyecto

```
Invoice-Detection-Agent/
├── 00_Config.js         # Configuración y constantes
├── 01_Main.js           # Entry points y orquestación
├── 02_Gmail.js          # Búsqueda y procesamiento de emails
├── 03_VertexAI.js       # Extracción de datos con IA
├── 04_Drive.js          # Gestión de carpetas y archivos
├── 05_Sheets.js         # Registro en spreadsheet
├── 06_PDFGenerator.js   # Crear PDF desde email body
├── 07_Storage.js        # Control de emails procesados
├── 08_Logging.js        # Logging estructurado
├── 99_Test.js           # Funciones de test y diagnóstico
└── appsscript.json      # Configuración del proyecto
```

## 🚀 Configuración Inicial

### 1. Crear Proyecto en Google Apps Script

1. Ve a [script.google.com](https://script.google.com)
2. Crea un nuevo proyecto
3. Nombra el proyecto "Invoice-Detection-Agent"

### 2. Subir Archivos

Sube todos los archivos `.js` y `appsscript.json` al proyecto.

### 3. Configurar Variables en `00_Config.js`

Edita `00_Config.js` y configura las siguientes variables:

```javascript
const CONFIG = {
  // Vertex AI - Obtén estos valores de Google Cloud Console
  VERTEX_AI_PROJECT_ID: 'tu-proyecto-gcp',
  VERTEX_AI_LOCATION: 'us-central1', // o tu región preferida
  
  // Google Drive - Crea una carpeta y copia su ID
  DRIVE_ROOT_FOLDER_ID: '1ABC...XYZ', // ID de la carpeta raíz
  
  // Google Sheets - Crea un spreadsheet y copia su ID
  SPREADSHEET_ID: '1ABC...XYZ', // ID del spreadsheet
  
  // Gmail - Ya configurado, pero puedes ajustar
  SEARCH_KEYWORDS: ['factura', 'facturas', 'invoice', 'invoices', 'ticket', 'tickets'],
  PRIORITY_LABEL: 'Facturas', // Etiqueta de Gmail (opcional)
  EMAIL_ACCOUNTS: [
    'patricio.hunt@gmail.com',
    'patricio.hunt@intelectium.com'
  ]
};
```

### 4. Habilitar APIs Necesarias

#### Vertex AI API
1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Selecciona tu proyecto
3. Habilita la API "Vertex AI API"
4. Asegúrate de tener permisos de facturación habilitados

#### OAuth Scopes
Los scopes necesarios ya están configurados en `appsscript.json`. La primera vez que ejecutes el script, Google pedirá autorización.

### 5. Crear Carpeta en Drive

1. Crea una carpeta en Google Drive para almacenar las facturas
2. Copia el ID de la carpeta (visible en la URL)
3. Pega el ID en `DRIVE_ROOT_FOLDER_ID`

### 6. Crear Spreadsheet

1. Crea un nuevo Google Sheet
2. Copia el ID del spreadsheet (visible en la URL)
3. Pega el ID en `SPREADSHEET_ID`
4. El script creará automáticamente la hoja "Facturas" con los headers

## 🧪 Testing

### Ejecutar Tests

1. Abre el editor de Apps Script
2. Selecciona la función `TEST_All` en el menú desplegable
3. Haz clic en "Ejecutar"
4. Revisa los resultados en el log

### Funciones de Diagnóstico

- `DIAGNOSTIC_CheckConfiguration()` - Verifica la configuración
- `DIAGNOSTIC_CheckQuotas()` - Muestra uso de cuotas
- `DIAGNOSTIC_SearchTestEmails()` - Busca emails de prueba

## 📝 Uso

### Ejecución Manual

1. En el editor de Apps Script, selecciona `processInvoiceEmails`
2. Haz clic en "Ejecutar"
3. Revisa los logs para ver el progreso

### Ejecución Automática (Trigger)

1. Ejecuta la función `setupTrigger()` una vez
2. El script procesará emails automáticamente cada 6 horas

### Desde Google Sheets

1. Abre tu spreadsheet de facturas
2. Verás un menú "Invoice Detection" en la barra superior
3. Selecciona "Process Invoices" para ejecutar manualmente

## 📊 Datos Extraídos

El sistema extrae automáticamente:

- **Proveedor**: Nombre del proveedor/empresa
- **Fecha de Factura**: Fecha en formato YYYY-MM-DD
- **Nº Factura**: Número de factura
- **Concepto**: Descripción del concepto
- **Importe sin IVA**: Monto sin impuestos
- **IVA**: Monto de IVA
- **Importe Total**: Monto total de la factura

## 📁 Organización de Archivos

Las facturas se organizan automáticamente en Drive:

```
Carpeta Raíz/
├── 2024-01/
│   ├── Proveedor1_Nº123_2024-01-15.pdf
│   └── Proveedor2_Nº456_2024-01-20.pdf
├── 2024-02/
│   └── Proveedor3_Nº789_2024-02-10.pdf
└── ...
```

## 🔧 Personalización

### Cambiar Frecuencia del Trigger

Edita `setupTrigger()` en `01_Main.js`:

```javascript
// Cada 6 horas
ScriptApp.newTrigger('processInvoiceEmails')
  .timeBased()
  .everyHours(6)
  .create();

// Cada día a las 7 AM
ScriptApp.newTrigger('processInvoiceEmails')
  .timeBased()
  .atHour(7)
  .everyDays(1)
  .create();
```

### Ajustar Rate Limiting

En `00_Config.js`:

```javascript
RATE_LIMIT_CALLS_PER_MINUTE: 60, // Ajusta según tus límites
```

### Modificar Prompt de Vertex AI

Edita `INVOICE_EXTRACTION_PROMPT` en `00_Config.js` para ajustar cómo se extraen los datos.

## 🐛 Troubleshooting

### Error: "Vertex AI API error: 403"
- Verifica que Vertex AI API esté habilitada
- Verifica que el PROJECT_ID sea correcto
- Verifica permisos de facturación en GCP

### Error: "Drive folder not found"
- Verifica que `DRIVE_ROOT_FOLDER_ID` sea correcto
- Verifica que tengas acceso a la carpeta

### Error: "Spreadsheet not found"
- Verifica que `SPREADSHEET_ID` sea correcto
- Verifica que tengas acceso al spreadsheet

### Emails no se procesan
- Verifica que los emails coincidan con las palabras clave
- Revisa los logs con `Log.debug()` habilitado
- Ejecuta `DIAGNOSTIC_SearchTestEmails()` para ver qué emails encuentra

## 📚 Estándares del Proyecto

Este proyecto sigue los estándares de Google Apps Script definidos en las reglas del proyecto:

- ✅ Logging estructurado con request ID
- ✅ Manejo de errores con reintentos
- ✅ Rate limiting para APIs externas
- ✅ Prevención de duplicados
- ✅ Código modular y mantenible
- ✅ Documentación JSDoc

## 📄 Licencia

Proyecto interno de Intelectium.
