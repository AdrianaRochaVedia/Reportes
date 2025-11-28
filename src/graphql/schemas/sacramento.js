const { gql } = require('apollo-server');

const sacramentoSchema = gql`
  type Usuario {
    id_usuario: Int
    nombre: String
    apellido_paterno: String
    apellido_materno: String
    email: String
  }

  type Parroquia {
    id_parroquia: Int
    nombre: String
    direccion: String
    telefono: String
  }

  type TipoSacramento {
    id_tipo: Int
    nombre: String
    descripcion: String
  }

  type Sacramento {
    id_sacramento: Int!
    fecha_sacramento: String!
    fecha_registro: String!
    fecha_actualizacion: String!
    activo: Boolean!
    foja: String!
    numero: Int!
    usuario_id_usuario: Int!
    institucion_parroquia_id_parroquia: Int!
    tipo_sacramento_id_tipo: Int!

    usuario: Usuario
    parroquia: Parroquia
    tipoSacramento: TipoSacramento
  }

  input SacramentoFilter {
    tipo_sacramento_id_tipo: Int
    institucion_parroquia_id_parroquia: Int
    usuario_id_usuario: Int
    
    # Filtros por estado
    activo: Boolean  
    
    # Filtros por libro
    foja: String
    numero: Int
    numero_desde: Int  
    numero_hasta: Int  
    
    # Filtros por fecha de sacramento
    anio_sacramento: Int
    mes_sacramento: Int 
    fecha_sacramento_desde: String
    fecha_sacramento_hasta: String
    
    # Filtros por registro para fechas
    fecha_registro_desde: String
    fecha_registro_hasta: String
    anio_registro: Int 
    
    fecha_actualizacion_desde: String  
    fecha_actualizacion_hasta: String  
    
    search: String
    
    orderBy: String
    orderDirection: String
    
    limit: Int
    offset: Int
  }

  type EstadisticaSacramento {
    tipo_sacramento: String
    cantidad: Int
  }

  type EstadisticaParroquia {
    parroquia: String
    cantidad: Int
  }

  type EstadisticaUsuario {
    usuario: String
    cantidad: Int
  }

  type EstadisticasPorPeriodo {
    periodo: String  
    cantidad: Int
  }

  type EstadisticasGenerales {
    total: Int!
    por_tipo: [EstadisticaSacramento]
    por_parroquia: [EstadisticaParroquia]
    por_usuario: [EstadisticaUsuario]
    por_mes: [EstadisticasPorPeriodo]
    activos: Int
    inactivos: Int
  }

  type Query {
    sacramentos(filter: SacramentoFilter): [Sacramento]
    
    estadisticasSacramentos(filter: SacramentoFilter): EstadisticasGenerales
    sacramentosPorTipo(tipo_id: Int!, filter: SacramentoFilter): [Sacramento]
    sacramentosPorParroquia(parroquia_id: Int!, filter: SacramentoFilter): [Sacramento]
    sacramentosPorUsuario(usuario_id: Int!, filter: SacramentoFilter): [Sacramento]
  }

  type PDFGenerationResponse {
    fileName: String!
    downloadUrl: String!
    totalRegistros: Int  
    filtrosAplicados: String  
  }

  type Mutation {
    generarReportePDF(
      filter: SacramentoFilter, 
      fields: [String],
      titulo: String,  
      incluirEstadisticas: Boolean  
    ): PDFGenerationResponse
  }
`;

module.exports = sacramentoSchema;