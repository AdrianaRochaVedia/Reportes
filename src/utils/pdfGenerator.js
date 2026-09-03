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

    this.chartWidth = 760;
    this.chartHeight = 507;

    // Una sola instancia reutilizada: crear un ChartJSNodeCanvas por gráfica
    // obliga a recargar en frío el binario nativo `canvas` y todo `chart.js/auto`
    // en cada llamada, lo que dominaba el tiempo de generación del PDF.
    const chartCallback = (ChartJS) => {
      ChartJS.register(ChartDataLabels);
      ChartJS.defaults.font.family = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    };

    this.chartRenderer = new ChartJSNodeCanvas({
      width: this.chartWidth,
      height: this.chartHeight,
      backgroundColour: 'white',
      chartCallback
    });

    // Renderer aparte para la gráfica "banner" (estado activo/inactivo), que
    // necesita una proporción mucho más ancha y baja que el resto.
    this.bannerChartWidth = 800;
    this.bannerChartHeight = 200;

    this.bannerChartRenderer = new ChartJSNodeCanvas({
      width: this.bannerChartWidth,
      height: this.bannerChartHeight,
      backgroundColour: 'white',
      chartCallback
    });

    this.chartDisplaySize = { width: 480, height: 320 };
    this.bannerDisplaySize = { width: 480, height: 120 };

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
      // compartido (ver constructor), en lugar de esperar una por una. Cada
      // una regresa, además de la imagen, una lectura ("insight") calculada
      // a partir de los propios datos.
      const chartJobs = [];

      if (sacramentos.length > 0) {
        chartJobs.push(
          this._generateChartByType(sacramentos).catch(err => {
            console.error('Error generando gráfica de tipos:', err.message);
            return null;
          })
        );
      }

      if (options.incluirEstadisticas && estadisticas) {
        if (estadisticas.por_parroquia && estadisticas.por_parroquia.length > 1) {
          chartJobs.push(
            this._generateChartByParroquia(estadisticas.por_parroquia).catch(err => {
              console.error('Error generando gráfica de parroquias:', err.message);
              return null;
            })
          );
        }

        if (estadisticas.por_usuario && estadisticas.por_usuario.length > 1) {
          chartJobs.push(
            this._generateChartByUsuario(estadisticas.por_usuario).catch(err => {
              console.error('Error generando gráfica de usuarios:', err.message);
              return null;
            })
          );
        }

        if ((estadisticas.activos || 0) + (estadisticas.inactivos || 0) > 0) {
          chartJobs.push(
            this._generateActivosInactivosChart(estadisticas).catch(err => {
              console.error('Error generando gráfica de estado:', err.message);
              return null;
            })
          );
        }

        if (estadisticas.por_mes && estadisticas.por_mes.length > 1) {
          chartJobs.push(
            this._generateChartByMonth(estadisticas.por_mes).catch(err => {
              console.error('Error generando gráfica de meses:', err.message);
              return null;
            })
          );
        }
      }

      const chartBlocks = (await Promise.all(chartJobs)).filter(Boolean);

      if (chartBlocks.length) {
        doc.addPage();
        this._addHeader(doc, options.titulo);

        chartBlocks.forEach(block => {
          const blockHeight = this._estimateChartBlockHeight(block);
          const footerHeight = 50;

          // Si el siguiente bloque no cabe en lo que queda de la página
          // actual, se abre una nueva; si cabe, se apila junto al anterior
          // en vez de forzar una página por gráfica.
          if (doc.y + blockHeight + footerHeight > doc.page.height) {
            this._addFooter(doc, pageNumber++);
            doc.addPage();
            this._addHeader(doc, options.titulo);
          }

          this._addChartBlockToPage(doc, block);
        });

        this._addFooter(doc, pageNumber++);
      }

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

  _pct(value, total) {
    return total ? ((value / total) * 100).toFixed(1) : '0.0';
  }

  async _generateChartByType(sacramentos = []) {
    const titulo = 'Distribución por Tipo de Sacramento';

    const tipoCounts = sacramentos.reduce((acc, sac) => {
      const tipo =
        sac.tipoSacramento?.nombre ||
        sac.tipo_sacramento?.nombre ||
        sac.tipo_sacramento ||
        'Sin tipo';

      acc[tipo] = (acc[tipo] || 0) + 1;
      return acc;
    }, {});

    const labels = Object.keys(tipoCounts);
    const data = Object.values(tipoCounts);
    const total = data.reduce((a, b) => a + b, 0);

    const buffer = await this._generateDoughnutChart(labels, data, titulo);

    let insight = 'No hay datos suficientes para identificar un patrón.';

    if (labels.length && total) {
      const maxIdx = data.indexOf(Math.max(...data));
      const pctMax = this._pct(data[maxIdx], total);

      insight = `"${labels[maxIdx]}" es el sacramento más registrado: ${data[maxIdx]} de ${total} casos (${pctMax}%).`;

      if (labels.length > 1) {
        const minIdx = data.indexOf(Math.min(...data));

        if (minIdx !== maxIdx) {
          insight += ` El menos frecuente es "${labels[minIdx]}", con ${data[minIdx]} registro${data[minIdx] === 1 ? '' : 's'}.`;
        }
      }
    }

    return {
      titulo,
      insight,
      buffer,
      displayWidth: this.chartDisplaySize.width,
      displayHeight: this.chartDisplaySize.height
    };
  }

  async _generateChartByParroquia(porParroquia = []) {
    const titulo = 'Parroquias con más sacramentos registrados';

    const entries = porParroquia.map(p => ({
      label: p.parroquia || p.nombre || 'Sin parroquia',
      value: Number(p.cantidad || p.total || 0)
    }));

    const { buffer, leader, total, count } = await this._generateRankingChart(entries, titulo);

    const insight = total
      ? `"${leader.label}" concentra ${leader.value} de ${total} sacramentos (${this._pct(leader.value, total)}%), la cifra más alta entre las ${count} parroquias con registros.`
      : 'No hay datos suficientes para identificar un patrón.';

    return {
      titulo,
      insight,
      buffer,
      displayWidth: this.chartDisplaySize.width,
      displayHeight: this.chartDisplaySize.height
    };
  }

  async _generateChartByUsuario(porUsuario = []) {
    const titulo = 'Usuarios que más sacramentos han registrado';

    const entries = porUsuario.map(u => ({
      label: u.usuario || u.nombre || 'Sin usuario',
      value: Number(u.cantidad || u.total || 0)
    }));

    const { buffer, leader, total, count } = await this._generateRankingChart(entries, titulo);

    const insight = total
      ? `"${leader.label}" ha registrado ${leader.value} sacramentos (${this._pct(leader.value, total)}% del total), más que cualquier otro de los ${count} usuarios registradores.`
      : 'No hay datos suficientes para identificar un patrón.';

    return {
      titulo,
      insight,
      buffer,
      displayWidth: this.chartDisplaySize.width,
      displayHeight: this.chartDisplaySize.height
    };
  }

  async _generateActivosInactivosChart(estadisticas = {}) {
    const titulo = 'Estado de los registros';

    const activos = Number(estadisticas.activos || 0);
    const inactivos = Number(estadisticas.inactivos || 0);
    const total = activos + inactivos;

    if (!total) return null;

    const pctActivos = this._pct(activos, total);
    const pctInactivos = this._pct(inactivos, total);

    const configuration = {
      type: 'bar',
      data: {
        labels: ['Sacramentos'],
        datasets: [
          {
            label: `Activos (${pctActivos}%)`,
            data: [activos],
            backgroundColor: '#66BB6A',
            borderRadius: 6
          },
          {
            label: `Inactivos (${pctInactivos}%)`,
            data: [inactivos],
            backgroundColor: '#EF5350',
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 10, right: 30, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: titulo,
            font: { size: 18, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 4 }
          },
          subtitle: {
            display: true,
            text: `Total: ${total}`,
            font: { size: 12, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 10 }
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } }
          },
          datalabels: {
            color: '#fff',
            font: { weight: 'bold', size: 13 },
            formatter: (value) => (value > 0 ? value : '')
          }
        },
        scales: {
          x: { stacked: true, display: false },
          y: { stacked: true, display: false }
        }
      }
    };

    const buffer = await this.bannerChartRenderer.renderToBuffer(configuration);

    const insight = activos >= inactivos
      ? `El ${pctActivos}% de los sacramentos registrados están activos; el ${pctInactivos}% restante figura como inactivo.`
      : `Solo el ${pctActivos}% de los sacramentos registrados están activos: la mayoría (${pctInactivos}%) están inactivos, lo que puede requerir revisión.`;

    return {
      titulo,
      insight,
      buffer,
      displayWidth: this.bannerDisplaySize.width,
      displayHeight: this.bannerDisplaySize.height
    };
  }

  async _generateRankingChart(entries = [], title = '') {
    const sorted = entries
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);

    const topN = 7;
    let display = sorted.slice(0, topN);
    const rest = sorted.slice(topN);

    if (rest.length) {
      display = [...display, {
        label: `Otras (${rest.length})`,
        value: rest.reduce((s, e) => s + e.value, 0)
      }];
    }

    const total = sorted.reduce((s, e) => s + e.value, 0);
    const leader = sorted[0] || { label: 'Sin datos', value: 0 };

    if (!display.length) {
      display = [{ label: 'Sin datos', value: 1 }];
    }

    const labels = display.map(d => d.label);
    const data = display.map(d => d.value);

    const backgroundColors = display.map((d, idx) => {
      if (idx === 0 && d.label === leader.label) return this.colors.primary;
      if (d.label.startsWith('Otras')) return '#B0BEC5';
      return '#90CAF9';
    });

    const configuration = {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Registros',
          data,
          backgroundColor: backgroundColors,
          borderRadius: 6,
          maxBarThickness: 26
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        layout: { padding: { top: 10, right: 40, bottom: 10, left: 10 } },
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 18, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 4 }
          },
          subtitle: {
            display: true,
            text: `Total: ${total}`,
            font: { size: 12, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 14 }
          },
          legend: { display: false },
          datalabels: {
            color: this.colors.textDark,
            anchor: 'end',
            align: 'right',
            font: { weight: 'bold', size: 11 },
            formatter: (value) => value
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: '#E0E0E0', borderDash: [4, 4] },
            ticks: { precision: 0, font: { size: 10 } }
          },
          y: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          }
        }
      }
    };

    const buffer = await this.chartRenderer.renderToBuffer(configuration);

    return { buffer, leader, total, count: sorted.length };
  }

  async _generateChartByMonth(porMes = []) {
    const titulo = 'Evolución temporal de sacramentos';
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
            text: titulo,
            font: { size: 18, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 4 }
          },
          subtitle: {
            display: true,
            text: `Total del periodo: ${data.reduce((a, b) => a + b, 0)}`,
            font: { size: 12, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 14 }
          },
          legend: {
            display: true,
            position: 'top',
            labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } }
          },
          datalabels: {
            display: showLabels,
            align: 'top',
            anchor: 'end',
            color: this.colors.textDark,
            font: { size: 10, weight: 'bold' },
            formatter: (value) => value
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#E0E0E0', borderDash: [4, 4] },
            ticks: { precision: 0, font: { size: 11 } }
          }
        }
      }
    };

    const buffer = await this.chartRenderer.renderToBuffer(configuration);

    let insight = 'No hay datos suficientes para identificar una tendencia.';

    if (data.length) {
      const maxIdx = data.indexOf(Math.max(...data));
      const minIdx = data.indexOf(Math.min(...data));
      const mid = Math.floor(data.length / 2) || 1;
      const firstHalf = data.slice(0, mid);
      const secondHalf = data.slice(mid);
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.length
        ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length
        : firstAvg;

      let tendencia = 'un comportamiento relativamente estable';

      if (secondAvg > firstAvg * 1.15) tendencia = 'una tendencia de crecimiento';
      else if (secondAvg < firstAvg * 0.85) tendencia = 'una tendencia a la baja';

      insight = `El periodo con más actividad fue ${labels[maxIdx]} (${data[maxIdx]} registros)`;
      insight += minIdx !== maxIdx
        ? `, mientras que ${labels[minIdx]} tuvo la menor (${data[minIdx]}).`
        : '.';
      insight += ` En conjunto, se observa ${tendencia} a lo largo del periodo.`;
    }

    return {
      titulo,
      insight,
      buffer,
      displayWidth: this.chartDisplaySize.width,
      displayHeight: this.chartDisplaySize.height
    };
  }

  async _generateDoughnutChart(labels = [], data = [], title = '') {
    if (!labels.length || !data.length) {
      labels = ['Sin datos'];
      data = [1];
    }

    const total = data.reduce((a, b) => a + b, 0);
    const backgroundColors = labels.map((_, idx) => this.chartPalette[idx % this.chartPalette.length]);

    const configuration = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          label: 'Sacramentos',
          data,
          backgroundColor: backgroundColors,
          hoverBackgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: false,
        cutout: '58%',
        layout: { padding: { top: 10, right: 20, bottom: 10, left: 20 } },
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 18, weight: 'bold' },
            color: this.colors.textDark,
            padding: { bottom: 4 }
          },
          subtitle: {
            display: true,
            text: `Total: ${total}`,
            font: { size: 12, style: 'italic' },
            color: this.colors.secondary,
            padding: { bottom: 14 }
          },
          legend: {
            display: labels.length > 1,
            position: 'right',
            labels: {
              padding: 14,
              usePointStyle: true,
              boxWidth: 8,
              font: { size: 12 }
            }
          },
          datalabels: {
            color: '#fff',
            anchor: 'center',
            align: 'center',
            font: { weight: 'bold', size: 12 },
            formatter: (value) => {
              if (!total) return value;
              const pct = (value / total) * 100;
              return pct >= 5 ? `${pct.toFixed(1)}%` : '';
            }
          }
        }
      }
    };

    return await this.chartRenderer.renderToBuffer(configuration);
  }

  _estimateChartBlockHeight(block) {
    // Calibrado contra mediciones reales de doc.y antes/después de dibujar
    // cada tipo de bloque: título + tarjeta + espaciados fijos rondan 37pt,
    // y cada ~105 caracteres de insight agregan una línea (~11pt) más.
    const chartCardHeight = block.displayHeight + 24;
    const insightLines = block.insight ? Math.max(1, Math.ceil(block.insight.length / 105)) : 0;

    return chartCardHeight + 37 + insightLines * 11;
  }

  _addChartBlockToPage(doc, block) {
    const { titulo, insight, buffer, displayWidth, displayHeight } = block;
    const padding = 10;

    doc.fontSize(13)
      .font(this.fonts.bold)
      .fillColor(this.colors.primary)
      .text(titulo, 50, doc.y, { width: doc.page.width - 100 });

    doc.moveDown(0.5);

    const chartX = (doc.page.width - displayWidth) / 2;
    const chartY = doc.y;

    try {
      doc.roundedRect(chartX - padding, chartY - padding, displayWidth + padding * 2, displayHeight + padding * 2, 8)
        .fillColor('#FAFAFA')
        .fill();

      doc.roundedRect(chartX - padding, chartY - padding, displayWidth + padding * 2, displayHeight + padding * 2, 8)
        .strokeColor(this.colors.light)
        .lineWidth(1)
        .stroke();

      doc.image(buffer, chartX, chartY, {
        width: displayWidth,
        height: displayHeight
      });
    } catch (err) {
      console.error('Error agregando imagen de gráfica:', err.message);
    }

    doc.y = chartY + displayHeight + padding + 12;

    if (insight) {
      doc.fontSize(9.5)
        .font(this.fonts.bold)
        .fillColor(this.colors.textDark)
        .text('Lo más destacado: ', 55, doc.y, { continued: true, width: doc.page.width - 110 });

      doc.font(this.fonts.italic)
        .fillColor(this.colors.secondary)
        .text(insight, { width: doc.page.width - 110 });
    }

    doc.moveDown(1.4);
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