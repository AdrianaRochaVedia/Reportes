const sacramentoSchema = require('./schemas/sacramento');
const sacramentoResolvers = require('./resolvers/sacramento');

module.exports = {
  typeDefs: [sacramentoSchema],
  resolvers: [sacramentoResolvers],
};