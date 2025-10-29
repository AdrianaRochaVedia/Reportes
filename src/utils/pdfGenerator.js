const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

class PDFGenerator {
  constructor() {
    this.uploadDir = path.join(__dirname, '../Uploads');
    this.colors = {
      primary: '#6a1b9a',      
      secondary: '#555',
      light: '#f3e5f5',        
      border: '#ce93d8',
      accent: '#ab47bc',
      textDark: '#4a148c'
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

  async generatePDFReport(sacramentos, options = {}, filter = {}) {
    const fields = options.fields || [
      'id_sacramento', 
      'fecha_sacramento', 
      'tipo_sacramento', 
      'foja', 
      'numero', 
      'parroquia',
      'fecha_registro'
    ];
    
    const timestamp = Date.now();
    const fileName = `reporte_sacramentos_${timestamp}.pdf`;
    const filePath = path.join(this.uploadDir, fileName);
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(fs.createWriteStream(filePath));

    let pageNumber = 1;
    this._addPortada(doc);

    doc.addPage();
    this._addHeader(doc);
    this._addFilterInfo(doc, filter, sacramentos.length);
    this._addTable(doc, sacramentos, fields, () => {
      this._addFooter(doc, pageNumber++);
      doc.addPage();
      this._addHeader(doc);
    });

    this._addFooter(doc, pageNumber++);

    // Grafica para ditribucion de sacramentos
    const chartImage = await this._generateChartImage(sacramentos);
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

  async _generateChartImage(sacramentos) {
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

    // Contar sacramentos por tipo
    const tipoCounts = sacramentos.reduce((acc, sac) => {
      const tipo = sac.tipoSacramento?.nombre || 'Sin tipo';
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});

    const data = Object.values(tipoCounts);
    const labels = Object.keys(tipoCounts);
    const total = data.reduce((sum, val) => sum + val, 0);

    const configuration = {
      type: labels.length === 1 ? 'bar' : 'pie',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos',
          data,
          backgroundColor: labels.length === 1 ? ['#ab47bc'] : [
            '#ab47bc', '#42a5f5', '#ffca28', '#ef5350', '#66bb6a', '#26c6da', '#ffa726'
          ]
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Distribución de sacramentos por tipo',
            font: {
              size: 16
            }
          },
          legend: {
            display: labels.length > 1,
            position: 'right'
          },
          datalabels: {
            color: '#fff',
            font: {
              weight: 'bold',
              size: 12
            },
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
    const logoPath = './src/assets/miga-24.png';
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { width: 50 });
    }
    
    doc.fontSize(22).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Reporte de Sacramentos', 100, 40, { align: 'center' });
    doc.fontSize(10).font(this.fonts.italic).fillColor(this.colors.secondary)
      .text(`Generado: ${moment().format('DD/MM/YYYY HH:mm')}`, { align: 'right' });

    const y = Math.max(doc.y + 10, 100);
    doc.strokeColor(this.colors.accent).lineWidth(1)
      .moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
    doc.moveDown(2);
  }

  _addFilterInfo(doc, filter, total) {
    doc.rect(50, doc.y, doc.page.width - 100, 90)
      .fillColor(this.colors.light).fill();
    const startY = doc.y + 10;
    doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Criterios de filtrado:', 60, startY);
    doc.fontSize(10).font(this.fonts.regular).fillColor(this.colors.textDark);

    const filtros = [];
    if (filter.tipo_sacramento_id_tipo) filtros.push(`Tipo de Sacramento: ID ${filter.tipo_sacramento_id_tipo}`);
    if (filter.foja) filtros.push(`Foja: ${filter.foja}`);
    if (filter.numero) filtros.push(`Número: ${filter.numero}`);
    if (filter.institucion_parroquia_id_parroquia) filtros.push(`Parroquia: ID ${filter.institucion_parroquia_id_parroquia}`);
    if (filter.anio_sacramento) filtros.push(`Año: ${filter.anio_sacramento}`);
    if (filter.fecha_sacramento_desde) filtros.push(`Desde: ${moment(filter.fecha_sacramento_desde).format('DD/MM/YYYY')}`);
    if (filter.fecha_sacramento_hasta) filtros.push(`Hasta: ${moment(filter.fecha_sacramento_hasta).format('DD/MM/YYYY')}`);
    if (filter.search) filtros.push(`Búsqueda: ${filter.search}`);
    if (filter.orderBy) {
      const dir = filter.orderDirection === 'ASC' ? 'Ascendente' : 'Descendente';
      filtros.push(`Orden: ${filter.orderBy} (${dir})`);
    }

    if (filtros.length > 0) {
      filtros.forEach((filtro, idx) => {
        if (idx > 0) doc.moveDown(0.3);
        doc.text(`• ${filtro}`, 60, doc.y, { align: 'left' });
      });
    } else {
      doc.text('Sin filtros aplicados', 60, doc.y, { align: 'left' });
    }
    
    doc.moveDown(0.8);
    doc.font(this.fonts.bold).fillColor(this.colors.accent)
      .text(`Total de sacramentos encontrados: ${total}`, 60);
    doc.moveDown(2);
  }

  _addTable(doc, sacramentos, fields, onNewPage) {
    const columnTitles = {
      id_sacramento: 'ID',
      fecha_sacramento: 'Fecha',
      tipo_sacramento: 'Tipo',
      foja: 'Foja',
      numero: 'Nº',
      parroquia: 'Parroquia',
      usuario: 'Registrado por',
      fecha_registro: 'F. Registro'
    };

    const columnWidths = {
      id_sacramento: 35,
      fecha_sacramento: 70,
      tipo_sacramento: 80,
      foja: 45,
      numero: 35,
      parroquia: 100,
      usuario: 90,
      fecha_registro: 70
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

    sacramentos.forEach((sacramento, idx) => {
      let maxLines = 1;
      let needsMultipleLines = false;
      
      fields.forEach((field) => {
        const colWidth = adjustedWidths[field];
        let val = this._getFieldValue(sacramento, field);
        
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
        let val = this._getFieldValue(sacramento, field);
        
        doc.fillColor(this.colors.textDark).text(val, currentX + 3, y + 5, {
          width: colWidth - 6,
          height: rowHeight - 10,
          align: 'left',
          ellipsis: false,
          lineBreak: true
        });
        
        currentX += colWidth;
      });

      y += rowHeight;
    });
  }

  _getFieldValue(sacramento, field) {
    let val = '';
    
    switch(field) {
      case 'id_sacramento':
        val = sacramento.id_sacramento?.toString() || '';
        break;
      case 'fecha_sacramento':
        val = sacramento.fecha_sacramento ? moment(sacramento.fecha_sacramento).format('DD/MM/YYYY') : '';
        break;
      case 'tipo_sacramento':
        val = sacramento.tipoSacramento?.nombre || '';
        break;
      case 'foja':
        val = sacramento.foja || '';
        break;
      case 'numero':
        val = sacramento.numero?.toString() || '';
        break;
      case 'parroquia':
        val = sacramento.parroquia?.nombre || '';
        break;
      case 'usuario':
        if (sacramento.usuario) {
          val = `${sacramento.usuario.nombre || ''} ${sacramento.usuario.apellido_paterno || ''}`.trim();
        }
        break;
      case 'fecha_registro':
        val = sacramento.fecha_registro ? moment(sacramento.fecha_registro).format('DD/MM/YYYY HH:mm') : '';
        break;
      default:
        val = sacramento[field]?.toString() || '';
    }
    
    return val;
  }

  _addFooter(doc, pageNumber) {
    const text = `Sistema de Gestión de Sacramentos | Página ${pageNumber}`;
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