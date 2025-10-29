const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

class PDFGenerator {
  constructor() {
    this.uploadDir = path.join(__dirname, '../Uploads');
    this.colors = {
      primary: '#2e7d32',
      secondary: '#555',
      light: '#f1f8e9',
      border: '#c8e6c9',
      accent: '#66bb6a',
      textDark: '#1b5e20'
    };
    this.fonts = {
      regular: 'Helvetica',
      bold: 'Helvetica-Bold',
      italic: 'Helvetica-Oblique'
    };
    this.fileRetentionTime = 3600000;
    this.cleanupInterval = 24 * 60 * 60 * 1000;
    this._initializeUploadDirectory();
    this._startCleanupScheduler();
  }

  _initializeUploadDirectory() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async generatePDFReport(documentos, options = {}, filter = {}) {
    const fields = options.fields || ['id_documento', 'nombre', 'tipo', 'fuente_origen', 'anio_publicacion', 'aplicacion', 'vistas'];
    const timestamp = Date.now();
    const fileName = `reporte_documentos_${timestamp}.pdf`;
    const filePath = path.join(this.uploadDir, fileName);
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(fs.createWriteStream(filePath));

    let pageNumber = 1;
    this._addPortada(doc);

    doc.addPage();
    this._addHeader(doc);
    this._addFilterInfo(doc, filter, documentos.length);
    this._addTable(doc, documentos, fields, () => {
      this._addFooter(doc, pageNumber++);
      doc.addPage();
      this._addHeader(doc);
    });

    this._addFooter(doc, pageNumber++);

    const chartImage = await this._generateChartImage(documentos);
    doc.addPage();
    this._addHeader(doc);
    const chartWidth = 500;
    const chartHeight = 280;
    const x = (doc.page.width - chartWidth) / 2;
    const y = 130;
    doc.image(chartImage, x, y, {
      width: chartWidth,
      height: chartHeight
    });
    this._addFooter(doc, pageNumber++);

    doc.end();
    return this._createFileInfoPromise(fileName, filePath);
  }

  async _generateChartImage(documentos) {
    const width = 600;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      chartCallback: (ChartJS) => {
        const ChartDataLabels = require('chartjs-plugin-datalabels');
        ChartJS.register(ChartDataLabels);
      }
    });

    const yearCounts = documentos.reduce((acc, doc) => {
      const year = new Date(doc.anio_publicacion).getFullYear() || 'Desconocido';
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {});

    const data = Object.values(yearCounts);
    const labels = Object.keys(yearCounts);
    const total = data.reduce((sum, val) => sum + val, 0);

    const configuration = {
      type: labels.length === 1 ? 'bar' : 'pie',
      data: {
        labels,
        datasets: [{
          label: 'Documentos',
          data,
          backgroundColor: labels.length === 1 ? ['#66bb6a'] : [
            '#66bb6a', '#42a5f5', '#ffca28', '#ef5350', '#ab47bc', '#26c6da', '#ffa726'
          ]
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Distribución de documentos por año'
          },
          legend: {
            display: labels.length > 1,
            position: 'right'
          },
          datalabels: {
            color: '#fff',
            formatter: (value) => {
              const porcentaje = ((value / total) * 100).toFixed(1);
              return `${porcentaje}%`;
            }
          }
        },
        scales: labels.length === 1 ? {
          y: {
            beginAtZero: true,
            max: Math.max(...data) + 1
          }
        } : {}
      },
      plugins: ['chartjs-plugin-datalabels']
    };

    return await chartJSNodeCanvas.renderToBuffer(configuration);
  }

  _addPortada(doc) {
    const portadaPath = path.join(__dirname, '../assets/portada.png');
    if (fs.existsSync(portadaPath)) {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.image(portadaPath, 0, 0, {
        width: doc.page.width,
        height: doc.page.height
      });
    }
  }

  _addHeader(doc) {
    doc.image('./src/assets/miga-24.png', 50, 30, { width: 50 });
    doc.fontSize(22).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Reporte de Documentos', 100, 40, { align: 'center' });
    doc.fontSize(10).font(this.fonts.italic).fillColor(this.colors.secondary)
      .text(`Generado: ${moment().format('DD/MM/YYYY HH:mm')}`, { align: 'right' });

    const y = Math.max(doc.y + 10, 100);
    doc.strokeColor(this.colors.accent).lineWidth(1)
      .moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
    doc.moveDown(2);
  }

  _addFilterInfo(doc, filter, total) {
    doc.rect(50, doc.y, doc.page.width - 100, 70)
      .fillColor(this.colors.light).fill();
    const startY = doc.y + 10;
    doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Criterios de filtrado:', 60, startY);
    doc.fontSize(10).font(this.fonts.regular).fillColor(this.colors.textDark);

    const filtros = [];
    if (filter.tipo) filtros.push(`Tipo: ${filter.tipo}`);
    if (filter.anio) filtros.push(`Año: ${filter.anio}`);
    if (filter.orderBy) {
      const dir = filter.orderDirection === 'ASC' ? 'Ascendente' : 'Descendente';
      filtros.push(`Orden: ${filter.orderBy} (${dir})`);
    }

    doc.text(filtros.length ? filtros.join(' | ') : 'Sin filtros aplicados', { align: 'left' });
    doc.moveDown(0.5);
    doc.font(this.fonts.bold).fillColor(this.colors.accent)
      .text(`Total de documentos encontrados: ${total}`);
    doc.moveDown(2);
  }

  _addTable(doc, documentos, fields, onNewPage) {
    const columnTitles = {
      id_documento: 'ID',
      nombre: 'Nombre',
      tipo: 'Tipo',
      fuente_origen: 'Fuente',
      anio_publicacion: 'Año',
      aplicacion: 'Aplicación',
      vistas: 'Vistas'
    };

    const columnWidths = {
      id_documento: 40,      
      nombre: 100,           
      tipo: 65,             
      fuente_origen: 100,    
      anio_publicacion: 30, 
      aplicacion: 60,       
      vistas: 40           
    };

    const startX = 50;
    const baseRowHeight = 20;
    let y = doc.y;
    const footerHeight = 50;

    const totalUsedWidth = fields.reduce((sum, field) => sum + (columnWidths[field] || 70), 0);
    const availableWidth = doc.page.width - 100;

    let adjustmentFactor = 1;
    if (totalUsedWidth < availableWidth) {
      adjustmentFactor = availableWidth / totalUsedWidth;
    }

    const adjustedWidths = {};
    fields.forEach(field => {
      adjustedWidths[field] = (columnWidths[field] || 70) * adjustmentFactor;
    });

    const drawHeader = () => {
      let currentX = startX;
      doc.rect(startX, y, availableWidth, baseRowHeight)
        .fillColor(this.colors.primary).fill();
      
      doc.font(this.fonts.bold).fontSize(10).fillColor('white');
      
      fields.forEach((field) => {
        const colWidth = adjustedWidths[field];
        doc.text(columnTitles[field] || field, currentX + 3, y + 5, {
          width: colWidth - 6,
          ellipsis: true
        });
        currentX += colWidth;
      });
      
      y += baseRowHeight;
    };

    drawHeader();
    doc.font(this.fonts.regular).fontSize(9).fillColor(this.colors.textDark);

    documentos.forEach((d, idx) => {
      let maxLines = 1;
      let needsMultipleLines = false;
      
      fields.forEach((field) => {
        const colWidth = adjustedWidths[field];
        let val = d[field] != null ? d[field].toString() : '';
        
        if (field === 'anio_publicacion') {
          const date = new Date(val);
          if (!isNaN(date)) val = date.getUTCFullYear().toString();
        }
        
        const availableTextWidth = colWidth - 6;
        const words = val.split(' ');
        let currentLine = '';
        let lines = 1;
        
        for (let word of words) {
          const testLine = currentLine + (currentLine ? ' ' : '') + word;
          const testWidth = doc.widthOfString(testLine);
          
          if (testWidth > availableTextWidth && currentLine !== '') {
            lines++;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (lines > 1) {
          needsMultipleLines = true;
          maxLines = Math.max(maxLines, lines);
        }
      });
      
      const rowHeight = needsMultipleLines ? 
        Math.max(baseRowHeight, maxLines * 12 + 8) : 
        baseRowHeight;
      
      if (y + rowHeight + footerHeight > doc.page.height) {
        onNewPage();
        y = doc.y;
        drawHeader();
      }

      if (idx % 2 === 0) {
        doc.rect(startX, y, availableWidth, rowHeight)
          .fillColor(this.colors.light).fill();
      }

      let currentX = startX;
      fields.forEach((field) => {
        const colWidth = adjustedWidths[field];
        let val = d[field] != null ? d[field].toString() : '';
        if (field === 'anio_publicacion') {
          const date = new Date(val);
          if (!isNaN(date)) val = date.getUTCFullYear().toString();
        }
        let align = 'left';
        
        doc.fillColor(this.colors.textDark).text(val, currentX + 3, y + 5, {
          width: colWidth - 6,
          height: rowHeight - 10,
          align: align,
          ellipsis: false,
          lineBreak: true
        });
        
        currentX += colWidth;
      });

      y += rowHeight;
    });
  }

  _addFooter(doc, pageNumber) {
    const text = `Sistema de Gestión Documental | Página ${pageNumber}`;
    const fontSize = 8;
    const y = doc.page.height - 30;

    doc.save();

    doc.strokeColor(this.colors.primary)
      .lineWidth(1)
      .moveTo(50, y - 10)
      .lineTo(doc.page.width - 50, y - 10)
      .stroke();

    doc.font(this.fonts.italic)
      .fontSize(fontSize)
      .fillColor(this.colors.secondary);

    const textWidth = doc.widthOfString(text);
    const x = (doc.page.width - textWidth) / 2;

    doc.text(text, x, y, {
      lineBreak: false
    });

    doc.restore();
  }

  _createFileInfoPromise(fileName, filePath) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('error', err => reject(err));
      stream.on('open', () => {
        setTimeout(() => fs.unlink(filePath, () => {}), this.fileRetentionTime);
        resolve({ fileName, filePath, downloadUrl: `/download/${fileName}` });
      });
    });
  }

  _startCleanupScheduler() {
    this._cleanupOldFiles();
    setInterval(() => this._cleanupOldFiles(), this.cleanupInterval);
  }

  _cleanupOldFiles() {
    if (!fs.existsSync(this.uploadDir)) return;
    const now = Date.now();
    fs.readdirSync(this.uploadDir).forEach(file => {
      const filePath = path.join(this.uploadDir, file);
      if (fs.statSync(filePath).mtimeMs < now - this.cleanupInterval) {
        fs.unlinkSync(filePath);
      }
    });
  }
}

module.exports = new PDFGenerator();
