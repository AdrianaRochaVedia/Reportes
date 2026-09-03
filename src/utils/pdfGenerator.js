const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const ChartDataLabels = require('chartjs-plugin-datalabels');

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

    // Paleta coherente con la identidad de la app (azules/teal + acentos cálidos)
    this.chartPalette = [
      '#1565C0', '#26A69A', '#FFB300', '#7E57C2', '#EF5350',
      '#66BB6A', '#EC407A', '#42A5F5', '#8D6E63', '#26C6DA'
    ];

    this.chartWidth = 800;
    this.chartHeight = 480;

    // Una sola instancia reutilizada: crear un ChartJSNodeCanvas por gráfica
    // obliga a recargar en frío el binario nativo `canvas` y todo `chart.js/auto`
    // en cada llamada, lo que dominaba el tiempo de generación del PDF.
    this.chartRenderer = new ChartJSNodeCanvas({
      width: this.chartWidth,
      height: this.chartHeight,
      backgroundColour: 'white',
      chartCallback: (ChartJS) => {
        ChartJS.register(ChartDataLabels);
        ChartJS.defaults.font.family = "'Helvetica Neue', Helvetica, Arial, sans-serif";
      }
    });

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

  async generatePDFReport(sacramentos = [], options = {}, filter = {}, estadisticas = null) {
    try {
      filter = filter || {};

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
      const writeStream = fs.createWriteStream(filePath);

      doc.pipe(writeStream);

      let pageNumber = 1;

      this._addPortada(doc);

      doc.addPage();
      this._addHeader(doc, options.titulo);
      this._addFilterInfo(doc, filter, sacramentos.length);

      if (options.incluirEstadisticas && estadisticas) {
        this._addEstadisticasResumen(doc, estadisticas);
      }

      this._addFooter(doc, pageNumber++);

      doc.addPage();
      this._addHeader(doc, options.titulo);

      this._addTable(doc, sacramentos, fields, () => {
        this._addFooter(doc, pageNumber++);
        doc.addPage();
        this._addHeader(doc, options.titulo);
      });

      this._addFooter(doc, pageNumber++);

      // Todas las gráficas se generan en paralelo contra el mismo renderer
      // compartido (ver constructor), en lugar de esperar una por una.
      const chartJobs = [];

      if (sacramentos.length > 0) {
        chartJobs.push(
          this._generateChartByType(sacramentos)
            .then(buf => ({ key: 'tipo', buf }))
            .catch(err => {
              console.error('Error generando gráfica de tipos:', err.message);
              return null;
            })
        );
      }

      if (options.incluirEstadisticas && estadisticas) {
        if (estadisticas.por_parroquia && estadisticas.por_parroquia.length > 1) {
          chartJobs.push(
            this._generateChartByParroquia(estadisticas.por_parroquia)
              .then(buf => ({ key: 'parroquia', buf }))
              .catch(err => {
                console.error('Error generando gráfica de parroquias:', err.message);
                return null;
              })
          );
        }

        if (estadisticas.por_mes && estadisticas.por_mes.length > 1) {
          chartJobs.push(
            this._generateChartByMonth(estadisticas.por_mes)
              .then(buf => ({ key: 'mes', buf }))
              .catch(err => {
                console.error('Error generando gráfica de meses:', err.message);
                return null;
              })
          );
        }
      }

      const chartResults = await Promise.all(chartJobs);
      const charts = {};
      chartResults.forEach(r => {
        if (r) charts[r.key] = r.buf;
      });

      const chartPages = [
        { key: 'tipo', titulo: 'Distribución por Tipo de Sacramento' },
        { key: 'parroquia', titulo: 'Distribución por Parroquia' },
        { key: 'mes', titulo: 'Distribución Temporal (por mes)' }
      ];

      chartPages.forEach(({ key, titulo }) => {
        if (!charts[key]) return;

        doc.addPage();
        this._addHeader(doc, options.titulo);

        doc.moveDown(1);
        doc.fontSize(14)
          .font(this.fonts.bold)
          .fillColor(this.colors.primary)
          .text(titulo, 50);

        doc.moveDown(1.5);
        this._addChartToPage(doc, charts[key]);
        this._addFooter(doc, pageNumber++);
      });

      doc.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      setTimeout(() => {
        fs.unlink(filePath, () => {});
      }, this.fileRetentionTime);

      return {
        fileName,
        filePath,
        downloadUrl: `/download/${fileName}`
      };

    } catch (error) {
      console.error('ERROR REAL AL GENERAR PDF:', error);
      console.error('STACK:', error.stack);
      throw new Error(`Error al generar PDF: ${error.message}`);
    }
  }

  _addEstadisticasResumen(doc, estadisticas) {
    doc.moveDown(1);

    doc.fontSize(14)
      .font(this.fonts.bold)
      .fillColor(this.colors.primary)
      .text('Resumen Estadístico', 50);

    doc.moveDown(0.5);

    const boxY = doc.y;
    const boxHeight = 120;

    doc.rect(50, boxY, doc.page.width - 100, boxHeight)
      .fillColor(this.colors.light)
      .fill();

    doc.fontSize(11)
      .font(this.fonts.regular)
      .fillColor(this.colors.textDark);

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

  _addFilterInfo(doc, filter = {}, total = 0) {
    const boxHeight = this._calculateFilterBoxHeight(filter);

    doc.rect(50, doc.y, doc.page.width - 100, boxHeight)
      .fillColor(this.colors.light)
      .fill();

    const startY = doc.y + 10;

    doc.fontSize(14)
      .font(this.fonts.bold)
      .fillColor(this.colors.primary)
      .text('Criterios de filtrado:', 60, startY);

    doc.moveDown(0.5);

    doc.fontSize(10)
      .font(this.fonts.regular)
      .fillColor(this.colors.textDark);

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

    doc.font(this.fonts.bold)
      .fillColor(this.colors.accent)
      .text(`Total de sacramentos encontrados: ${total}`, 60);

    doc.moveDown(2);
  }

  _calculateFilterBoxHeight(filter = {}) {
    const filtros = this._buildFiltersList(filter);
    const numFiltros = filtros.length || 1;
    return Math.max(90, 60 + (numFiltros * 15));
  }

  _buildFiltersList(filter = {}) {
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
      const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
      ];

      filtros.push(`Mes sacramento: ${meses[filter.mes_sacramento - 1] || filter.mes_sacramento}`);
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

  async _generateChartByType(sacramentos = []) {
    const tipoCounts = sacramentos.reduce((acc, sac) => {
      const tipo =
        sac.tipoSacramento?.nombre ||
        sac.tipo_sacramento?.nombre ||
        sac.tipo_sacramento ||
        'Sin tipo';

      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});

    return await this._generatePieOrBarChart(
      Object.keys(tipoCounts),
      Object.values(tipoCounts),
      'Distribución de sacramentos por tipo'
    );
  }

  async _generateChartByParroquia(porParroquia = []) {
    const labels = porParroquia.map(p => p.parroquia || p.nombre || 'Sin parroquia');
    const data = porParroquia.map(p => Number(p.cantidad || p.total || 0));

    return await this._generatePieOrBarChart(
      labels,
      data,
      'Distribución de sacramentos por parroquia'
    );
  }

  async _generateChartByMonth(porMes = []) {
    const labels = porMes.map(m => m.periodo || m.mes || 'Sin periodo');
    const data = porMes.map(m => Number(m.cantidad || m.total || 0));
    const showLabels = data.length <= 12;

    const configuration = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos por mes',
          data,
          borderColor: this.colors.primary,
          backgroundColor: (ctx) => {
            const { chartArea, ctx: canvasCtx } = ctx.chart;
            if (!chartArea) return 'rgba(21, 101, 192, 0.15)';
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, 'rgba(21, 101, 192, 0.35)');
            gradient.addColorStop(1, 'rgba(21, 101, 192, 0.02)');
            return gradient;
          },
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: this.colors.primary,
          pointBorderWidth: 2,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: false,
        layout: { padding: { top: 10, right: 20, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: 'Evolución temporal de sacramentos',
            font: { size: 20, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 6 }
          },
          subtitle: {
            display: true,
            text: `Total del periodo: ${data.reduce((a, b) => a + b, 0)}`,
            font: { size: 13, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 20 }
          },
          legend: {
            display: true,
            position: 'top',
            labels: { usePointStyle: true, boxWidth: 8, font: { size: 13 } }
          },
          datalabels: {
            display: showLabels,
            align: 'top',
            anchor: 'end',
            color: this.colors.textDark,
            font: { size: 11, weight: 'bold' },
            formatter: (value) => value
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 12 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#E0E0E0', borderDash: [4, 4] },
            ticks: { precision: 0, font: { size: 12 } }
          }
        }
      }
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  async _generatePieOrBarChart(labels = [], data = [], title = '') {
    if (!labels.length || !data.length) {
      labels = ['Sin datos'];
      data = [1];
    }

    const isSingle = labels.length === 1;
    const total = data.reduce((a, b) => a + b, 0);
    const backgroundColors = isSingle
      ? [this.chartPalette[0]]
      : labels.map((_, idx) => this.chartPalette[idx % this.chartPalette.length]);

    const configuration = {
      type: isSingle ? 'bar' : 'doughnut',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos',
          data,
          backgroundColor: backgroundColors,
          hoverBackgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: isSingle ? 0 : 3,
          borderRadius: isSingle ? 8 : 0,
          hoverOffset: isSingle ? 0 : 10
        }]
      },
      options: {
        responsive: false,
        cutout: isSingle ? undefined : '58%',
        layout: { padding: { top: 10, right: 20, bottom: 10, left: 20 } },
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 20, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 6 }
          },
          subtitle: {
            display: true,
            text: `Total: ${total}`,
            font: { size: 13, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 20 }
          },
          legend: {
            display: !isSingle,
            position: 'right',
            labels: {
              padding: 16,
              usePointStyle: true,
              boxWidth: 8,
              font: { size: 13 }
            }
          },
          datalabels: {
            color: isSingle ? this.colors.textDark : '#fff',
            anchor: isSingle ? 'end' : 'center',
            align: isSingle ? 'top' : 'center',
            font: { weight: 'bold', size: 13 },
            formatter: (value) => {
              if (!total) return value;
              if (isSingle) return value;
              const pct = (value / total) * 100;
              return pct >= 5 ? `${pct.toFixed(1)}%` : '';
            }
          }
        },
        scales: isSingle ? {
          y: {
            beginAtZero: true,
            max: Math.max(...data) + 1,
            grid: { color: '#E0E0E0', borderDash: [4, 4] }
          },
          x: {
            grid: { display: false }
          }
        } : {}
      }
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  _addChartToPage(doc, chartImage) {
    const chartWidth = 500;
    const chartHeight = 300;
    const padding = 12;
    const x = (doc.page.width - chartWidth) / 2;
    const y = doc.y + 20;

    try {
      doc.roundedRect(x - padding, y - padding, chartWidth + padding * 2, chartHeight + padding * 2, 8)
        .fillColor('#FAFAFA')
        .fill();

      doc.roundedRect(x - padding, y - padding, chartWidth + padding * 2, chartHeight + padding * 2, 8)
        .strokeColor(this.colors.light)
        .lineWidth(1)
        .stroke();

      doc.image(chartImage, x, y, {
        width: chartWidth,
        height: chartHeight
      });

      doc.moveDown(16);
    } catch (err) {
      console.error('Error agregando imagen de gráfica:', err.message);
    }
  }

  _addTable(doc, sacramentos = [], fields = [], onNewPage) {
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

    const totalUsedWidth = fields.reduce((sum, field) => {
      return sum + (columnWidths[field] || 70);
    }, 0);

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
        .fillColor(this.colors.primary)
        .fill();

      doc.font(this.fonts.bold)
        .fontSize(10)
        .fillColor('white');

      fields.forEach(field => {
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

    if (!sacramentos.length) {
      doc.font(this.fonts.regular)
        .fontSize(10)
        .fillColor(this.colors.secondary)
        .text('No se encontraron registros para mostrar.', startX, y + 10);

      return;
    }

    sacramentos.forEach((sacramento, idx) => {
      doc.font(this.fonts.regular)
        .fontSize(9)
        .fillColor(this.colors.textDark);

      let maxLines = 1;

      fields.forEach(field => {
        const colWidth = adjustedWidths[field];
        const val = this._getFieldValue(sacramento, field);
        const availableTextWidth = colWidth - 6;

        const words = val.split(' ');
        let currentLine = '';
        let lines = 1;

        for (const word of words) {
          const testLine = currentLine + (currentLine ? ' ' : '') + word;
          const testWidth = doc.widthOfString(testLine);

          if (testWidth > availableTextWidth && currentLine !== '') {
            lines++;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        maxLines = Math.max(maxLines, lines);
      });

      const rowHeight = Math.max(baseRowHeight, maxLines * 12 + 8);

      if (y + rowHeight + footerHeight > doc.page.height) {
        onNewPage();
        y = doc.y;
        drawHeader();
      }

      if (idx % 2 === 0) {
        doc.rect(startX, y, availableWidth, rowHeight)
          .fillColor(this.colors.light)
          .fill();
      }

      let currentX = startX;

      fields.forEach(field => {
        const colWidth = adjustedWidths[field];
        const val = this._getFieldValue(sacramento, field);

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

  _getFieldValue(sacramento = {}, field) {
    let val = '';

    try {
      switch (field) {
        case 'id_sacramento':
          val = sacramento?.id_sacramento?.toString() || '';
          break;

        case 'fecha_sacramento':
          val = sacramento?.fecha_sacramento
            ? moment(sacramento.fecha_sacramento).format('DD/MM/YYYY')
            : '';
          break;

        case 'tipo_sacramento':
          val =
            sacramento?.tipoSacramento?.nombre ||
            sacramento?.tipo_sacramento?.nombre ||
            sacramento?.tipo_sacramento ||
            '';
          break;

        case 'foja':
          val = sacramento?.foja?.toString() || '';
          break;

        case 'numero':
          val = sacramento?.numero?.toString() || '';
          break;

        case 'parroquia':
          val =
            sacramento?.parroquia?.nombre ||
            sacramento?.institucionParroquia?.nombre ||
            sacramento?.institucion_parroquia?.nombre ||
            '';
          break;

        case 'usuario':
          if (sacramento?.usuario) {
            val = `${sacramento.usuario.nombre || ''} ${sacramento.usuario.apellido_paterno || ''}`.trim();
          }
          break;

        case 'activo':
          val = sacramento?.activo ? 'Activo' : 'Inactivo';
          break;

        case 'fecha_registro':
          val = sacramento?.fecha_registro
            ? moment(sacramento.fecha_registro).format('DD/MM/YYYY HH:mm')
            : '';
          break;

        case 'fecha_actualizacion':
          val = sacramento?.fecha_actualizacion
            ? moment(sacramento.fecha_actualizacion).format('DD/MM/YYYY HH:mm')
            : '';
          break;

        default:
          val = sacramento?.[field] !== undefined && sacramento?.[field] !== null
            ? sacramento[field].toString()
            : '';
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
    const logoPath = path.join(__dirname, '../assets/arquidiocesis-24.png');

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { width: 70 });
    }

    doc.fontSize(22)
      .font(this.fonts.bold)
      .fillColor(this.colors.primary)
      .text(titulo, 100, 40, { align: 'center' });

    doc.fontSize(10)
      .font(this.fonts.italic)
      .fillColor(this.colors.secondary)
      .text(`Generado: ${moment().format('DD/MM/YYYY HH:mm')}`, {
        align: 'right'
      });

    const y = Math.max(doc.y + 10, 100);

    doc.strokeColor(this.colors.accent)
      .lineWidth(1)
      .moveTo(50, y)
      .lineTo(doc.page.width - 50, y)
      .stroke();

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

  _startCleanupScheduler() {
    this._cleanupOldFiles();

    setInterval(() => {
      this._cleanupOldFiles();
    }, this.cleanupInterval);
  }

  _cleanupOldFiles() {
    try {
      if (!fs.existsSync(this.uploadDir)) return;

      const now = Date.now();

      fs.readdirSync(this.uploadDir).forEach(file => {
        const filePath = path.join(this.uploadDir, file);

        if (!fs.existsSync(filePath)) return;

        const stat = fs.statSync(filePath);

        if (stat.mtimeMs < now - this.cleanupInterval) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error('Error limpiando archivos antiguos:', error.message);
    }
  }
}

module.exports = new PDFGenerator();