const documentSchema = require('./schemas/document');
const documentResolvers = require('./resolvers/document');

module.exports = {
  typeDefs: [documentSchema],
  resolvers: [documentResolvers],
};