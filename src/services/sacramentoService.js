const axios = require('axios');
const { REST_API_URL } = require('../config');

console.log('Servidor de la Api corriendo:', REST_API_URL);

class SacramentoService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 60 * 1000;
  }

  getCacheKey(key, token) {
    return `${key}:${token || 'no-token'}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);

    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.cacheTTL;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  getHeaders(token) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (token) {
      headers['x-token'] = token;
    }

    return headers;
  }

  async getAllSacramentos(token) {
    try {
      const cacheKey = this.getCacheKey('sacramentos-all', token);
      const cachedData = this.getFromCache(cacheKey);

      if (cachedData) {
        console.log(`Sacramentos obtenidos desde cache: ${cachedData.length}`);
        return cachedData;
      }

      const headers = this.getHeaders(token);

      console.log(`Token enviado: ${token ? 'Sí' : 'No'}`);

      const response = await axios.get(`${REST_API_URL}/all`, { headers, params: { limit: 10000 } });

      if (!response.data.ok) {
        throw new Error('Fallo al consumir sacramentos de REST API');
      }

      const sacramentos = response.data.sacramento || [];

      console.log(`Sacramentos obtenidos: ${sacramentos.length}`);

      const sacramentosEnriquecidos = await this.enrichSacramentos(sacramentos, token);

      this.setCache(cacheKey, sacramentosEnriquecidos);

      return sacramentosEnriquecidos;
    } catch (error) {
      if (error.response) {
        throw new Error(`Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      }

      console.error(`Error de conexión:`, error.message);
      throw error;
    }
  }

  async enrichSacramentos(sacramentos, token) {
    try {
      const usuariosIds = [...new Set(sacramentos.map(s => s.usuario_id_usuario).filter(Boolean))];
      const parroquiasIds = [...new Set(sacramentos.map(s => s.institucion_parroquia_id_parroquia).filter(Boolean))];
      const tiposIds = [...new Set(sacramentos.map(s => s.tipo_sacramento_id_tipo).filter(Boolean))];

      const [usuarios, parroquias, tipos] = await Promise.all([
        this.getUsuarios(usuariosIds, token),
        this.getParroquias(parroquiasIds, token),
        this.getTipos(tiposIds, token)
      ]);

      console.log(`Usuarios obtenidos: ${usuarios.length}`);
      console.log(`Parroquias obtenidas: ${parroquias.length}`);
      console.log(`Tipos obtenidos: ${tipos.length}`);

      const usuariosMap = new Map(usuarios.map(u => [u.id_usuario, u]));
      const parroquiasMap = new Map(parroquias.map(p => [p.id_parroquia, p]));
      const tiposMap = new Map(tipos.map(t => [t.id_tipo, t]));

      return sacramentos.map(sacramento => ({
        ...sacramento,
        usuario: usuariosMap.get(sacramento.usuario_id_usuario) || null,
        parroquia: parroquiasMap.get(sacramento.institucion_parroquia_id_parroquia) || null,
        tipoSacramento: tiposMap.get(sacramento.tipo_sacramento_id_tipo) || null
      }));
    } catch (error) {
      console.error('Error al enriquecer sacramentos:', error.message);

      return sacramentos.map(s => ({
        ...s,
        usuario: null,
        parroquia: null,
        tipoSacramento: null
      }));
    }
  }

  async getUsuarios(ids, token) {
    try {
      if (!ids.length) return [];

      const cacheKey = this.getCacheKey('usuarios-all', token);
      const cachedData = this.getFromCache(cacheKey);

      if (cachedData) return cachedData;

      const headers = this.getHeaders(token);
      const baseUrl = REST_API_URL.replace('/sacramentos', '');
      const url = `${baseUrl}/usuarios/all`;

      const response = await axios.get(url, { headers });
      const usuarios = response.data.ok ? response.data.usuarios || [] : [];

      this.setCache(cacheKey, usuarios);

      return usuarios;
    } catch (error) {
      console.error('Error al obtener usuarios:', error.response?.status || error.message);
      return [];
    }
  }

  async getParroquias(ids, token) {
    try {
      if (!ids.length) return [];

      const cacheKey = this.getCacheKey('parroquias-all', token);
      const cachedData = this.getFromCache(cacheKey);

      if (cachedData) return cachedData;

      const headers = this.getHeaders(token);
      const baseUrl = REST_API_URL.replace('/sacramentos', '');
      const url = `${baseUrl}/parroquias`;

      const response = await axios.get(url, { headers });

      let parroquias = [];

      if (Array.isArray(response.data)) {
        parroquias = response.data;
      } else if (response.data.ok && response.data.institucion_parroquia) {
        parroquias = response.data.institucion_parroquia;
      } else if (response.data.ok && response.data.parroquias) {
        parroquias = response.data.parroquias;
      } else if (response.data.institucion_parroquia) {
        parroquias = response.data.institucion_parroquia;
      } else if (response.data.parroquias) {
        parroquias = response.data.parroquias;
      }

      this.setCache(cacheKey, parroquias);

      return parroquias;
    } catch (error) {
      console.error('Error al obtener parroquias:', error.response?.status || error.message);
      return [];
    }
  }

  async getTipos(ids, token) {
    try {
      if (!ids.length) return [];

      const cacheKey = this.getCacheKey('tipos-all', token);
      const cachedData = this.getFromCache(cacheKey);

      if (cachedData) return cachedData;

      const headers = this.getHeaders(token);
      const baseUrl = REST_API_URL.replace('/sacramentos', '');
      const url = `${baseUrl}/tiposacramentos/all`;

      const response = await axios.get(url, { headers });

      let tipos = [];

      if (Array.isArray(response.data)) {
        tipos = response.data;
      } else if (response.data.ok && response.data.tipo_sacramento) {
        tipos = response.data.tipo_sacramento;
      } else if (response.data.ok && response.data.tiposacramento) {
        tipos = response.data.tiposacramento;
      } else if (response.data.ok && response.data.tipos) {
        tipos = response.data.tipos;
      } else if (response.data.tipo_sacramento) {
        tipos = response.data.tipo_sacramento;
      } else if (response.data.tiposacramento) {
        tipos = response.data.tiposacramento;
      } else if (response.data.tipos) {
        tipos = response.data.tipos;
      }

      this.setCache(cacheKey, tipos);

      return tipos;
    } catch (error) {
      console.error('Error al obtener tipos:', error.response?.status || error.message);
      return [];
    }
  }

  async getFilteredSacramentos(filter = {}, token = '') {
    try {
      let sacramentos = await this.getAllSacramentos(token);

      console.log(`Total de sacramentos antes de filtrar: ${sacramentos.length}`);

      if (filter.tipo_sacramento_id_tipo) {
        sacramentos = sacramentos.filter(sac =>
          sac.tipo_sacramento_id_tipo === filter.tipo_sacramento_id_tipo
        );
      }

      if (filter.institucion_parroquia_id_parroquia) {
        sacramentos = sacramentos.filter(sac =>
          sac.institucion_parroquia_id_parroquia === filter.institucion_parroquia_id_parroquia
        );
      }

      if (filter.usuario_id_usuario) {
        sacramentos = sacramentos.filter(sac =>
          sac.usuario_id_usuario === filter.usuario_id_usuario
        );
      }

      if (filter.activo !== undefined && filter.activo !== null) {
        sacramentos = sacramentos.filter(sac =>
          sac.activo === filter.activo
        );
      }

      if (filter.foja) {
        sacramentos = sacramentos.filter(sac =>
          sac.foja?.trim() === filter.foja.trim()
        );
      }

      if (filter.numero) {
        sacramentos = sacramentos.filter(sac =>
          sac.numero === filter.numero
        );
      }

      if (filter.numero_desde) {
        sacramentos = sacramentos.filter(sac =>
          sac.numero >= filter.numero_desde
        );
      }

      if (filter.numero_hasta) {
        sacramentos = sacramentos.filter(sac =>
          sac.numero <= filter.numero_hasta
        );
      }

      if (filter.anio_sacramento) {
        sacramentos = sacramentos.filter(sac => {
          const fechaSacramento = new Date(sac.fecha_sacramento);
          return fechaSacramento.getFullYear() === filter.anio_sacramento;
        });
      }

      if (filter.mes_sacramento) {
        sacramentos = sacramentos.filter(sac => {
          const fechaSacramento = new Date(sac.fecha_sacramento);
          return fechaSacramento.getMonth() + 1 === filter.mes_sacramento;
        });
      }

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

      if (filter.anio_registro) {
        sacramentos = sacramentos.filter(sac => {
          const fechaRegistro = new Date(sac.fecha_registro);
          return fechaRegistro.getFullYear() === filter.anio_registro;
        });
      }

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

      if (filter.fecha_actualizacion_desde) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_actualizacion) >= new Date(filter.fecha_actualizacion_desde)
        );
      }

      if (filter.fecha_actualizacion_hasta) {
        sacramentos = sacramentos.filter(sac =>
          new Date(sac.fecha_actualizacion) <= new Date(filter.fecha_actualizacion_hasta)
        );
      }

      if (filter.search) {
        const searchTerm = filter.search.toLowerCase();

        sacramentos = sacramentos.filter(sac =>
          sac.foja?.toLowerCase().includes(searchTerm) ||
          sac.numero?.toString().includes(searchTerm) ||
          sac.tipoSacramento?.nombre?.toLowerCase().includes(searchTerm) ||
          sac.parroquia?.nombre?.toLowerCase().includes(searchTerm) ||
          sac.usuario?.nombre?.toLowerCase().includes(searchTerm) ||
          sac.usuario?.apellido_paterno?.toLowerCase().includes(searchTerm)
        );
      }

      if (filter.orderBy) {
        const orderField = filter.orderBy;

        sacramentos.sort((a, b) => {
          let aValue = a[orderField];
          let bValue = b[orderField];

          if (orderField.includes('.')) {
            const fields = orderField.split('.');
            aValue = a[fields[0]]?.[fields[1]];
            bValue = b[fields[0]]?.[fields[1]];
          }

          if (aValue == null) return 1;
          if (bValue == null) return -1;

          if (orderField.includes('fecha')) {
            const dateA = new Date(aValue);
            const dateB = new Date(bValue);

            return filter.orderDirection === 'DESC'
              ? dateB - dateA
              : dateA - dateB;
          }

          if (typeof aValue === 'number') {
            return filter.orderDirection === 'DESC'
              ? bValue - aValue
              : aValue - bValue;
          }

          return filter.orderDirection === 'DESC'
            ? bValue.toString().localeCompare(aValue.toString())
            : aValue.toString().localeCompare(bValue.toString());
        });
      }

      if (filter.limit || filter.offset) {
        const offset = filter.offset || 0;
        const limit = filter.limit || sacramentos.length;
        sacramentos = sacramentos.slice(offset, offset + limit);
      }

      console.log(`Total de sacramentos filtrados: ${sacramentos.length}`);

      return sacramentos;
    } catch (error) {
      console.error(`Error al filtrar sacramentos: ${error.message}`);
      throw error;
    }
  }

  async getEstadisticas(filter = {}, token = '', sacramentosYaFiltrados = null) {
    try {
      const sacramentos = sacramentosYaFiltrados || await this.getFilteredSacramentos(filter, token);

      const total = sacramentos.length;
      const activos = sacramentos.filter(s => s.activo).length;
      const inactivos = sacramentos.filter(s => !s.activo).length;

      const porTipo = {};
      sacramentos.forEach(sac => {
        const tipo = sac.tipoSacramento?.nombre || 'Sin tipo';
        porTipo[tipo] = (porTipo[tipo] || 0) + 1;
      });

      const por_tipo = Object.entries(porTipo).map(([tipo_sacramento, cantidad]) => ({
        tipo_sacramento,
        cantidad
      }));

      const porParroquia = {};
      sacramentos.forEach(sac => {
        const parroquia = sac.parroquia?.nombre || 'Sin parroquia';
        porParroquia[parroquia] = (porParroquia[parroquia] || 0) + 1;
      });

      const por_parroquia = Object.entries(porParroquia).map(([parroquia, cantidad]) => ({
        parroquia,
        cantidad
      }));

      const porUsuario = {};
      sacramentos.forEach(sac => {
        const usuario = sac.usuario
          ? `${sac.usuario.nombre} ${sac.usuario.apellido_paterno || ''}`
          : 'Sin usuario';

        porUsuario[usuario] = (porUsuario[usuario] || 0) + 1;
      });

      const por_usuario = Object.entries(porUsuario).map(([usuario, cantidad]) => ({
        usuario,
        cantidad
      }));

      const porMes = {};
      sacramentos.forEach(sac => {
        const fecha = new Date(sac.fecha_sacramento);

        if (!isNaN(fecha)) {
          const periodo = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
          porMes[periodo] = (porMes[periodo] || 0) + 1;
        }
      });

      const por_mes = Object.entries(porMes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([periodo, cantidad]) => ({
          periodo,
          cantidad
        }));

      return {
        total,
        activos,
        inactivos,
        por_tipo,
        por_parroquia,
        por_usuario,
        por_mes
      };
    } catch (error) {
      console.error(`Error al generar estadísticas: ${error.message}`);
      throw error;
    }
  }

  generarDescripcionFiltros(filter = {}) {
    const descripciones = [];

    if (filter.tipo_sacramento_id_tipo) {
      descripciones.push(`Tipo de sacramento: ${filter.tipo_sacramento_id_tipo}`);
    }

    if (filter.institucion_parroquia_id_parroquia) {
      descripciones.push(`Parroquia: ${filter.institucion_parroquia_id_parroquia}`);
    }

    if (filter.usuario_id_usuario) {
      descripciones.push(`Usuario: ${filter.usuario_id_usuario}`);
    }

    if (filter.activo !== undefined) {
      descripciones.push(`Estado: ${filter.activo ? 'Activos' : 'Inactivos'}`);
    }

    if (filter.foja) {
      descripciones.push(`Foja: ${filter.foja}`);
    }

    if (filter.numero) {
      descripciones.push(`Número: ${filter.numero}`);
    }

    if (filter.numero_desde || filter.numero_hasta) {
      const rango = `${filter.numero_desde || '∞'} - ${filter.numero_hasta || '∞'}`;
      descripciones.push(`Rango de números: ${rango}`);
    }

    if (filter.anio_sacramento) {
      descripciones.push(`Año sacramento: ${filter.anio_sacramento}`);
    }

    if (filter.mes_sacramento) {
      const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
      ];

      descripciones.push(`Mes sacramento: ${meses[filter.mes_sacramento - 1]}`);
    }

    if (filter.fecha_sacramento_desde || filter.fecha_sacramento_hasta) {
      const rango = `${filter.fecha_sacramento_desde || '∞'} - ${filter.fecha_sacramento_hasta || '∞'}`;
      descripciones.push(`Rango fechas sacramento: ${rango}`);
    }

    if (filter.fecha_registro_desde || filter.fecha_registro_hasta) {
      const rango = `${filter.fecha_registro_desde || '∞'} - ${filter.fecha_registro_hasta || '∞'}`;
      descripciones.push(`Rango fechas registro: ${rango}`);
    }

    if (filter.search) {
      descripciones.push(`Búsqueda: "${filter.search}"`);
    }

    if (filter.orderBy) {
      const direccion = filter.orderDirection === 'DESC' ? 'descendente' : 'ascendente';
      descripciones.push(`Ordenado por ${filter.orderBy} (${direccion})`);
    }

    return descripciones.length > 0
      ? descripciones.join(' | ')
      : 'Sin filtros aplicados';
  }
}

module.exports = new SacramentoService();
