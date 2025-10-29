const sacramentoService = require('../../services/sacramentoService');
const pdfGenerator = require('../../utils/pdfGenerator');

module.exports = {
  Query: {
    sacramentos: async (_, { filter = {} }) => {
      try {
        const sacramentos = await sacramentoService.getFilteredSacramentos(filter);
        return sacramentos;
      } catch (error) {
        throw new Error(`Error al consultar sacramentos: ${error.message}`);
      }
    },
  },
  Mutation: {
    generarReportePDF: async (_, { filter = {}, fields = null }) => {
      try {
        const sacramentos = await sacramentoService.getFilteredSacramentos(filter);
        console.log(`Sacramentos obtenidos: ${sacramentos.length} sacramentos encontrados.`);
        
        if (!sacramentos || sacramentos.length === 0) {
          throw new Error('No se encontraron sacramentos que coincidan con los filtros aplicados.');
        }

        const options = {
          fields: fields || [
            'id_sacramento', 
            'fecha_sacramento', 
            'foja', 
            'numero', 
            'tipoSacramento.nombre',
            'parroquia.nombre',
            'usuario.nombre',
            'fecha_registro'
          ]
        };

        const result = await pdfGenerator.generatePDFReport(sacramentos, options, filter);

        return {
          fileName: result.fileName,
          downloadUrl: result.downloadUrl
        };
      } catch (error) {
        console.error(`Error al generar PDF: ${error.message}`);
        throw new Error(error.message);
      }
    }
  }
};