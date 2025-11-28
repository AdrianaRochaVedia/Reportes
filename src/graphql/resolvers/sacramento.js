const sacramentoService = require('../../services/sacramentoService');
const pdfGenerator = require('../../utils/pdfGenerator');

module.exports = {
  Query: {
    sacramentos: async (_, { filter = {} }, { token }) => {
      try {
        const sacramentos = await sacramentoService.getFilteredSacramentos(filter, token);
        return sacramentos;
      } catch (error) {
        throw new Error(`Error al consultar sacramentos: ${error.message}`);
      }
    },

    estadisticasSacramentos: async (_, { filter = {} }, { token }) => {
      try {
        const estadisticas = await sacramentoService.getEstadisticas(filter, token);
        return estadisticas;
      } catch (error) {
        throw new Error(`Error al obtener estadísticas: ${error.message}`);
      }
    },

    sacramentosPorTipo: async (_, { tipo_id, filter = {} }, { token }) => {
      try {
        const filterConTipo = { ...filter, tipo_sacramento_id_tipo: tipo_id };
        return await sacramentoService.getFilteredSacramentos(filterConTipo, token);
      } catch (error) {
        throw new Error(`Error al consultar sacramentos por tipo: ${error.message}`);
      }
    },

    sacramentosPorParroquia: async (_, { parroquia_id, filter = {} }, { token }) => {
      try {
        const filterConParroquia = { ...filter, institucion_parroquia_id_parroquia: parroquia_id };
        return await sacramentoService.getFilteredSacramentos(filterConParroquia, token);
      } catch (error) {
        throw new Error(`Error al consultar sacramentos por parroquia: ${error.message}`);
      }
    },

    sacramentosPorUsuario: async (_, { usuario_id, filter = {} }, { token }) => {
      try {
        const filterConUsuario = { ...filter, usuario_id_usuario: usuario_id };
        return await sacramentoService.getFilteredSacramentos(filterConUsuario, token);
      } catch (error) {
        throw new Error(`Error al consultar sacramentos por usuario: ${error.message}`);
      }
    },
  },

  Sacramento: {
    usuario: async (parent) => {
      if (parent.usuario) return parent.usuario;
      return null;
    },
    parroquia: async (parent) => {
      if (parent.parroquia) return parent.parroquia;
      return null;
    },
    tipoSacramento: async (parent) => {
      if (parent.tipoSacramento) return parent.tipoSacramento;
      return null;
    }
  },

  Mutation: {
    generarReportePDF: async (_, { filter = {}, fields = null, titulo = null, incluirEstadisticas = false }, { token }) => {
      try {
        console.log('Filtros recibidos:', JSON.stringify(filter, null, 2));
        
        const sacramentos = await sacramentoService.getFilteredSacramentos(filter, token);
        console.log(`Sacramentos obtenidos: ${sacramentos.length} registros encontrados.`);
        
        if (!sacramentos || sacramentos.length === 0) {
          throw new Error('No se encontraron sacramentos que coincidan con los filtros aplicados.');
        }

        // Campos por defecto
        const camposPorDefecto = [
          'id_sacramento', 
          'fecha_sacramento', 
          'foja', 
          'numero', 
          'tipo_sacramento',
          'parroquia',
          'usuario',
          'activo'
        ];

        const options = {
          fields: fields || camposPorDefecto,
          titulo: titulo || 'Reporte de Sacramentos',
          incluirEstadisticas: incluirEstadisticas || false
        };
        
        let estadisticas = null;
        if (incluirEstadisticas) {
          estadisticas = await sacramentoService.getEstadisticas(filter, token);
        }
        const result = await pdfGenerator.generatePDFReport(sacramentos, options, filter, estadisticas);
        console.log('PDF generado:', result);
        
        const filtrosAplicados = sacramentoService.generarDescripcionFiltros(filter);

        return {
          fileName: result?.fileName || 'reporte.pdf',
          downloadUrl: result?.downloadUrl || '/download/',
          totalRegistros: sacramentos.length,
          filtrosAplicados
        };
      } catch (error) {
        console.error(`Error al generar PDF:`, error);
        throw new Error(`Error al generar PDF: ${error.message}`);
      }
    }
  }
};