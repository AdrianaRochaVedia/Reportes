const axios = require('axios');
const { REST_API_URL } = require('../config');

class DocumentService {
  async getAllDocuments() {
    try {
      const response = await axios.get(REST_API_URL);
      if (!response.data.ok) {
        throw new Error('Fallo al consumir documentos de REST API');
      }
      return response.data.documentos;
    } catch (error) {
      if (error.response) {
        throw new Error(`Error ${error.response.status}: ${error.response.statusText}`);
      }
      throw error;
    }
  }

  async getFilteredDocuments(filter = {}) {
    try {
      let documentos = await this.getAllDocuments();

      if (filter.tipo) {
        documentos = documentos.filter(doc =>
          doc.tipo?.trim() === filter.tipo.trim()
        );
      }

      // Filtro por año 
      if (filter.anio) {
        documentos = documentos.filter(doc => {
          const docAnio = parseInt(doc.anio_publicacion);
          return !isNaN(docAnio) && docAnio === filter.anio;
        });
      }

      if (filter.orderBy) {
        const orderField = filter.orderBy;
        documentos.sort((a, b) => {
          if (a[orderField] == null) return 1;
          if (b[orderField] == null) return -1;

          if (typeof a[orderField] === 'number') {
            return filter.orderDirection === 'DESC'
              ? b[orderField] - a[orderField]
              : a[orderField] - b[orderField];
          }

          return filter.orderDirection === 'DESC'
            ? b[orderField].toString().localeCompare(a[orderField].toString())
            : a[orderField].toString().localeCompare(b[orderField].toString());
        });
      }

      console.log(`Documentos filtrados encontrados: ${documentos.length}`);
      return documentos;
    } catch (error) {
      console.error(`Error al filtrar documentos: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new DocumentService();
