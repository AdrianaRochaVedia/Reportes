const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

class PDFGenerator {
  constructor() {
    this.uploadDir = path.join(__dirname, '../Uploads');
    this.colors = {
      primary: '#1565C0',     
      secondary: '#424242',    
      light: '#E3F2FD',        
      border: '#1976D2',       
      accent: '#2196F3',      
      textDark: '#0D47A1'      
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

  async generatePDFReport(sacramentos, options = {}, filter = {}, estadisticas = null) {
    const fields = options.fields || [
      'id_sacramento', 
      'fecha_sacramento', 
      'tipo_sacramento', 
      'foja', 
      'numero', 
      'parroquia',
      'activo',
      'fecha_registro'
    ];
    
    const timestamp = Date.now();
    const fileName = `reporte_sacramentos_${timestamp}.pdf`;
    const filePath = path.join(this.uploadDir, fileName);
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.pipe(fs.createWriteStream(filePath));

    let pageNumber = 1;
    
    // Portada
    this._addPortada(doc);

    // Página de información general
    doc.addPage();
    this._addHeader(doc, options.titulo);
    this._addFilterInfo(doc, filter, sacramentos.length);
    
    
    if (options.incluirEstadisticas && estadisticas) {
      this._addEstadisticasResumen(doc, estadisticas);
    }
    
    this._addFooter(doc, pageNumber++);

    // Tabla de datos
    doc.addPage();
    this._addHeader(doc, options.titulo);
    this._addTable(doc, sacramentos, fields, () => {
      this._addFooter(doc, pageNumber++);
      doc.addPage();
      this._addHeader(doc, options.titulo);
    });
    this._addFooter(doc, pageNumber++);

    // Gráfica de distribución por tipo
    try {
      const chartImageTipo = await this._generateChartByType(sacramentos);
      doc.addPage();
      this._addHeader(doc, options.titulo);
      doc.moveDown(1);
      doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
        .text('Distribución por Tipo de Sacramento', 50);
      doc.moveDown(1.5);
      this._addChartToPage(doc, chartImageTipo);
      this._addFooter(doc, pageNumber++);
    } catch (err) {
      console.error('Error generando gráfica de tipos:', err.message);
    }

  
    if (options.incluirEstadisticas && estadisticas) {
      // Gráfica por parroquia
      if (estadisticas.por_parroquia && estadisticas.por_parroquia.length > 1) {
        try {
          const chartImageParroquia = await this._generateChartByParroquia(estadisticas.por_parroquia);
          doc.addPage();
          this._addHeader(doc, options.titulo);
          doc.moveDown(1);
          doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
            .text('Distribución por Parroquia', 50);
          doc.moveDown(1.5);
          this._addChartToPage(doc, chartImageParroquia);
          this._addFooter(doc, pageNumber++);
        } catch (err) {
          console.error('Error generando gráfica de parroquias:', err.message);
        }
      }

      // Gráfica por meses
      if (estadisticas.por_mes && estadisticas.por_mes.length > 1) {
        try {
          const chartImageMes = await this._generateChartByMonth(estadisticas.por_mes);
          doc.addPage();
          this._addHeader(doc, options.titulo);
          doc.moveDown(1);
          doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
            .text('Distribución Temporal (por mes)', 50);
          doc.moveDown(1.5);
          this._addChartToPage(doc, chartImageMes);
          this._addFooter(doc, pageNumber++);
        } catch (err) {
          console.error('Error generando gráfica de meses:', err.message);
        }
      }
    }

    doc.end();
    return this._createFileInfoPromise(fileName, filePath);
  }

  _addEstadisticasResumen(doc, estadisticas) {
    doc.moveDown(1);
    doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Resumen Estadístico', 50);
    doc.moveDown(0.5);

    const boxY = doc.y;
    const boxHeight = 120;
    doc.rect(50, boxY, doc.page.width - 100, boxHeight)
      .fillColor(this.colors.light).fill();

    doc.fontSize(11).font(this.fonts.regular).fillColor(this.colors.textDark);
    
    let currentY = boxY + 15;
    const leftCol = 70;
    const rightCol = 320;

    doc.font(this.fonts.bold).text('Total de sacramentos:', leftCol, currentY);
    doc.font(this.fonts.regular).text(estadisticas.total?.toString() || '0', leftCol + 150, currentY);
    
    currentY += 20;
    doc.font(this.fonts.bold).text('Sacramentos activos:', leftCol, currentY);
    doc.font(this.fonts.regular).fillColor('#66bb6a')
      .text(estadisticas.activos?.toString() || '0', leftCol + 150, currentY);
    
    currentY += 20;
    doc.font(this.fonts.regular).fillColor(this.colors.textDark);
    doc.font(this.fonts.bold).text('Sacramentos inactivos:', leftCol, currentY);
    doc.font(this.fonts.regular).fillColor('#ef5350')
      .text(estadisticas.inactivos?.toString() || '0', leftCol + 150, currentY);

    currentY = boxY + 15;
    doc.fillColor(this.colors.textDark);
    doc.font(this.fonts.bold).text('Tipos diferentes:', rightCol, currentY);
    doc.font(this.fonts.regular).text(estadisticas.por_tipo?.length?.toString() || '0', rightCol + 150, currentY);
    
    currentY += 20;
    doc.font(this.fonts.bold).text('Parroquias:', rightCol, currentY);
    doc.font(this.fonts.regular).text(estadisticas.por_parroquia?.length?.toString() || '0', rightCol + 150, currentY);
    
    currentY += 20;
    doc.font(this.fonts.bold).text('Usuarios registradores:', rightCol, currentY);
    doc.font(this.fonts.regular).text(estadisticas.por_usuario?.length?.toString() || '0', rightCol + 150, currentY);

    doc.moveDown(4);
  }

  _addFilterInfo(doc, filter, total) {
    const boxHeight = this._calculateFilterBoxHeight(filter);
    
    doc.rect(50, doc.y, doc.page.width - 100, boxHeight)
      .fillColor(this.colors.light).fill();
    
    const startY = doc.y + 10;
    doc.fontSize(14).font(this.fonts.bold).fillColor(this.colors.primary)
      .text('Criterios de filtrado:', 60, startY);
    doc.fontSize(10).font(this.fonts.regular).fillColor(this.colors.textDark);

    const filtros = this._buildFiltersList(filter);

    if (filtros.length > 0) {
      filtros.forEach((filtro, idx) => {
        if (idx > 0) doc.moveDown(0.3);
        doc.text(`• ${filtro}`, 60, doc.y, { align: 'left' });
      });
    } else {
      doc.text('Sin filtros aplicados - Mostrando todos los sacramentos', 60, doc.y, { align: 'left' });
    }
    
    doc.moveDown(0.8);
    doc.font(this.fonts.bold).fillColor(this.colors.accent)
      .text(`Total de sacramentos encontrados: ${total}`, 60);
    doc.moveDown(2);
  }

  _calculateFilterBoxHeight(filter) {
    const filtros = this._buildFiltersList(filter);
    const numFiltros = filtros.length || 1;
    return Math.max(90, 60 + (numFiltros * 15));
  }

  _buildFiltersList(filter) {
    const filtros = [];
    
    if (filter.tipo_sacramento_id_tipo) {
      filtros.push(`Tipo de Sacramento: ID ${filter.tipo_sacramento_id_tipo}`);
    }
    if (filter.institucion_parroquia_id_parroquia) {
      filtros.push(`Parroquia: ID ${filter.institucion_parroquia_id_parroquia}`);
    }
    if (filter.usuario_id_usuario) {
      filtros.push(`Usuario: ID ${filter.usuario_id_usuario}`);
    }
    
    if (filter.activo !== undefined && filter.activo !== null) {
      filtros.push(`Estado: ${filter.activo ? 'Activos' : 'Inactivos'}`);
    }
    
    if (filter.foja) {
      filtros.push(`Foja: ${filter.foja}`);
    }
    if (filter.numero) {
      filtros.push(`Número: ${filter.numero}`);
    }
    
    if (filter.numero_desde || filter.numero_hasta) {
      const desde = filter.numero_desde || '∞';
      const hasta = filter.numero_hasta || '∞';
      filtros.push(`Rango de números: ${desde} - ${hasta}`);
    }
    
    if (filter.anio_sacramento) {
      filtros.push(`Año sacramento: ${filter.anio_sacramento}`);
    }
    
    if (filter.mes_sacramento) {
      const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                     'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      filtros.push(`Mes sacramento: ${meses[filter.mes_sacramento - 1]}`);
    }
    
    if (filter.fecha_sacramento_desde || filter.fecha_sacramento_hasta) {
      const desde = filter.fecha_sacramento_desde 
        ? moment(filter.fecha_sacramento_desde).format('DD/MM/YYYY') 
        : '∞';
      const hasta = filter.fecha_sacramento_hasta 
        ? moment(filter.fecha_sacramento_hasta).format('DD/MM/YYYY') 
        : '∞';
      filtros.push(`Rango fechas sacramento: ${desde} - ${hasta}`);
    }
    
    if (filter.anio_registro) {
      filtros.push(`Año registro: ${filter.anio_registro}`);
    }
    
    if (filter.fecha_registro_desde || filter.fecha_registro_hasta) {
      const desde = filter.fecha_registro_desde 
        ? moment(filter.fecha_registro_desde).format('DD/MM/YYYY') 
        : '∞';
      const hasta = filter.fecha_registro_hasta 
        ? moment(filter.fecha_registro_hasta).format('DD/MM/YYYY') 
        : '∞';
      filtros.push(`Rango fechas registro: ${desde} - ${hasta}`);
    }
    
    if (filter.fecha_actualizacion_desde || filter.fecha_actualizacion_hasta) {
      const desde = filter.fecha_actualizacion_desde 
        ? moment(filter.fecha_actualizacion_desde).format('DD/MM/YYYY') 
        : '∞';
      const hasta = filter.fecha_actualizacion_hasta 
        ? moment(filter.fecha_actualizacion_hasta).format('DD/MM/YYYY') 
        : '∞';
      filtros.push(`Rango fechas actualización: ${desde} - ${hasta}`);
    }
    
    if (filter.search) {
      filtros.push(`Búsqueda: "${filter.search}"`);
    }
    
    if (filter.orderBy) {
      const dir = filter.orderDirection === 'DESC' ? 'Descendente' : 'Ascendente';
      filtros.push(`Orden: ${filter.orderBy} (${dir})`);
    }
    
    if (filter.limit) {
      filtros.push(`Límite: ${filter.limit} registros`);
    }
    if (filter.offset) {
      filtros.push(`Desde registro: ${filter.offset}`);
    }
    
    return filtros;
  }

  async _generateChartByType(sacramentos) {
    const tipoCounts = sacramentos.reduce((acc, sac) => {
      const tipo = sac.tipoSacramento?.nombre || 'Sin tipo';
      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});

    return await this._generatePieOrBarChart(
      Object.keys(tipoCounts),
      Object.values(tipoCounts),
      'Distribución de sacramentos por tipo'
    );
  }

  async _generateChartByParroquia(porParroquia) {
    const labels = porParroquia?.map(p => p.parroquia) || [];
    const data = porParroquia?.map(p => p.cantidad) || [];
    
    return await this._generatePieOrBarChart(
      labels,
      data,
      'Distribución de sacramentos por parroquia'
    );
  }

  async _generateChartByMonth(porMes) {
    const width = 600;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    const labels = porMes?.map(m => m.periodo) || [];
    const data = porMes?.map(m => m.cantidad) || [];

    const configuration = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos por mes',
          data,
          borderColor: '#ab47bc',
          backgroundColor: 'rgba(171, 71, 188, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Evolución temporal de sacramentos',
            font: { size: 16 }
          },
          legend: {
            display: true,
            position: 'top'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        }
      }
    };

    return await chartJSNodeCanvas.renderToBuffer(configuration);
  }

  async _generatePieOrBarChart(labels, data, title) {
    const width = 600;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height
    });

    const total = data.reduce((sum, val) => sum + (val || 0), 0);

    const configuration = {
      type: labels.length === 1 ? 'bar' : 'pie',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos',
          data,
          backgroundColor: labels.length === 1 ? ['#ab47bc'] : [
            '#ab47bc', '#42a5f5', '#ffca28', '#ef5350', '#66bb6a', '#26c6da', '#ffa726'
          ],
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 16, weight: 'bold' }
          },
          legend: {
            display: labels.length > 1,
            position: 'right',
            labels: {
              padding: 15,
              font: { size: 12 }
            }
          }
        },
        scales: labels.length === 1 ? {
          y: {
            beginAtZero: true,
            max: Math.max(...(data || [1])) + 1
          }
        } : {}
      }
    };

    return await chartJSNodeCanvas.renderToBuffer(configuration);
  }

  _addChartToPage(doc, chartImage) {
    const chartWidth = 500;
    const chartHeight = 300;
    const x = (doc.page.width - chartWidth) / 2;
    const y = doc.y + 20;
    
    try {
      doc.image(chartImage, x, y, {
        width: chartWidth,
        height: chartHeight
      });
      doc.moveDown(16);
    } catch (err) {
      console.error('Error agregando imagen de gráfica:', err.message);
    }
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
      activo: 'Estado',
      fecha_registro: 'F. Registro',
      fecha_actualizacion: 'F. Actualización'
    };

    const columnWidths = {
      id_sacramento: 35,
      fecha_sacramento: 70,
      tipo_sacramento: 80,
      foja: 45,
      numero: 35,
      parroquia: 100,
      usuario: 90,
      activo: 50,
      fecha_registro: 70,
      fecha_actualizacion: 70
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
        
        if (field === 'activo') {
          doc.fillColor(sacramento.activo ? '#66bb6a' : '#ef5350');
        } else {
          doc.fillColor(this.colors.textDark);
        }
        
        doc.text(val, currentX + 3, y + 5, {
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
    
    try {
      switch(field) {
        case 'id_sacramento':
          val = sacramento?.id_sacramento?.toString() || '';
          break;
        case 'fecha_sacramento':
          val = sacramento?.fecha_sacramento ? moment(sacramento.fecha_sacramento).format('DD/MM/YYYY') : '';
          break;
        case 'tipo_sacramento':
          val = sacramento?.tipoSacramento?.nombre || '';
          break;
        case 'foja':
          val = sacramento?.foja || '';
          break;
        case 'numero':
          val = sacramento?.numero?.toString() || '';
          break;
        case 'parroquia':
          val = sacramento?.parroquia?.nombre || '';
          break;
        case 'usuario':
          if (sacramento?.usuario) {
            val = `${sacramento.usuario.nombre || ''} ${sacramento.usuario.apellido_paterno || ''}`.trim();
          }
          break;
        case 'activo':
          val = sacramento?.activo ? '✓ Activo' : '✗ Inactivo';
          break;
        case 'fecha_registro':
          val = sacramento?.fecha_registro ? moment(sacramento.fecha_registro).format('DD/MM/YYYY HH:mm') : '';
          break;
        case 'fecha_actualizacion':
          val = sacramento?.fecha_actualizacion ? moment(sacramento.fecha_actualizacion).format('DD/MM/YYYY HH:mm') : '';
          break;
        default:
          val = sacramento?.[field]?.toString() || '';
      }
    } catch (error) {
      console.error(`Error al obtener valor de campo ${field}:`, error);
      val = '';
    }
    
    return val;
  }

  _addPortada(doc) {
    const portadaPath = path.join(__dirname, '../assets/portadaof3.png');
    if (fs.existsSync(portadaPath)) {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.image(portadaPath, 0, 0, {
        width: doc.page.width,
        height: doc.page.height
      });
    }
  }

  _addHeader(doc, titulo = 'Reporte de Sacramentos') {
    const logoPath = './src/assets/arquidiocesis-24.png';
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { width: 70 });
    }
    
    doc.fontSize(22).font(this.fonts.bold).fillColor(this.colors.primary)
      .text(titulo, 100, 40, { align: 'center' });
    doc.fontSize(10).font(this.fonts.italic).fillColor(this.colors.secondary)
      .text(`Generado: ${moment().format('DD/MM/YYYY HH:mm')}`, { align: 'right' });

    const y = Math.max(doc.y + 10, 100);
    doc.strokeColor(this.colors.accent).lineWidth(1)
      .moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
    doc.moveDown(4);
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