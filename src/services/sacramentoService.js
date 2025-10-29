const axios = require('axios');
const { REST_API_URL } = require('../config');

class SacramentoService {
  async getAllSacramentos() {
    try {
      const response = await axios.get(`${REST_API_URL}/sacramentos`);
      if (!response.data.ok) {
        throw new Error('Fallo al consumir sacramentos de REST API');
      }
      return response.data.sacramentos;
    } catch (error) {
      if (error.response) {
        throw new Error(`Error ${error.response.status}: ${error.response.statusText}`);
      }
      throw error;
    }
  }

  async getFilteredSacramentos(filter = {}) {
    try {
      let sacramentos = await this.getAllSacramentos();

      // Filtro por tipo de sacramento
      if (filter.tipo_sacramento_id_tipo) {
        sacramentos = sacramentos.filter(sac =>
          sac.tipo_sacramento_id_tipo === filter.tipo_sacramento_id_tipo
        );
      }

      // Filtro por parroquia
      if (filter.institucion_parroquia_id_parroquia) {
        sacramentos = sacramentos.filter(sac =>
          sac.institucion_parroquia_id_parroquia === filter.institucion_parroquia_id_parroquia
        );
      }

      // Filtro por usuario
      if (filter.usuario_id_usuario) {
        sacramentos = sacramentos.filter(sac =>
          sac.usuario_id_usuario === filter.usuario_id_usuario
        );
      }

      // Filtro por foja
      if (filter.foja) {
        sacramentos = sacramentos.filter(sac =>
          sac.foja?.trim() === filter.foja.trim()
        );
      }

      // Filtro por número
      if (filter.numero) {
        sacramentos = sacramentos.filter(sac =>
          sac.numero === filter.numero
        );
      }

      // Filtro por año de sacramento
      if (filter.anio_sacramento) {
        sacramentos = sacramentos.filter(sac => {
          const fechaSacramento = new Date(sac.fecha_sacramento);
          return fechaSacramento.getFullYear() === filter.anio_sacramento;
        });
      }

      // Filtro por rango de fechas de sacramento
      if (filter.fecha_sacramento_desde) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_sacramento) >= new Date(filter.fecha_sacramento_desde)
        );
      }

      if (filter.fecha_sacramento_hasta) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_sacramento) <= new Date(filter.fecha_sacramento_hasta)
        );
      }

      // Filtro por rango de fechas de registro
      if (filter.fecha_registro_desde) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_registro) >= new Date(filter.fecha_registro_desde)
        );
      }

      if (filter.fecha_registro_hasta) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_registro) <= new Date(filter.fecha_registro_hasta)
        );
      }

      // Búsqueda general
      if (filter.search) {
        const searchTerm = filter.search.toLowerCase();
        sacramentos = sacramentos.filter(sac =>
          sac.foja?.toLowerCase().includes(searchTerm) ||
          sac.numero?.toString().includes(searchTerm) ||
          sac.tipoSacramento?.nombre?.toLowerCase().includes(searchTerm) ||
          sac.parroquia?.nombre?.toLowerCase().includes(searchTerm)
        );
      }

      // Ordenamiento
      if (filter.orderBy) {
        const orderField = filter.orderBy;
        sacramentos.sort((a, b) => {
          let aValue = a[orderField];
          let bValue = b[orderField];

          // Manejo de campos anidados (ej: tipoSacramento.nombre)
          if (orderField.includes('.')) {
            const fields = orderField.split('.');
            aValue = a[fields[0]]?.[fields[1]];
            bValue = b[fields[0]]?.[fields[1]];
          }

          if (aValue == null) return 1;
          if (bValue == null) return -1;

          // Ordenamiento para fechas
          if (orderField.includes('fecha')) {
            const dateA = new Date(aValue);
            const dateB = new Date(bValue);
            return filter.orderDirection === 'DESC'
              ? dateB - dateA
              : dateA - dateB;
          }

          // Ordenamiento para números
          if (typeof aValue === 'number') {
            return filter.orderDirection === 'DESC'
              ? bValue - aValue
              : aValue - bValue;
          }

          // Ordenamiento para strings
          return filter.orderDirection === 'DESC'
            ? bValue.toString().localeCompare(aValue.toString())
            : aValue.toString().localeCompare(bValue.toString());
        });
      }

      console.log(`Sacramentos filtrados encontrados: ${sacramentos.length}`);
      return sacramentos;
    } catch (error) {
      console.error(`Error al filtrar sacramentos: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new SacramentoService();