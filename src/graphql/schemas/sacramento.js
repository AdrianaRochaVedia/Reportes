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
    
    # Relaciones
    usuario: Usuario
    parroquia: Parroquia
    tipoSacramento: TipoSacramento
  }

  input SacramentoFilter {
    tipo_sacramento_id_tipo: Int
    institucion_parroquia_id_parroquia: Int
    usuario_id_usuario: Int
    foja: String
    numero: Int
    anio_sacramento: Int
    fecha_sacramento_desde: String
    fecha_sacramento_hasta: String
    fecha_registro_desde: String
    fecha_registro_hasta: String
    search: String
    orderBy: String
    orderDirection: String
  }

  type Query {
    sacramentos(filter: SacramentoFilter): [Sacramento]
  }

  type PDFGenerationResponse {
    fileName: String!
    downloadUrl: String!
  }

  type Mutation {
    generarReportePDF(
      filter: SacramentoFilter, 
      fields: [String]
    ): PDFGenerationResponse
  }
`;

module.exports = sacramentoSchema;